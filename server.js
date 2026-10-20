'use strict';
/* Masked Spire co-op server for Render.
   Serves the game page and runs every co-op match on the server.
   Browsers only send the cards and buttons they press; the server applies the rules
   and sends each player their own view of the game. */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');
const { createEngine } = require('./public/engine.js');

const PORT = process.env.PORT || 3000;

/* Build id shown in the UI and checked on create/join. Render sets RENDER_GIT_COMMIT on every deploy. */
const BUILD = (() => {
  let v = '0.0.0';
  try { v = String(require('./package.json').version || v); } catch (e) {}
  const c = String(process.env.RENDER_GIT_COMMIT || '').replace(/[^A-Za-z0-9]/g, '').slice(0, 7) || 'dev';
  return ('v' + v.replace(/[^A-Za-z0-9.\-+]/g, '') + ' \u00b7 ' + c);
})();
const BUILD_PLACEHOLDER = "let BUILD_ID = 'dev';";
let INDEX_HTML = null; // index.html with the real build injected, read once at startup
try {
  const src = fs.readFileSync(path.join(__dirname, 'public', 'index.html'), 'utf8');
  if (src.indexOf(BUILD_PLACEHOLDER) === -1) console.warn('BUILD placeholder not found in index.html; clients will fetch /version');
  else INDEX_HTML = Buffer.from(src.split(BUILD_PLACEHOLDER).join("let BUILD_ID = '" + BUILD + "';"), 'utf8');
} catch (e) { console.warn('Could not preload index.html', e && e.message); }
console.log('Build ' + BUILD);
/* A client that sends no build (old cached page) or 'dev' (not yet resolved) is tolerated. */
function buildMismatch(m) { return typeof m.build === 'string' && m.build !== 'dev' && m.build !== BUILD; }
const RELOAD_MSG = 'Reload the page, a new version of the game is out.';
const PUBLIC = path.join(__dirname, 'public');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };
const IDLE_MS = 30 * 60 * 1000;     // an empty room is kept this long so players can rejoin
const ENDED_MS = 2 * 60 * 1000;     // a finished game with nobody connected is cleaned up sooner
const MAX_ROOMS = 200;
const MAX_CONN_PER_IP = 20;         // simultaneous sockets from one IP
const MAX_CONN_TOTAL = 2000;        // backstop for the whole server
const MSG_BURST = 30, MSG_RATE = 15;        // all messages: burst size, refills per second
const JOIN_BURST = 5, JOIN_RATE = 0.5;      // create/join: burst size, refills per second
const STRIKE_WINDOW_MS = 10000, MAX_STRIKES = 100; // this many dropped messages in the window => disconnect
const CRASH_WINDOW_MS = 60000, MAX_CRASHES = 10;   // this many uncaught errors in the window => exit so Render restarts us

const ipCounts = new Map();
let totalConns = 0;
function clientIp(req) {
  const h = req.headers;
  const v = h['cf-connecting-ip'] || h['true-client-ip'] || String(h['x-forwarded-for'] || '').split(',')[0];
  return String(v || (req.socket && req.socket.remoteAddress) || 'unknown').trim().slice(0, 64);
}
/* Input validation: room codes are exactly 5 lowercase letters/digits; player tokens are 1-40 chars of [A-Za-z0-9_-]. */
function cleanCode(v) {
  if (typeof v !== 'string') return '';
  const s = v.trim().slice(0, 16).toLowerCase();
  return /^[a-z0-9]{5}$/.test(s) ? s : '';
}
function cleanTok(v) {
  if (typeof v !== 'string') return '';
  const s = v.trim();
  return /^[A-Za-z0-9_-]{1,40}$/.test(s) ? s : '';
}
function takeToken(b, rate, burst) {
  const now = Date.now();
  b.n = Math.min(burst, b.n + (now - b.t) * rate / 1000);
  b.t = now;
  if (b.n >= 1) { b.n -= 1; return true; }
  return false;
}

