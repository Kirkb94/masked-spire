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
const PUBLIC = path.join(__dirname, 'public');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };
const IDLE_MS = 30 * 60 * 1000;     // an empty room is kept this long so players can rejoin
const ENDED_MS = 2 * 60 * 1000;     // a finished game with nobody connected is cleaned up sooner
const MAX_ROOMS = 200;

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
  const p = pathname === '/' ? '/index.html' : pathname;
  const file = path.resolve(PUBLIC, '.' + path.sep + p.replace(/^[\/\\]+/, ''));
  if (file !== PUBLIC && !file.startsWith(PUBLIC + path.sep)) { send(res, 403, { 'content-type': 'text/plain' }, 'Forbidden'); return; }
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
  const room = { code, sockets: new Set(), last: Date.now(), pending: false };
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
  return { room, pi };
}

/* ---------- Sockets ---------- */
const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 4096 });
wss.on('connection', ws => {
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
  const err = (msg, fatal) => { try { ws.send(JSON.stringify({ t: 'err', msg, fatal: !!fatal })); } catch (e) {} };
  ws.on('message', raw => {
    let m;
    try { m = JSON.parse(String(raw)); } catch (e) { return; }
    if (!m || typeof m.t !== 'string') return;
    const tok = typeof m.tok === 'string' ? m.tok.slice(0, 40) : '';
    if (m.t === 'create') {
      if (!tok) return err('Missing player id.');
      if (rooms.size >= MAX_ROOMS) return err('The server is full right now. Try again later.', true);
      detach(ws);
      const room = createRoom(tok);
      ws.room = room; ws.pi = 0; room.sockets.add(ws);
      setConn(room);
      ws.send(JSON.stringify({ t: 'joined', code: room.code, pi: 0 }));
      broadcast(room);
    } else if (m.t === 'join') {
      const code = String(m.code || '').toLowerCase().replace(/[^a-z0-9]/g, '');
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
      broadcast(room);
    } else if (m.t === 'act') {
      const room = ws.room;
      if (!room || ws.pi == null) return;
      const a = String(m.a || '').slice(0, 20);
      const x = typeof m.x === 'number' || typeof m.x === 'string' ? (typeof m.x === 'string' ? m.x.slice(0, 20) : m.x) : null;
      const y = typeof m.y === 'number' || typeof m.y === 'string' ? (typeof m.y === 'string' ? m.y.slice(0, 20) : m.y) : null;
      try { room.E.doAction(ws.pi, a, x, y); } catch (e) { console.error('action failed', room.code, a, e); }
      scheduleBroadcast(room);
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
setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) { try { ws.terminate(); } catch (e) {} continue; }
    ws.isAlive = false;
    try { ws.ping(); } catch (e) {}
  }
}, 25000);

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

server.listen(PORT, () => console.log('Masked Spire listening on ' + PORT));