/* ---------- Static files ---------- */
const SEC_HEADERS = {
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'content-security-policy': "frame-ancestors 'self'",
  'x-frame-options': 'SAMEORIGIN'
};
function send(res, code, headers, body) {
  res.writeHead(code, Object.assign({}, SEC_HEADERS, headers));
  res.end(body);
}
const server = http.createServer((req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') { send(res, 405, { 'content-type': 'text/plain', allow: 'GET, HEAD' }, 'Method not allowed'); return; }
  const head = req.method === 'HEAD';
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  } catch (e) { send(res, 400, { 'content-type': 'text/plain' }, 'Bad request'); return; }
  if (pathname.indexOf('\0') !== -1) { send(res, 400, { 'content-type': 'text/plain' }, 'Bad request'); return; }
  if (pathname === '/healthz') { send(res, 200, { 'content-type': 'text/plain' }, head ? undefined : 'ok'); return; }
  if (pathname === '/version') { send(res, 200, { 'content-type': 'application/json', 'cache-control': 'no-store' }, head ? undefined : JSON.stringify({ build: BUILD })); return; }
  const p = pathname === '/' ? '/index.html' : pathname;
  const file = path.resolve(PUBLIC, '.' + path.sep + p.replace(/^[\/\\]+/, ''));
  if (file !== PUBLIC && !file.startsWith(PUBLIC + path.sep)) { send(res, 403, { 'content-type': 'text/plain' }, 'Forbidden'); return; }
  if (INDEX_HTML && file === path.join(PUBLIC, 'index.html')) {
    send(res, 200, { 'content-type': TYPES['.html'], 'cache-control': 'no-cache' }, head ? undefined : INDEX_HTML);
    return;
  }
  fs.readFile(file, (err, data) => {
    if (err) { send(res, 404, { 'content-type': 'text/plain' }, 'Not found'); return; }
    send(res, 200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-cache' }, head ? undefined : data);
  });
});

/* ---------- Rooms ---------- */
const rooms = new Map(); // code -> room
function makeCode() {
  const al = 'abcdefghjkmnpqrstuvwxyz23456789';
  for (;;) { let s = ''; for (let i = 0; i < 5; i++) s += al[Math.floor(Math.random() * al.length)]; if (!rooms.has(s)) return s; }
}
function createRoom(tok) {
  const code = makeCode();
  const room = { code, sockets: new Set(), last: Date.now(), pending: false, away: [false, false], dropAt: [0, 0], timers: [null, null] };
  room.E = createEngine({ onChange: () => scheduleBroadcast(room) });
  const G = room.E.baseG('coop');
  G.code = code;
  G.P = [room.E.newPlayer(null, tok)];
  room.E.G = G;
  rooms.set(code, room);
  return room;
}
function scheduleBroadcast(room) {
  if (room.pending) return;
  room.pending = true;
  setImmediate(() => { room.pending = false; broadcast(room); });
}
function broadcast(room) {
  const G = room.E.G;
  if (!G) return;
  room.last = Date.now();
  for (const ws of room.sockets) {
    if (ws.pi == null || !G.P[ws.pi]) continue;
    try { ws.send(JSON.stringify({ t: 'view', v: room.E.buildView(ws.pi) })); } catch (e) {}
  }
}
function setConn(room) {
  const G = room.E.G;
  G.P.forEach((p, i) => { p.conn = [...room.sockets].some(s => s.pi === i); });
}
/* Partner presence: online | away (tab hidden) | reconnecting (dropped recently) | offline (dropped a while ago) */
const PRESENCE_OFFLINE_MS = 60 * 1000;
function presenceOf(room, i) {
  if ([...room.sockets].some(s => s.pi === i)) return room.away[i] ? 'away' : 'online';
  return Date.now() - room.dropAt[i] < PRESENCE_OFFLINE_MS ? 'reconnecting' : 'offline';
}
function sendPresence(room, i) {
  const G = room.E.G;
  if (!G || G.P.length < 2 || !G.P[1 - i]) return;
  const msg = JSON.stringify({ t: 'presence', st: presenceOf(room, i) });
  for (const s of room.sockets) if (s.pi === 1 - i) { try { s.send(msg); } catch (e) {} }
}
function sendPartnerPresence(ws, room) {
  const G = room.E.G;
  if (!G || G.P.length < 2 || ws.pi == null) return;
  try { ws.send(JSON.stringify({ t: 'presence', st: presenceOf(room, 1 - ws.pi) })); } catch (e) {}
}
function closeRoom(room, msg) {
  for (const ws of room.sockets) { try { ws.send(JSON.stringify({ t: 'err', msg, fatal: true })); } catch (e) {} ws.room = null; ws.pi = null; }
  room.sockets.clear();
  rooms.delete(room.code);
}
function detach(ws) {
  const room = ws.room;
  if (!room) return;
  room.sockets.delete(ws);
  const pi = ws.pi;
  ws.room = null; ws.pi = null;
  const G = room.E.G;
  if (!G) return;
  setConn(room);
  scheduleBroadcast(room);
  if (pi != null && pi >= 0 && pi < 2) {
    room.dropAt[pi] = Date.now();
    room.away[pi] = false;
    clearTimeout(room.timers[pi]);
    sendPresence(room, pi);
    room.timers[pi] = setTimeout(() => { if (rooms.get(room.code) === room) sendPresence(room, pi); }, PRESENCE_OFFLINE_MS + 200);
    if (room.timers[pi].unref) room.timers[pi].unref();
  }
  return { room, pi };
}

/* ---------- Sockets ---------- */
const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 4096 });
wss.on('error', e => console.error('wss error', e));
wss.on('connection', (ws, req) => {
  ws.on('error', e => { console.error('socket error', e && e.message); });
  const err = (msg, fatal) => { try { ws.send(JSON.stringify({ t: 'err', msg, fatal: !!fatal })); } catch (e) {} };
  const ip = clientIp(req);
  const n = ipCounts.get(ip) || 0;
  if (n >= MAX_CONN_PER_IP || totalConns >= MAX_CONN_TOTAL) {
    err('Too many connections. Close other tabs and try again.', true);
    try { ws.close(1013, 'Too many connections'); } catch (e) {}
    return;
  }
  ipCounts.set(ip, n + 1);
  totalConns++;
  let released = false;
  ws.on('close', () => {
    if (released) return;
    released = true;
    totalConns--;
    const c = (ipCounts.get(ip) || 1) - 1;
    if (c <= 0) ipCounts.delete(ip); else ipCounts.set(ip, c);
  });
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
  const allBucket = { n: MSG_BURST, t: Date.now() };
  const joinBucket = { n: JOIN_BURST, t: Date.now() };
  let strikes = 0, strikeStart = Date.now(), lastWarn = 0;
  const limited = () => {
    const now = Date.now();
    if (now - strikeStart > STRIKE_WINDOW_MS) { strikeStart = now; strikes = 0; }
    if (++strikes >= MAX_STRIKES) { try { ws.terminate(); } catch (e) {} return; }
    if (now - lastWarn > 5000) { lastWarn = now; err('Slow down, you are sending too many requests.'); }
  };
  ws.on('message', raw => {
    if (!takeToken(allBucket, MSG_RATE, MSG_BURST)) return limited();
    let m;
    try { m = JSON.parse(String(raw)); } catch (e) { return; }
    if (!m || typeof m.t !== 'string') return;
    ws.isAlive = true;
    if (m.t === 'ping') { try { ws.send('{"t":"pong"}'); } catch (e) {} return; }
    if ((m.t === 'create' || m.t === 'join') && !takeToken(joinBucket, JOIN_RATE, JOIN_BURST)) return limited();
    const tok = cleanTok(m.tok);
    if (m.t === 'create') {
      if (!tok) return err('Missing player id.');
      if (buildMismatch(m)) return err(RELOAD_MSG, true);
      if (rooms.size >= MAX_ROOMS) return err('The server is full right now. Try again later.', true);
      detach(ws);
      const room = createRoom(tok);
      ws.room = room; ws.pi = 0; room.sockets.add(ws);
      setConn(room);
      ws.send(JSON.stringify({ t: 'joined', code: room.code, pi: 0 }));
      broadcast(room);
    } else if (m.t === 'join') {
      if (!tok) return err('Missing player id.', true);
      if (buildMismatch(m)) return err(RELOAD_MSG, true);
      const code = cleanCode(m.code);
      if (!code) return err('Room codes are 5 letters or numbers.', true);
      const room = rooms.get(code);
      if (!room) return err('No room with code ' + code.toUpperCase() + '. It may have closed, or the server restarted.', true);
      const G = room.E.G;
      let pi = G.P.findIndex(p => p.tok === tok);
      if (pi < 0) {
        if (G.screen === 'lobby' && G.P.length < 2) { G.P.push(room.E.newPlayer(null, tok)); pi = G.P.length - 1; }
        else return err('That room already has two players.', true);
      }
      detach(ws);
      for (const other of room.sockets) if (other.pi === pi) { try { other.send(JSON.stringify({ t: 'err', msg: 'You opened this game somewhere else.', fatal: true })); } catch (e) {} room.sockets.delete(other); other.room = null; other.pi = null; }
      ws.room = room; ws.pi = pi; room.sockets.add(ws);
      setConn(room);
      ws.send(JSON.stringify({ t: 'joined', code: room.code, pi }));
      clearTimeout(room.timers[pi]);
      room.away[pi] = false;
      sendPresence(room, pi);
      sendPartnerPresence(ws, room);
      broadcast(room);
    } else if (m.t === 'act') {
      const room = ws.room;
      if (!room || ws.pi == null) return;
      const a = String(m.a || '').slice(0, 20);
      const x = typeof m.x === 'number' || typeof m.x === 'string' ? (typeof m.x === 'string' ? m.x.slice(0, 20) : m.x) : null;
      const y = typeof m.y === 'number' || typeof m.y === 'string' ? (typeof m.y === 'string' ? m.y.slice(0, 20) : m.y) : null;
      try { room.E.doAction(ws.pi, a, x, y); } catch (e) { console.error('action failed', room.code, a, e); }
      scheduleBroadcast(room);
    } else if (m.t === 'away') {
      const room = ws.room;
      if (!room || ws.pi == null) return;
      room.away[ws.pi] = m.v === true;
      sendPresence(room, ws.pi);
    } else if (m.t === 'leave') {
      const r = detach(ws);
      if (!r) return;
      const G = r.room.E.G;
      if (G.screen === 'lobby') {
        if (r.pi === 0) closeRoom(r.room, 'The host closed the room.');
        else if (r.pi === 1) { G.P.splice(1, 1); setConn(r.room); scheduleBroadcast(r.room); }
      }
    }
  });
  ws.on('close', () => { detach(ws); });
});

/* keep connections alive through Render's proxy, and drop dead ones */
const HEARTBEAT_MS = 10000; // a socket that misses two sweeps is dropped, so ~10-20s to notice a silent disconnect
setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) {
      console.log('heartbeat: dropping dead socket' + (ws.room ? ' in room ' + ws.room.code : ''));
      try { ws.terminate(); } catch (e) {}
      continue;
    }
    ws.isAlive = false;
    try { ws.ping(); } catch (e) {}
  }
}, HEARTBEAT_MS).unref();

/* clean up abandoned rooms */
setInterval(() => {
  const now = Date.now();
  for (const room of rooms.values()) {
    if (room.sockets.size) { room.last = now; continue; }
    const G = room.E.G;
    const ended = G && ['defeat', 'victory', 'duelend'].includes(G.screen);
    if (now - room.last > (ended ? ENDED_MS : IDLE_MS)) rooms.delete(room.code);
  }
}, 60000);

/* one bad request must not take the server (and every room in memory) down */
const crashTimes = [];
function onFatalish(kind, e) {
  console.error(kind, e && e.stack || e);
  const now = Date.now();
  crashTimes.push(now);
  while (crashTimes.length && now - crashTimes[0] > CRASH_WINDOW_MS) crashTimes.shift();
  if (crashTimes.length >= MAX_CRASHES) {
    console.error('Too many uncaught errors; exiting so the host restarts the server.');
    process.exit(1);
  }
}
process.on('uncaughtException', e => onFatalish('uncaughtException', e));
process.on('unhandledRejection', e => onFatalish('unhandledRejection', e));
server.on('clientError', (e, socket) => { try { socket.destroy(); } catch (x) {} });

server.listen(PORT, () => console.log('Masked Spire listening on ' + PORT));

/* ---------- Graceful shutdown (Render sends SIGTERM on deploy) ---------- */
let shuttingDown = false;
function shutdown(sig) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(sig + ' received: shutting down, notifying ' + wss.clients.size + ' client(s)');
  const hardExit = setTimeout(() => process.exit(0), 8000);
  hardExit.unref();
  try { server.close(); } catch (e) {}
  if (typeof server.closeIdleConnections === 'function') { try { server.closeIdleConnections(); } catch (e) {} }
  for (const ws of wss.clients) {
    try { ws.send(JSON.stringify({ t: 'restart', msg: 'Server restarting' })); } catch (e) {}
  }
  setTimeout(() => {
    for (const ws of wss.clients) { try { ws.close(1012, 'Server restarting'); } catch (e) {} }
    setTimeout(() => {
      for (const ws of wss.clients) { try { ws.terminate(); } catch (e) {} }
      process.exit(0);
    }, 1000);
  }, 800);
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

