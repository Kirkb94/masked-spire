/* Masked Spire game engine: rules, data and per-player views.
   Shared by the browser (solo runs) and the Render server (co-op matches).
   Each call to createEngine() is an independent game. */
(function (root) {
'use strict';
function createEngine(hooks) {
hooks = hooks || {};
const isReduce = () => !!hooks.reduce;

const baseRng = typeof hooks.rng === 'function' ? hooks.rng : Math.random;
let stream = null;
const rng = () => (stream ? stream() : baseRng());
function hashStr(s) { let h = 1779033703 ^ s.length; for (let i = 0; i < s.length; i++) { h = Math.imul(h ^ s.charCodeAt(i), 3432918353); h = (h << 13) | (h >>> 19); } return h >>> 0; }
function seedStream(key) {
  if (!key) { stream = null; return; }
  let a = hashStr(String(key));
  stream = () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const rnd = (a, b) => a + Math.floor(rng() * (b - a + 1));
const pick = a => a[Math.floor(rng() * a.length)];
function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
const wait = ms => new Promise(r => setTimeout(r, isReduce() ? Math.min(ms, 120) : ms));
/* Enemy-turn pacing (ms). footwork/footwork2: Duelist Flow->Block pauses; phase: after end turn;
   telegraph: enemy highlights before acting; after: lets damage numbers and bar drain finish;
   gap: beat between enemies; win: delay before the win screen. */
const PACE = {
  fast:   { footwork: 500,  footwork2: 200, phase: 200, telegraph: 250, after: 300, gap: 80,  win: 400 },
  normal: { footwork: 900,  footwork2: 350, phase: 350, telegraph: 450, after: 550, gap: 200, win: 650 },
  slow:   { footwork: 1300, footwork2: 500, phase: 500, telegraph: 650, after: 800, gap: 300, win: 900 }
};
function paceRow() {
  let k = typeof hooks.pace === 'function' ? hooks.pace() : hooks.pace;
  if (!PACE[k]) { try { k = typeof window !== 'undefined' && window.localStorage ? window.localStorage.getItem('ms_pace') : null; } catch (e) { k = null; } }
  return PACE[k] || PACE.normal;
}
let uidN = 1;
const mk = id => ({ u: uidN++, id });
const esc = s => String(s).replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
const ROMAN = ['I', 'II', 'III'];

/* ---------- Engine state (host only) ---------- */
let G = null;   // authoritative game state
let A = null;   // the side (player) currently acting
const C = () => G.combat;
const SF = () => A;
const P = pi => G.P[pi];
const hasR = (pi, r) => !!(G.P[pi] && G.P[pi].relics.includes(r));
const tagOf = t => t.isP ? 'p' + t.pi : 'e' + t.idx;
function fx(target, text, kind) {
  G.fxSeq = (G.fxSeq || 0) + 1;
  G.fx.push({ s: G.fxSeq, t: target, x: text, k: kind || '' });
  if (G.fx.length > 14) G.fx.splice(0, G.fx.length - 14);
  return G.fxSeq;
}
const float = (target, text, kind) => fx(target, text, kind);
function anim(side, k) { G.fxSeq++; side.animS = G.fxSeq; side.animK = k; }
function note(pi, text) { fx('n' + pi, text, ''); }
function banner(text) { fx('toast', text, ''); }
function aliveEnemies() { const c = G && G.combat; return c ? c.enemies.filter(e => !e.dead) : []; }
function aliveSides() { const c = G && G.combat; return c ? c.S.filter(s => !s.down) : []; }
function opp(s) { return C().S[1 - s.pi]; }
function foes() {
  const c = C();
  if (c.duel) { const o = opp(A); return o.down ? [] : [o]; }
  return aliveEnemies();
}
const alive = foes;
const heroName = pi => {
  const h = G.P[pi].hero; const base = h ? HEROES[h].n.replace('The ', '') : 'Player ' + (pi + 1);
  return G.P.length > 1 && G.P[0].hero === G.P[1].hero ? base + ' ' + (pi + 1) : base;
};
const nameOf = t => t.isP ? heroName(t.pi) : t.n;

/* ---------- Cards ---------- */
const CARDS = {
  /* Duelist */
  strike:    { n: 'Strike', c: 1, t: 'attack', tg: 1, d: 'Deal 7 damage.', p: e => hit(e, 7) },
  parry:     { n: 'Parry', c: 1, t: 'skill', d: 'Gain 6 Block.', p: () => gain(6) },
  lunge:     { n: 'Lunge', c: 1, t: 'attack', tg: 1, d: 'Deal 5 damage. Gain 1 extra Flow.', p: e => { hit(e, 5); SF().flow++; } },
  riposte:   { n: 'Riposte', c: 1, t: 'attack', tg: 1, d: 'Gain 5 Block. Deal 5 damage.', p: e => { gain(5); hit(e, 5); } },
  flurry:    { n: 'Flurry', c: 1, t: 'attack', tg: 1, d: 'Deal 2 damage 3 times.', p: e => hit(e, 2, 3) },
  needle:    { n: 'Needle', c: 0, t: 'attack', tg: 1, d: 'Deal 3 damage.', p: e => hit(e, 3) },
  feint:     { n: 'Feint', c: 0, t: 'skill', d: 'Gain 1 Flow. Draw 1 card.', p: () => { SF().flow++; draw(1); } },
  crescendo: { n: 'Crescendo', c: 2, t: 'attack', tg: 1, d: 'Deal 4 damage, plus 4 for each Flow.', live: s => 'Now: ' + (4 + 4 * s.flow) + ' damage', p: e => hit(e, 4 + 4 * SF().flow) },
  bladedance:{ n: 'Blade Dance', c: 2, t: 'attack', tg: 1, d: 'Deal 3 damage, 2 times plus once per Flow.', live: s => 'Now: ' + (2 + s.flow) + ' hits', p: e => hit(e, 3, 2 + SF().flow) },
  pinpoint:  { n: 'Pinpoint', c: 1, t: 'attack', tg: 1, d: 'Deal 7 damage. Apply 1 Vulnerable.', p: e => { hit(e, 7); debuffEnemy(e, 'vuln', 1); } },
  hamstring: { n: 'Hamstring', c: 1, t: 'attack', tg: 1, d: 'Deal 7 damage. Apply 1 Weak.', p: e => { hit(e, 7); debuffEnemy(e, 'weak', 1); } },
  whirl:     { n: 'Whirl', c: 1, t: 'attack', d: 'Deal 5 damage to ALL enemies.', p: () => foes().forEach(e => hit(e, 5)) },
  coup:      { n: 'Coup de Grâce', c: 2, t: 'attack', tg: 1, d: 'Deal 14 damage. Deals 22 if the enemy is below half HP.', p: e => hit(e, e.hp * 2 < e.max ? 22 : 14) },
  quickstep: { n: 'Quickstep', c: 1, t: 'skill', d: 'Gain 6 Block. Draw 1 card.', p: () => { gain(6); draw(1); } },
  secondwind:{ n: 'Second Wind', c: 1, t: 'skill', d: 'Gain 9 Block.', p: () => gain(9) },
  shadowstep:{ n: 'Shadowstep', c: 1, t: 'skill', x: 1, d: 'Gain 12 Block. Exhaust.', p: () => gain(12) },
  tempo:     { n: 'Tempo', c: 1, t: 'skill', d: 'Draw 2 cards. Gain 1 Flow.', p: () => { draw(2); SF().flow++; } },
  disarm:    { n: 'Disarm', c: 1, t: 'skill', tg: 1, x: 1, d: 'Enemy loses 2 Strength. Exhaust.', p: e => { e.str -= 2; float(tagOf(e), '−2 Strength', 'buff'); } },
  composure: { n: 'Composure', c: 1, t: 'power', d: 'At the start of each turn, gain 1 Flow.', p: () => { SF().composure++; } },
  momentum:  { n: 'Momentum', c: 0, t: 'skill', d: 'Gain 2 Flow.', p: () => { SF().flow += 2; float(tagOf(SF()), '+2 Flow', 'buff'); } },
  flowguard: { n: 'Flowing Guard', c: 1, t: 'skill', d: 'Gain 4 Block, plus 2 for each Flow.', live: s => 'Now: ' + (4 + 2 * s.flow) + ' Block', p: () => gain(4 + 2 * SF().flow) },
  ebb:       { n: 'Ebb and Draw', c: 0, t: 'skill', d: 'Draw 1 card, plus 1 for every 2 Flow.', live: s => 'Now: ' + (1 + Math.floor(s.flow / 2)) + ' cards', p: () => draw(1 + Math.floor(SF().flow / 2)) },
  cascade:   { n: 'Cascade', c: 1, t: 'attack', tg: 1, d: 'Deal 6 damage. If you have 3+ Flow, gain 1 Energy.', live: s => s.flow >= 3 ? 'Refunds Energy now' : 'Needs ' + (3 - s.flow) + ' more Flow', p: e => { const f = SF().flow; hit(e, 6); if (f >= 3) { SF().energy++; float(tagOf(SF()), '+1 Energy', 'buff'); } } },
  finale:    { n: 'Grand Finale', c: 1, t: 'attack', d: 'Spend all Flow. Deal 5 damage to ALL enemies for each Flow spent.', live: s => 'Now: ' + 5 * s.flow + ' to all', p: () => { const f = SF().flow; SF().flow = 0; if (f) foes().forEach(e => hit(e, 5 * f)); } },
  rhythm:    { n: 'Perfect Rhythm', c: 2, t: 'power', d: 'Your Attacks deal +1 damage for each Flow you have.', p: () => { SF().rhythm++; } },
  unbroken:  { n: 'Unbroken Stance', c: 1, t: 'power', d: 'At the start of your turn, keep half your Flow instead of losing it.', p: () => { SF().keep = 1; } },
  jab:       { n: 'Jab', c: 0, t: 'attack', tg: 1, d: 'Deal 4 damage. If you have 2+ Flow, draw 1 card.', live: s => s.flow >= 2 ? 'Draws a card now' : 'Needs ' + (2 - s.flow) + ' more Flow', p: e => { hit(e, 4); if (SF().flow >= 2) draw(1); } },
  sidestep:  { n: 'Sidestep', c: 1, t: 'skill', d: 'Gain 5 Block. Gain 1 Flow.', p: () => { gain(5); SF().flow++; float(tagOf(SF()), '+1 Flow', 'buff'); } },
  doublestrike: { n: 'Double Strike', c: 1, t: 'attack', tg: 1, d: 'Deal 5 damage twice. Gain 1 extra Flow.', p: e => { hit(e, 5, 2); SF().flow++; } },
  chainthrust:  { n: 'Chain Thrust', c: 1, t: 'attack', tg: 1, d: 'Deal 4 damage, plus 2 for each Flow.', live: s => 'Now: ' + (4 + 2 * s.flow) + ' damage', p: e => hit(e, 4 + 2 * SF().flow) },
  adrenaline:   { n: 'Adrenaline', c: 0, t: 'skill', x: 1, d: 'Gain 2 Flow. Gain 1 Energy. Exhaust.', p: () => { SF().flow += 2; SF().energy++; float(tagOf(SF()), '+2 Flow', 'buff'); } },
  thousandcuts: { n: 'Thousand Cuts', c: 2, t: 'attack', tg: 1, d: 'Deal 3 damage 3 times, plus once per Flow. Gain 2 Flow.', live: s => 'Now: ' + (3 + s.flow) + ' hits', p: e => { hit(e, 3, 3 + SF().flow); SF().flow += 2; } },

  /* Bulwark */
  bstrike:   { n: 'Strike', c: 1, t: 'attack', tg: 1, d: 'Deal 6 damage.', p: e => hit(e, 6) },
  defend:    { n: 'Defend', c: 1, t: 'skill', d: 'Gain 5 Block.', p: () => gain(5) },
  bash:      { n: 'Shield Bash', c: 1, t: 'attack', tg: 1, d: 'Deal damage equal to half your Block.', live: s => 'Now: ' + Math.floor(s.block / 2) + ' damage', p: e => hit(e, Math.floor(SF().block / 2)) },
  brace:     { n: 'Brace', c: 1, t: 'skill', d: 'Gain 7 Block.', p: () => gain(7) },
  ironwall:  { n: 'Iron Wall', c: 2, t: 'skill', d: 'Gain 12 Block.', p: () => gain(12) },
  rampart:   { n: 'Rampart', c: 1, t: 'power', d: 'At the end of your turn, gain 3 Block.', p: () => { SF().rampart++; } },
  reinforce: { n: 'Reinforce', c: 2, t: 'skill', x: 1, d: 'Double your Block. Exhaust.', live: s => 'Now: +' + s.block + ' Block', p: () => gain(SF().block, true) },
  counter:   { n: 'Counterweight', c: 1, t: 'attack', tg: 1, d: 'Deal 6 damage. Gain 4 Block.', p: e => { hit(e, 6); gain(4); } },
  bulldoze:  { n: 'Bulldoze', c: 2, t: 'attack', x: 1, d: 'Deal damage equal to half your Block to ALL enemies. Exhaust.', live: s => 'Now: ' + Math.floor(s.block / 2) + ' to all', p: () => { const b = Math.floor(SF().block / 2); foes().forEach(e => hit(e, b)); } },
  spikes:    { n: 'Spiked Plates', c: 1, t: 'power', d: 'Gain 3 Thorns: enemies that attack you take 3 damage.', p: () => { SF().thorns += 3; } },
  taunt:     { n: 'Taunt', c: 0, t: 'skill', d: 'Apply 1 Weak to ALL enemies. Gain 2 Block.', p: () => { foes().forEach(e => debuffEnemy(e, 'weak', 1)); gain(2); } },
  flare:     { n: 'Lantern Flare', c: 1, t: 'attack', d: 'Deal 4 damage to ALL enemies. Apply 1 Weak to ALL.', p: () => foes().forEach(e => { hit(e, 4); debuffEnemy(e, 'weak', 1); }) },
  bastion:   { n: 'Bastion', c: 3, t: 'power', d: 'Keep ALL your Block between turns.', p: () => { SF().keepAll = 1; } },
  chainlock: { n: 'Chain Lock', c: 1, t: 'skill', tg: 1, d: 'Apply 2 Weak. Gain 4 Block.', p: e => { debuffEnemy(e, 'weak', 2); gain(4); } },
  heavyswing:{ n: 'Heavy Swing', c: 2, t: 'attack', tg: 1, d: 'Deal 16 damage.', p: e => hit(e, 16) },
  endure:    { n: 'Endure', c: 1, t: 'skill', d: 'Gain 5 Block. Draw 1 card.', p: () => { gain(5); draw(1); } },
  ironresolve:{ n: 'Iron Resolve', c: 0, t: 'skill', x: 1, d: 'Gain 1 Energy. Gain 3 Block. Exhaust.', p: () => { SF().energy++; gain(3); } },
  barbedguard:{ n: 'Barbed Guard', c: 1, t: 'skill', d: 'Gain 5 Block. Gain 2 Thorns.', p: () => { gain(5); SF().thorns += 2; } },
  steelnerves:{ n: 'Steel Nerves', c: 0, t: 'skill', x: 1, d: 'Gain 4 Block. Draw 1 card. Exhaust.', p: () => { gain(4); draw(1); } },
  towershield:{ n: 'Tower Shield', c: 2, t: 'skill', d: 'Gain 10 Block. Apply 1 Weak to ALL enemies.', p: () => { gain(10); foes().forEach(e => debuffEnemy(e, 'weak', 1)); } },
  unyielding: { n: 'Unyielding', c: 1, t: 'skill', d: 'Gain 5 Block, plus 1 for every 4 Block you have.', live: s => 'Now: ' + (5 + Math.floor(s.block / 4)) + ' Block', p: () => gain(5 + Math.floor(SF().block / 4)) },
  fortresscrush:{ n: 'Fortress Crush', c: 2, t: 'attack', tg: 1, x: 1, d: 'Deal damage equal to your Block. Exhaust.', live: s => 'Now: ' + s.block + ' damage', p: e => hit(e, SF().block) },
  immovable:  { n: 'Immovable', c: 2, t: 'power', d: 'At the end of your turn, gain 6 Block.', p: () => { SF().rampart += 2; } },
  shoulderchk:{ n: 'Shoulder Check', c: 1, t: 'attack', tg: 1, d: 'Deal 5 damage. Apply 1 Vulnerable.', p: e => { hit(e, 5); debuffEnemy(e, 'vuln', 1); } },
  holdline:   { n: 'Hold the Line', c: 1, t: 'skill', d: 'Gain 8 Block. If you already have 10+ Block, gain 4 more.', live: s => s.block >= 10 ? 'Now: 12 Block' : 'Now: 8 Block', p: () => { const b = SF().block; gain(8); if (b >= 10) gain(4); } },
  siegeslam:  { n: 'Siege Slam', c: 2, t: 'attack', tg: 1, d: 'Deal 8 damage, plus 1 for every 4 Block you have.', live: s => 'Now: ' + (8 + Math.floor(s.block / 4)) + ' base', p: e => hit(e, 8 + Math.floor(SF().block / 4)) },
  spikedbulwark:{ n: 'Spiked Bulwark', c: 1, t: 'skill', d: 'Gain 6 Block. Gain 3 Thorns.', p: () => { gain(6); SF().thorns += 3; } },

  /* Brute */
  rstrike:   { n: 'Strike', c: 1, t: 'attack', tg: 1, d: 'Deal 7 damage.', p: e => hit(e, 7) },
  rdefend:   { n: 'Defend', c: 1, t: 'skill', d: 'Gain 5 Block.', p: () => gain(5) },
  bloodlet:  { n: 'Bloodletting', c: 0, t: 'skill', d: 'Lose 3 HP. Gain 2 Rage.', p: () => { selfHurt(3); addRage(2); } },
  haymaker:  { n: 'Haymaker', c: 2, t: 'attack', tg: 1, d: 'Deal 14 damage.', p: e => hit(e, 14) },
  cleave:    { n: 'Cleave', c: 1, t: 'attack', d: 'Deal 7 damage to ALL enemies.', p: () => foes().forEach(e => hit(e, 7)) },
  uppercut:  { n: 'Uppercut', c: 2, t: 'attack', tg: 1, d: 'Deal 12 damage. Apply 1 Weak and 1 Vulnerable.', p: e => { hit(e, 12); debuffEnemy(e, 'weak', 1); debuffEnemy(e, 'vuln', 1); } },
  warcry:    { n: 'War Cry', c: 1, t: 'skill', d: 'Gain 3 Rage. Draw 1 card.', p: () => { addRage(3); draw(1); } },
  frenzy:    { n: 'Frenzy', c: 1, t: 'attack', tg: 1, d: 'Deal 3 damage 4 times.', p: e => hit(e, 3, 4) },
  headbutt:  { n: 'Headbutt', c: 1, t: 'attack', tg: 1, d: 'Deal 9 damage. Gain 1 Rage.', p: e => { hit(e, 9); addRage(1); } },
  reckless:  { n: 'Reckless Charge', c: 0, t: 'attack', tg: 1, d: 'Deal 9 damage. Add a Dazed to your discard pile.', p: e => { hit(e, 9); SF().discard.push(mk('dazed')); } },
  bloodpact: { n: 'Blood Pact', c: 1, t: 'power', d: 'Whenever you gain Rage from Bloodlust or lose HP to your own cards, gain 1 extra Rage.', p: () => { SF().bloodpact++; } },
  unstoppable:{ n: 'Unstoppable', c: 1, t: 'power', d: 'At the start of your turn, gain 2 Rage.', p: () => { SF().ragegain += 2; } },
  rampage:   { n: 'Rampage', c: 1, t: 'attack', tg: 1, d: 'Deal 5 damage, plus 3 for each Rage.', live: s => 'Now: ' + (5 + 3 * s.rage) + ' base', p: e => hit(e, 5 + 3 * SF().rage) },
  ironhide:  { n: 'Iron Hide', c: 1, t: 'skill', d: 'Gain 10 Block.', p: () => gain(10) },
  intimidate:{ n: 'Intimidate', c: 0, t: 'skill', x: 1, d: 'ALL enemies lose 1 Strength. Exhaust.', p: () => foes().forEach(e => { e.str -= 1; float(tagOf(e), '−1 Strength', 'buff'); }) },
  feast:     { n: 'Feast', c: 2, t: 'attack', tg: 1, x: 1, d: 'Deal 18 damage. If this kills, heal 8 HP. Exhaust.', p: e => { hit(e, 18); if (e.dead || e.down) heal(8); } },
  braceimpact:{ n: 'Brace for Impact', c: 1, t: 'skill', d: 'Gain 6 Block, plus 1 for each Rage.', live: s => 'Now: ' + (6 + s.rage) + ' Block', p: () => gain(6 + SF().rage) },
  ragejab:   { n: 'Rage Jab', c: 0, t: 'attack', tg: 1, d: 'Deal 4 damage. Gain 1 Rage.', p: e => { hit(e, 4); addRage(1); } },
  battleroar:{ n: 'Battle Roar', c: 1, t: 'skill', d: 'Gain 2 Rage. Gain 4 Block.', p: () => { addRage(2); gain(4); } },
  crushblow: { n: 'Crushing Blow', c: 2, t: 'attack', tg: 1, d: 'Deal 8 damage, plus 2 for each Rage.', live: s => 'Now: ' + (8 + 2 * s.rage) + ' base', p: e => hit(e, 8 + 2 * SF().rage) },
  shiftguard:{ n: 'Shifting Guard', c: 1, t: 'skill', d: 'Gain 4 Block, plus 3 for each stance switch this turn.', live: s => 'Now: ' + (4 + 3 * (s.sw || 0)) + ' Block', p: () => gain(4 + 3 * SF().switches) },

  /* Brute: stances */
  eruption:  { n: 'Eruption', c: 2, t: 'attack', tg: 1, d: 'Deal 9 damage. Enter Fury.', p: e => { hit(e, 9); enterStance('fury'); } },
  innerpeace:{ n: 'Inner Peace', c: 1, t: 'skill', d: 'Gain 5 Block. Enter Calm.', p: () => { gain(5); enterStance('calm'); } },
  ironform:  { n: 'Iron Form', c: 1, t: 'skill', d: 'Gain 7 Block. Enter Iron.', p: () => { gain(7); enterStance('iron'); } },
  wildswing: { n: 'Wild Swing', c: 1, t: 'attack', tg: 1, d: 'Deal 8 damage. Enter Fury.', p: e => { hit(e, 8); enterStance('fury'); } },
  breathe:   { n: 'Breathe', c: 0, t: 'skill', d: 'Enter Calm.', p: () => enterStance('calm') },
  formbreak: { n: 'Form Break', c: 1, t: 'attack', tg: 1, d: 'Deal 6 damage, plus 6 for each stance switch this turn.', live: s => 'Now: ' + (6 + 6 * (s.sw || 0)) + ' base', p: e => hit(e, 6 + 6 * SF().switches) },
  tidal:     { n: 'Tidal Shift', c: 1, t: 'skill', d: 'If you are in Fury, enter Calm. Otherwise enter Fury. Gain 4 Block.', live: s => s.stance === 'fury' ? 'Now: enters Calm' : 'Now: enters Fury', p: () => { gain(4); enterStance(SF().stance === 'fury' ? 'calm' : 'fury'); } },
  avalanche: { n: 'Avalanche', c: 2, t: 'attack', d: 'Deal 7 damage to ALL enemies, once plus once more per stance switch this turn.', live: s => 'Now: ' + (1 + (s.sw || 0)) + ' hits', p: () => { const n = 1 + SF().switches; foes().forEach(e => hit(e, 7, n)); } },
  mantra:    { n: 'Mantra of War', c: 1, t: 'power', d: 'Whenever you switch stance, deal 4 damage to ALL enemies.', p: () => { SF().mantra += 4; } },
  serenity:  { n: 'Serenity', c: 1, t: 'power', d: 'Whenever you leave Calm, also draw 2 cards.', p: () => { SF().serenity += 2; } },
  bastionform:{ n: 'Unbreakable', c: 2, t: 'power', d: 'Iron gives 4 more Block each turn, and no longer lowers your Attack damage.', p: () => { SF().ironplus += 4; } },
  pivotstrike:{ n: 'Pivot Strike', c: 1, t: 'attack', tg: 1, d: 'Deal 6 damage. If you switched stance this turn, deal 12 instead.', live: s => 'Now: ' + ((s.sw || 0) > 0 ? 12 : 6) + ' base', p: e => hit(e, SF().switches > 0 ? 12 : 6) },
  footwork:  { n: 'Footwork', c: 0, t: 'skill', d: 'Gain 3 Block. Enter Iron.', p: () => { gain(3); enterStance('iron'); } },
  risingfury:{ n: 'Rising Fury', c: 1, t: 'skill', d: 'Gain 2 Rage. Enter Fury.', p: () => { addRage(2); enterStance('fury'); } },
  guardrotation:{ n: 'Guard Rotation', c: 1, t: 'skill', d: 'Gain 6 Block. If you switched stance this turn, gain 12 instead. Enter Iron.', live: s => 'Now: ' + ((s.sw || 0) > 0 ? 12 : 6) + ' Block', p: () => { gain(SF().switches > 0 ? 12 : 6); enterStance('iron'); } },
  shatterform:{ n: 'Shatter Form', c: 2, t: 'attack', tg: 1, d: 'Deal 10 damage. If you are in Fury, gain 8 Block and enter Iron.', p: e => { const f = SF().stance === 'fury'; hit(e, 10); if (f) { gain(8); enterStance('iron'); } } },
  fullcycle: { n: 'Full Cycle', c: 1, t: 'skill', x: 1, d: 'Enter Fury, then Iron, then Calm. Exhaust.', p: () => { enterStance('fury'); enterStance('iron'); enterStance('calm'); } },

  /* Elementalist */
  estrike:   { n: 'Stone Strike', c: 1, t: 'attack', tg: 1, d: 'Deal 6 damage.', p: e => hit(e, 6) },
  sparkjolt: { n: 'Spark Jolt', c: 1, t: 'attack', tg: 1, d: 'Deal 5 damage. Apply 2 Shock.', p: e => { hit(e, 5); debuffEnemy(e, 'shock', 2); } },
  eguard:    { n: 'Ward', c: 1, t: 'skill', d: 'Gain 5 Block.', p: () => gain(5) },
  emberlash: { n: 'Ember Lash', c: 1, t: 'attack', tg: 1, d: 'Deal 4 damage. Apply 3 Burn.', p: e => { hit(e, 4); debuffEnemy(e, 'burn', 3); } },
  rimespiral:{ n: 'Rime Spiral', c: 1, t: 'attack', tg: 1, d: 'Deal 5 damage. Apply 3 Chill.', p: e => { hit(e, 5); debuffEnemy(e, 'chill', 3); } },
  cinderbolt:{ n: 'Cinder Bolt', c: 0, t: 'attack', tg: 1, d: 'Deal 4 damage. Apply 2 Burn.', p: e => { hit(e, 4); debuffEnemy(e, 'burn', 2); } },
  scorch:    { n: 'Scorch', c: 1, t: 'attack', tg: 1, d: 'Deal 9 damage. Apply 3 Burn.', p: e => { hit(e, 9); debuffEnemy(e, 'burn', 3); } },
  frostward: { n: 'Frost Ward', c: 1, t: 'skill', d: 'Gain 8 Block.', p: () => gain(8) },
  gust:      { n: 'Gust Step', c: 1, t: 'skill', d: 'Gain 5 Block. Draw 1 card.', p: () => { gain(5); draw(1); } },
  icelance:  { n: 'Ice Lance', c: 1, t: 'attack', tg: 1, d: 'Deal 7 damage. Apply 3 Chill.', p: e => { hit(e, 7); debuffEnemy(e, 'chill', 3); } },
  stormcrash:{ n: 'Stormstone Crash', c: 2, t: 'attack', d: 'Apply 2 Shock to ALL enemies, then deal 11 damage to ALL enemies.', p: () => foes().forEach(e => { debuffEnemy(e, 'shock', 2); hit(e, 11); }) },
  rimeshroud:{ n: 'Rime Shroud', c: 1, t: 'skill', d: 'Gain 8 Block. Apply 2 Chill to ALL enemies.', p: () => { foes().forEach(e => { debuffEnemy(e, 'chill', 2); }); gain(8); } },
  tempest:   { n: 'Tempest', c: 2, t: 'attack', d: 'Apply 2 Shock to ALL enemies, then deal 6 damage to ALL enemies twice.', p: () => foes().forEach(e => { debuffEnemy(e, 'shock', 2); hit(e, 6, 2); }) },
  stonemask: { n: 'Stonebound Mask', c: 1, t: 'power', d: 'At the end of your turn, gain 3 Block.', p: () => { SF().rampart++; } },
  kindle:    { n: 'Kindle', c: 1, t: 'attack', tg: 1, d: 'Deal 5 damage. Apply 2 Burn. If you switched element, apply 3 more Burn.', p: e => { hit(e, 5); debuffEnemy(e, 'burn', elSwitched() ? 5 : 2); } },
  staticedge:{ n: 'Static Edge', c: 1, t: 'attack', tg: 1, d: 'Deal 5 damage. Apply 1 Shock. If you repeated the last element, deal 5 more damage.', p: e => { hit(e, elRepeated() ? 10 : 5); debuffEnemy(e, 'shock', 1); } },
  shardfall: { n: 'Shardfall', c: 1, t: 'attack', tg: 1, d: 'Deal 6 damage. If you switched element, gain 5 Block.', p: e => { hit(e, 6); if (elSwitched()) gain(5); } },
  thermalshock:{ n: 'Thermal Shock', c: 1, t: 'attack', tg: 1, d: 'Deal 6 damage. Apply 3 Burn. If the last element was Frost, deal 8 more damage.', p: e => { hit(e, SF().elPrev === 'frost' ? 14 : 6); debuffEnemy(e, 'burn', 3); } },
  chainbolt: { n: 'Chain Lightning', c: 1, t: 'attack', d: 'Deal 4 damage to ALL enemies. Apply 1 Shock to ALL. If you repeated the last element, hit twice.', p: () => { const n = elRepeated() ? 2 : 1; foes().forEach(e => { debuffEnemy(e, 'shock', 1); hit(e, 4, n); }); } },
  prismsurge:{ n: 'Prismatic Surge', c: 2, t: 'attack', d: 'Deal 8 damage to ALL enemies. If you switched element, gain 1 Energy and draw 1 card.', p: () => { const sw = elSwitched(); foes().forEach(e => hit(e, 8)); if (sw) { SF().energy++; float(tagOf(SF()), '+1 Energy', 'buff'); draw(1); } } },
  smolder:   { n: 'Smolder', c: 1, t: 'attack', tg: 1, d: 'Deal 4 damage. Apply 2 Burn. If you repeated the last element, apply 3 more Burn.', p: e => { hit(e, 4); debuffEnemy(e, 'burn', elRepeated() ? 5 : 2); } },
  hoarfrost: { n: 'Hoarfrost', c: 1, t: 'attack', tg: 1, d: 'Deal 5 damage. Apply 2 Chill. If you repeated the last element, gain 4 Block.', p: e => { const rp = elRepeated(); hit(e, 5); debuffEnemy(e, 'chill', 2); if (rp) gain(4); } },
  arcflash:  { n: 'Arc Flash', c: 0, t: 'attack', tg: 1, d: 'Deal 3 damage. Apply 1 Shock. If you switched element, draw 1 card.', p: e => { const sw = elSwitched(); hit(e, 3); debuffEnemy(e, 'shock', 1); if (sw) draw(1); } },
  tectonic:  { n: 'Tectonic Slam', c: 2, t: 'attack', tg: 1, d: 'Deal 12 damage. If you switched element, gain 8 Block.', p: e => { const sw = elSwitched(); hit(e, 12); if (sw) gain(8); } },
  resonant:  { n: 'Resonant Strike', c: 1, t: 'attack', tg: 1, d: 'Deal 7 damage. If you repeated the last element, deal 5 more damage. If you switched element, gain 1 Energy.', p: e => { const rp = elRepeated(), sw = elSwitched(); hit(e, rp ? 12 : 7); if (sw) { SF().energy++; float(tagOf(SF()), '+1 Energy', 'buff'); } } },
  eternalflame:{ n: 'Eternal Flame', c: 1, t: 'attack', tg: 1, d: 'Deal 6 damage. Apply 4 Burn. If you repeated the last element, apply 8 Burn instead. If you switched element, draw 2 cards.', p: e => { const rp = elRepeated(), sw = elSwitched(); hit(e, 6); debuffEnemy(e, 'burn', rp ? 8 : 4); if (sw) draw(2); } },
  flamewheel:{ n: 'Flame Wheel', c: 1, t: 'attack', tg: 1, d: 'Deal 3 damage twice. Apply 1 Burn. If you repeated the last element, hit 3 times.', p: e => { const n = elRepeated() ? 3 : 2; hit(e, 3, n); debuffEnemy(e, 'burn', 1); } },
  coldsnap:  { n: 'Cold Snap', c: 0, t: 'attack', tg: 1, d: 'Deal 3 damage. Apply 2 Chill. If you switched element, gain 4 Block.', p: e => { const sw = elSwitched(); hit(e, 3); debuffEnemy(e, 'chill', 2); if (sw) gain(4); } },
  superconduct:{ n: 'Superconduct', c: 1, t: 'attack', tg: 1, d: 'Deal 6 damage. Apply 2 Shock. If the last element was Frost, apply 3 more Shock.', p: e => { hit(e, 6); debuffEnemy(e, 'shock', SF().elPrev === 'frost' ? 5 : 2); } },
  overload:  { n: 'Overload', c: 1, t: 'attack', tg: 1, d: 'Deal 4 damage. Apply 2 Shock. If you repeated the last element, apply 3 more Shock.', p: e => { hit(e, 4); debuffEnemy(e, 'shock', elRepeated() ? 5 : 2); } },
  glaciercrush:{ n: 'Glacial Crush', c: 2, t: 'attack', tg: 1, d: 'Deal 10 damage. Apply 2 Chill. If the last element was Fire, deal 8 more damage.', p: e => { hit(e, SF().elPrev === 'fire' ? 18 : 10); debuffEnemy(e, 'chill', 2); } },
  wildfire:  { n: 'Wildfire', c: 2, t: 'attack', d: 'Deal 5 damage to ALL enemies. Apply 2 Burn to ALL. If you repeated the last element, apply 5 Burn instead.', p: () => { const n = elRepeated() ? 5 : 2; foes().forEach(e => { hit(e, 5); debuffEnemy(e, 'burn', n); }); } },
  blizzard:  { n: 'Blizzard', c: 2, t: 'attack', d: 'Deal 6 damage to ALL enemies. Apply 2 Chill to ALL. If you switched element, draw 2 cards.', p: () => { const sw = elSwitched(); foes().forEach(e => { hit(e, 6); debuffEnemy(e, 'chill', 2); }); if (sw) draw(2); } },
  convergence:{ n: 'Convergence', c: 1, t: 'attack', tg: 1, d: 'Deal 4 damage, plus 3 for each different element you have attacked with this combat.', live: s => 'Now: ' + (4 + 3 * ((s.elu || []).length)) + ' damage', p: e => hit(e, 4 + 3 * ((SF().elu || []).length)) },

  /* Colorless (any hero) */
  wayfarer:  { n: 'Wayfarer’s Strike', c: 1, t: 'attack', tg: 1, d: 'Deal 5 damage. Draw 1 card.', p: e => { hit(e, 5); draw(1); } },
  oilcloak:  { n: 'Oilcloth Cloak', c: 1, t: 'skill', tg: 1, d: 'Gain 4 Block. Apply 1 Vulnerable.', p: e => { gain(4); debuffEnemy(e, 'vuln', 1); } },
  secondspark: { n: 'Second Spark', c: 0, t: 'skill', x: 1, d: 'Gain 1 Energy. Draw 1 card. Exhaust.', p: () => { SF().energy++; float(tagOf(SF()), '+1 Energy', 'buff'); draw(1); } },
  spiresweep: { n: 'Spire Sweep', c: 2, t: 'attack', d: 'Deal 9 damage to ALL enemies.', p: () => foes().forEach(e => hit(e, 9)) },
  maskshard: { n: 'Mask Shard', c: 2, t: 'attack', tg: 1, d: 'Deal 12 damage. Apply 1 Weak and 1 Vulnerable.', p: e => { hit(e, 12); debuffEnemy(e, 'weak', 1); debuffEnemy(e, 'vuln', 1); } },
  hollowreserve: { n: 'Hollow Reserve', c: 2, t: 'skill', x: 1, d: 'Gain 15 Block. Draw 2 cards. Exhaust.', p: () => { gain(15); draw(2); } },

  /* Status and curses */
  dazed:     { n: 'Dazed', c: -1, t: 'status', eth: 1, d: 'Unplayable. Exhausts at end of turn.' },
  doombell:  { n: 'Doom Bell', c: 1, t: 'status', x: 1, d: 'Exhaust. After Final Toll, deals 5 damage to you at end of turn while held.', p: () => {} },
  burn:      { n: 'Burn', c: -1, t: 'status', d: 'Unplayable. At end of turn, if this is in your hand, take 3 damage.' },
  fate:      { n: 'Fate', c: -1, t: 'status', curse: 1, d: 'Curse. Unplayable. Stays in your deck until removed.' },
  void:      { n: 'Void', c: -1, t: 'status', eth: 1, d: 'Unplayable. When drawn, lose 1 Energy. Exhausts at end of turn.' }
};

/* ---------- Rarity ---------- */
const RAR = {
  /* starter cards */
  strike: 'c', parry: 'c', lunge: 'c', riposte: 'c', bstrike: 'c', defend: 'c', bash: 'c', brace: 'c', rstrike: 'c', rdefend: 'c', bloodlet: 'c', haymaker: 'c',
  flurry: 'c', needle: 'c', feint: 'c', pinpoint: 'c', hamstring: 'c', quickstep: 'c', secondwind: 'c',
  whirl: 'u', coup: 'u', shadowstep: 'u', tempo: 'u', disarm: 'u', momentum: 'u', flowguard: 'u', ebb: 'u', cascade: 'u', crescendo: 'u', bladedance: 'u',
  composure: 'r', rhythm: 'r', unbroken: 'r', finale: 'r',
  jab: 'c', sidestep: 'c', doublestrike: 'u', chainthrust: 'u', adrenaline: 'u', thousandcuts: 'r',
  counter: 'c', taunt: 'c', heavyswing: 'c', endure: 'c', chainlock: 'c', flare: 'c',
  ironwall: 'u', spikes: 'u', ironresolve: 'u', rampart: 'u',
  reinforce: 'r', bulldoze: 'r', bastion: 'r',
  barbedguard: 'c', steelnerves: 'c', towershield: 'u', unyielding: 'u', fortresscrush: 'r', immovable: 'r',
  shoulderchk: 'c', holdline: 'c', siegeslam: 'u', spikedbulwark: 'u',
  ragejab: 'c', battleroar: 'c', crushblow: 'u', shiftguard: 'u',
  cleave: 'c', headbutt: 'c', ironhide: 'c', frenzy: 'c', reckless: 'c', braceimpact: 'c',
  uppercut: 'u', warcry: 'u', intimidate: 'u', feast: 'u',
  rampage: 'r', bloodpact: 'r', unstoppable: 'r',
  eruption: 'c', innerpeace: 'c', ironform: 'c', wildswing: 'c', breathe: 'c',
  formbreak: 'u', tidal: 'u',
  avalanche: 'r', mantra: 'r', serenity: 'r', bastionform: 'r',
  pivotstrike: 'c', footwork: 'c', risingfury: 'c', guardrotation: 'u', shatterform: 'u', fullcycle: 'r',
  estrike: 'c', sparkjolt: 'c', eguard: 'c', emberlash: 'c', rimespiral: 'c', cinderbolt: 'c', scorch: 'c', frostward: 'c', gust: 'c',
  kindle: 'c', staticedge: 'c', smolder: 'c', hoarfrost: 'c', arcflash: 'c',
  tectonic: 'u', resonant: 'u', eternalflame: 'r',
  flamewheel: 'c', coldsnap: 'c', superconduct: 'u', overload: 'u', glaciercrush: 'u', wildfire: 'u', blizzard: 'r', convergence: 'r',
  icelance: 'u', stormcrash: 'u', rimeshroud: 'u',
  shardfall: 'u', thermalshock: 'u', chainbolt: 'u',
  tempest: 'r', stonemask: 'r', prismsurge: 'r',
  /* colorless */
  wayfarer: 'c', oilcloak: 'c', secondspark: 'u', spiresweep: 'u', maskshard: 'u', hollowreserve: 'r'
};
const RAR_NAME = { c: 'Common', u: 'Uncommon', r: 'Rare' };
const RAR_ODDS = { fight: [62, 32, 6], elite: [40, 45, 15], shop: [55, 35, 10], boss: [0, 50, 50] };
const PRICE = { c: [45, 55], u: [68, 82], r: [130, 150] };
/* Colorless cards offered to every hero in rewards and shops */
const NEUTRAL = ['wayfarer', 'oilcloak', 'secondspark', 'spiresweep', 'maskshard', 'hollowreserve'];


/* ---------- Heroes ---------- */
const HEROES = {
  duelist: {
    n: 'The Duelist', tag: 'Slim · speed & combos', hp: 85, relic: 'mask', color: '#1C6670', edge: '#2E8E99',
    passive: 'Footwork: each Attack you play gives 1 Flow. At end of turn, each Flow becomes 2 Block.',
    starter: ['strike', 'strike', 'strike', 'strike', 'parry', 'parry', 'parry', 'parry', 'lunge', 'riposte'],
    pool: ['flurry', 'needle', 'feint', 'crescendo', 'bladedance', 'pinpoint', 'hamstring', 'whirl', 'coup', 'quickstep', 'secondwind', 'shadowstep', 'tempo', 'disarm', 'composure', 'momentum', 'flowguard', 'ebb', 'cascade', 'finale', 'rhythm', 'unbroken', 'jab', 'sidestep', 'doublestrike', 'chainthrust', 'adrenaline', 'thousandcuts'],
    style: 'Chain cheap Attacks to build Flow, then cash it in or let Footwork turn it into Block.'
  },
  bulwark: {
    n: 'The Bulwark', tag: 'Heavy · block & endure', hp: 95, relic: 'lanternhelm', color: '#B4561B', edge: '#D07228',
    passive: 'Iron Shell: at the start of your turn, keep half your Block instead of losing it.',
    starter: ['bstrike', 'bstrike', 'bstrike', 'bstrike', 'defend', 'defend', 'defend', 'defend', 'bash', 'brace'],
    pool: ['ironwall', 'rampart', 'reinforce', 'counter', 'bulldoze', 'spikes', 'taunt', 'flare', 'bastion', 'chainlock', 'heavyswing', 'endure', 'ironresolve', 'barbedguard', 'steelnerves', 'towershield', 'unyielding', 'fortresscrush', 'immovable', 'shoulderchk', 'holdline', 'siegeslam', 'spikedbulwark'],
    style: 'Stack Block that carries over between turns. Shield Bash turns half of it into damage, so you need a big wall first.'
  },
  brute: {
    n: 'The Brute', tag: 'Muscular · stances', hp: 90, relic: 'hornedmask', color: '#7E1B26', edge: '#B53A44',
    passive: 'Warrior Forms: switch between three stances. Fury: Attacks deal 50% more, you take 25% more. Iron: +4 Block at end of turn, Attacks deal 25% less. Calm: leaving it gives +2 Energy. Every switch draws a card.',
    starter: ['rstrike', 'rstrike', 'rstrike', 'rstrike', 'rdefend', 'rdefend', 'rdefend', 'rdefend', 'eruption', 'innerpeace'],
    pool: ['cleave', 'frenzy', 'ironhide', 'reckless', 'ironform', 'wildswing', 'breathe', 'uppercut', 'intimidate', 'feast', 'formbreak', 'tidal', 'avalanche', 'mantra', 'serenity', 'bastionform', 'pivotstrike', 'footwork', 'risingfury', 'guardrotation', 'shatterform', 'fullcycle', 'ragejab', 'battleroar', 'crushblow', 'shiftguard'],
    style: 'Bank Energy in Calm, cash it out in Fury, and drop into Iron before the big hits land.'
  },
  elementalist: {
    n: 'The Elementalist', tag: 'Masked · four elements', hp: 80, relic: 'quadmask', color: '#2C1F55', edge: '#5B448F',
    passive: 'Quadrant Mask: each Attack you play gives 1 Block (not reduced by Frail).',
    starter: ['emberlash', 'rimespiral', 'sparkjolt', 'estrike', 'eguard', 'eguard', 'eguard', 'eguard', 'eguard', 'eguard'],
    pool: ['cinderbolt', 'scorch', 'frostward', 'gust', 'icelance', 'stormcrash', 'rimeshroud', 'tempest', 'stonemask', 'kindle', 'staticedge', 'shardfall', 'thermalshock', 'chainbolt', 'prismsurge', 'smolder', 'hoarfrost', 'arcflash', 'tectonic', 'resonant', 'eternalflame', 'flamewheel', 'coldsnap', 'superconduct', 'overload', 'glaciercrush', 'wildfire', 'blizzard', 'convergence'],
    style: 'Fire, frost, storm and stone. Chain cheap Attacks so the mask turns every swing into Block. Fire burns, frost chills (weaker enemy attacks), storm shocks (bonus damage), stone guards.'
  }
};

/* ---------- Relics ---------- */
const RELICS = {
  mask:        { n: 'Cracked Mask', d: 'Start each combat with 1 Flow on your first turn.', start: 1 },
  lanternhelm: { n: 'Lantern Helm', d: 'Start each combat with 8 Block.', start: 1 },
  hornedmask:  { n: 'Horned Mask', d: 'Start each combat in Calm stance.', start: 1 },
  quadmask:    { n: 'Quadrant Mask', d: 'Start each combat with 5 Block. Your opening hand always holds one Fire, one Frost, one Storm and one Stone attack (a basic one is conjured if your deck lacks it).', start: 1 },
  whetstone:   { n: 'Whetstone', d: 'Your Attacks deal 1 extra damage per hit.' },
  locket:      { n: 'Iron Locket', d: 'Start each combat with 6 Block.' },
  hourglass:   { n: 'Sand Hourglass', d: 'Draw 2 extra cards on your first turn.' },
  ember:       { n: 'Ember Ring', d: 'Heal 5 HP after each combat.' },
  quill:       { n: 'Golden Quill', d: 'Gain 1 extra Energy on your first turn.' },
  heartstone:  { n: 'Heartstone', d: 'Raise your Max HP by 12 when picked up.' },
  thornring:   { n: 'Thorn Ring', d: 'Start each combat with 2 Thorns.' },
  bellshard:   { n: 'Bell Shard', d: 'Enemies start each combat with 1 Vulnerable.' },
  cinder:      { n: 'Cinder Charm', d: 'Start each combat with 1 Strength.' },
  satchel:     { n: 'Gilded Satchel', d: 'Gain 30 gold when picked up.' },
  tonic:       { n: 'Bitter Tonic', d: 'Heal 15 HP when picked up.' },
  bountypouch: { n: 'Bounty Pouch', d: 'Gain 3 gold each time you kill an enemy.' },
  carrion:     { n: 'Carrion Charm', d: 'Heal 2 HP each time you kill an enemy.' },
  thimble:     { n: 'Hex Thimble', d: 'Enemies start each combat with 1 Weak.' },
  pocket:      { n: 'Stitched Pocket', d: 'Gain 4 Block after drawing your hand at the start of each turn.' },
  spurboots:   { n: 'Spurred Boots', d: 'Gain 1 extra Energy on your first turn against an Elite or Boss.' },
  ribbon:      { n: 'Silk Ribbon', d: 'Boss relic. Draw 1 extra card every turn.', boss: 1 },
  ironbark:    { n: 'Ironbark Charm', d: 'Start each combat with 3 Thorns.' },
  luckycoin:   { n: 'Lucky Coin', d: 'Gain 10 gold after each combat.' },
  stormglass:  { n: 'Stormglass', d: 'Enemies start each combat with 1 Shock.' },
  wardenseal:  { n: 'Warden\'s Seal', d: 'Boss relic. Start each combat with 12 Block.', boss: 1 },
  bonecrown:   { n: 'Bone Crown', d: 'Boss relic. Start each combat with 2 Strength.', boss: 1 },
  aegisplate:  { n: 'Aegis Plate', d: 'Boss relic. Gain 8 Block at the start of every turn.', boss: 1 },
  bloodchalice:{ n: 'Blood Chalice', d: 'Boss relic. Heal 8 extra HP after each combat.', boss: 1 },
  tallowcandle:{ n: 'Tallow Candle', d: 'Heal 3 HP at the start of each combat.' },
  brasscompass:{ n: 'Brass Compass', d: 'On your first turn, draw 1 extra card and gain 3 Block.' },
  vigilbell:   { n: 'Vigil Bell', d: 'Gain 4 Block at the start of every turn after the first.' },
  ravenfeather:{ n: 'Raven Feather', d: 'Gain 1 Strength on your first turn against an Elite or Boss.' },
  obsidianeye: { n: 'Obsidian Eye', d: 'Boss relic. Enemies start each combat with 2 Vulnerable and 1 Weak.', boss: 1 },
  phoenixash:  { n: 'Phoenix Ash', d: 'Boss relic. Heal 3 HP at the start of every turn.', boss: 1 }
};

/* ---------- Enemies ---------- */
const EN = {
  /* Act I */
  moth:     { n: 'Lantern Moth', hp: [12, 14], bg: '#1F5F55', idle: 'flutter', pat: [{ k: 'debuff', weak: 1, l: 'Flicker' }, { k: 'atk', dmg: 5, l: 'Wing Slash' }], note: 'On death: adds a Dazed to your discard pile.' },
  rootling: { n: 'Rootling', hp: [17, 19], bg: '#23584A', pat: [{ k: 'block', v: 8, root: 1, l: 'Burrow' }, { k: 'atk', dmg: 5, l: 'Lash' }], note: 'Rooted: takes half damage until its next turn.' },
  crow:     { n: 'Masked Crow', hp: [14, 16], bg: '#1A4E58', pat: [{ k: 'atk', dmg: 3, hits: 2, steal: 2, l: 'Peck' }], note: 'Steals 2 gold per unblocked hit. Returns it if killed.' },
  leech:    { n: 'Bog Leech', hp: [19, 21], bg: '#2E4A30', pat: [{ k: 'atk', dmg: 5, heal: 4, l: 'Latch' }, { k: 'atk', dmg: 5, heal: 4, l: 'Latch' }, { k: 'block', v: 6, root: 1, l: 'Submerge' }], note: 'Heals 4 each time it Latches. Submerge roots it: half damage.' },
  imp:      { n: 'Thorn Imp', hp: [15, 17], bg: '#3A5228', pat: [{ k: 'atk', dmg: 7, l: 'Jab' }, { k: 'buff', thorns: 2, l: 'Bristle' }], note: 'Thorns: you take damage for every hit you land.' },
  acolyte:  { n: 'Candle Acolyte', hp: [21, 23], bg: '#2A4652', pat: [{ k: 'buff', ally: 2, l: 'Kindle' }, { k: 'atk', dmg: 4, l: 'Singe' }], note: 'Kindle gives every other enemy +2 Strength.' },
  ogre:     { n: 'Mossback Ogre', hp: [70, 74], bg: '#2C4A2A', elite: 1, pat: [{ k: 'atk', dmg: 13, l: 'Smash' }, { k: 'atk', dmg: 13, l: 'Smash' }, { k: 'buff', str: 3, l: 'Bellow' }], note: 'Enrage: +2 Strength whenever you play a Skill.' },
  puppet:   { n: 'Puppeteer', names: ['Puppeteer of Mirth', 'Puppeteer of Sorrow'], hp: [33, 35], bg: '#3A3050', elite: 1, idle: 'sway', pat: [{ k: 'atk', mimic: 1, l: 'Mimic' }, { k: 'atk', dmg: 6, hits: 2, l: 'Cut' }], note: 'Mimic copies your last Attack. Kill one and the other gains 5 Strength.' },
  stag:     { n: 'Hollow Stag', hp: [82, 86], bg: '#1E3E3A', elite: 1, pat: [{ k: 'block', v: 12, l: 'Antler Guard' }, { k: 'atk', dmg: 9, l: 'Gore' }, { k: 'atk', dmg: 20, l: 'CHARGE' }], note: 'The Charge is always telegraphed a turn early.' },
  bell:     { n: 'The Weeping Bellwarden', hp: [180, 180], bg: '#173A44', boss: 1, idle: 'sway', pat: [{ k: 'status', card: 'doombell', v: 2, l: 'Toll' }, { k: 'atk', dmg: 18, l: 'Slam' }, { k: 'atk', dmg: 6, hits: 3, l: 'Peal' }], note: 'At half HP: Final Toll. Each Doom Bell in hand deals 5 damage at end of turn.' },
  toad:     { n: 'Gloam Toad', art: 'leech', hp: [22, 25], bg: '#2A4A2E', pat: [{ k: 'atk', dmg: 4, vuln: 1, l: 'Sticky Tongue' }, { k: 'atk', dmg: 9, l: 'Gulp' }, { k: 'debuff', weak: 1, l: 'Croak' }], note: 'Sticky Tongue leaves you Vulnerable: take 50% more damage.' },
  /* Act II */
  hound:    { n: 'Scrap Hound', hp: [32, 35], bg: '#8A4A1E', pat: [{ k: 'atk', dmg: 10, l: 'Bite' }, { k: 'atk', dmg: 10, l: 'Bite' }, { k: 'summon', key: 'hound', count: 1, hp: 20, howl: 1, l: 'Howl' }], note: 'Howl: summons a pup if alone, otherwise +2 Strength.' },
  mimic:    { n: 'Coinmouth Mimic', hp: [40, 44], bg: '#7A3A18', pat: [{ k: 'debuff', steal: 15, l: 'Swallow' }, { k: 'atk', dmg: 11, l: 'Chomp' }, { k: 'debuff', steal: 15, l: 'Swallow' }, { k: 'atk', dmg: 11, l: 'Chomp' }, { k: 'flee', l: 'Flee' }], note: 'Flees after 4 turns with your gold. Kill it first for double back.' },
  wraith:   { n: 'Smog Wraith', hp: [29, 32], bg: '#5A4A3E', pat: [{ k: 'buff', intangible: 1, l: 'Fade' }, { k: 'atk', dmg: 9, weak: 2, l: 'Choke' }], note: 'Faded: every hit deals only 1 damage. Block on those turns.' },
  gear:     { n: 'Gear Sentinel', hp: [44, 48], bg: '#6E4A28', artifact: 1, pat: [{ k: 'block', v: 12, l: 'Lock' }, { k: 'atk', dmg: 9, frail: 1, l: 'Piston' }], note: 'Artifact 1: negates the first debuff you apply.' },
  cultist:  { n: 'Ash Cultist', hp: [36, 40], bg: '#7A2E1E', loop: 1, pat: [{ k: 'buff', ritual: 3, l: 'Ritual' }, { k: 'atk', dmg: 6, l: 'Ash Strike' }], note: 'Ritual: gains 3 Strength every turn. Kill it fast.' },
  jailer:   { n: 'Chain Jailer', hp: [42, 46], bg: '#4E3A2E', pat: [{ k: 'debuff', drain: 1, l: 'Shackle' }, { k: 'atk', dmg: 10, l: 'Lash' }, { k: 'block', v: 5, root: 1, l: 'Brace' }], note: 'Shackle: you have 1 less Energy next turn. Brace roots it: half damage.' },
  furnace:  { n: 'Furnace Knight', hp: [125, 130], bg: '#6E2A14', elite: 1, pat: [{ k: 'status', card: 'burn', v: 2, discard: 1, l: 'Stoke' }, { k: 'atk', dmg: 20, l: 'Brand' }, { k: 'block', v: 8, root: 1, l: 'Bulwark' }], note: 'Burns in your hand deal 3 damage at end of turn. Bulwark roots it: half damage.' },
  matriarch:{ n: 'Brass Matriarch', hp: [115, 120], bg: '#7A5A1E', elite: 1, pat: [{ k: 'summon', key: 'hound', count: 2, hp: 20, l: 'Assemble' }, { k: 'buff', ally: 3, l: 'Command' }, { k: 'atk', dmg: 18, l: 'Crush' }], note: 'Summons Scrap Hounds and empowers them. Area damage helps.' },
  ledger:   { n: 'The Ledger', hp: [110, 115], bg: '#3E2E22', elite: 1, pat: [{ k: 'block', v: 8, l: 'Audit' }, { k: 'atk', dmg: 22, tax: 1, l: 'Collect' }], note: 'Tax: if you play 7+ cards in a turn, Collect hits twice.' },
  cog:      { n: 'King Cog, the Hollow Crown', hp: [260, 260], bg: '#5A3414', boss: 1, pat: [{ k: 'atk', dmg: 14, hits: 2, l: 'Grind' }, { k: 'block', v: 15, l: 'Wind Up' }, { k: 'buff', str: 3, l: 'Overclock' }, { k: 'atk', dmg: 32, l: 'Crown Beam' }], note: 'At half HP the gears shatter: he acts twice a turn but takes 25% more damage.' },
  tinker:   { n: 'Tin Tinker', art: 'gear', hp: [30, 34], bg: '#7A5A30', pat: [{ k: 'buff', ally: 2, l: 'Tune Up' }, { k: 'atk', dmg: 7, frail: 1, l: 'Wrench' }], note: 'Tune Up gives every other enemy +2 Strength (itself if alone). Kill it early.' },
  tyrant:   { n: 'Scrapyard Tyrant', art: 'ogre', hp: [100, 106], bg: '#5E3A1C', elite: 1, pat: [{ k: 'summon', key: 'hound', count: 1, hp: 20, l: 'Whistle' }, { k: 'atk', dmg: 16, l: 'Wrecking Swing' }, { k: 'block', v: 12, l: 'Scrap Plating' }, { k: 'atk', dmg: 9, hits: 2, weak: 1, l: 'Crush Down' }], note: 'Whistles up Scrap Pups (max 4 enemies). Area damage clears them fast.' },
  /* Act III */
  lantern:  { n: 'Lantern Warden', art: 'voidsentry', hp: [52, 56], bg: '#2A2050', pat: [{ k: 'block', v: 10, l: 'Shutter' }, { k: 'atk', dmg: 6, hits: 3, l: 'Triple Shot' }], note: 'Shutter turns are your window to attack. Triple Shot punishes low Block.' },
  voidsentry:{ n: 'Void Sentry', hp: [58, 62], bg: '#2E1E4A', pat: [{ k: 'block', v: 8, l: 'Scan' }, { k: 'atk', dmg: 15, vuln: 2, l: 'Beam' }], note: 'Pairs alternate so a Beam lands every turn. Vulnerable: you take 50% more.' },
  mirror:   { n: 'Mirror Saint', hp: [54, 57], bg: '#4A2A4E', pat: [{ k: 'buff', reflect: 1, block: 12, l: 'Reflect' }, { k: 'atk', dmg: 13, l: 'Glare' }], note: 'While reflecting, half your Attack damage bounces back. Hit it on Glare turns.' },
  ossuary:  { n: 'Ossuary Swarm', hp: [50, 54], bg: '#3E1E2A', pat: [{ k: 'atk', dmg: 4, hits: 4, l: 'Bone Storm' }], note: 'At half HP it splits into two swarms. Block and Thorns shred it.' },
  seer:     { n: 'Star-eyed Seer', hp: [56, 60], bg: '#1E2450', pat: [{ k: 'status', card: 'fate', v: 1, perm: 1, l: 'Prophecy' }, { k: 'atk', dmg: 14, l: 'Starfall' }], note: 'Fate curses stay in your deck for the rest of the run unless removed.' },
  colossus: { n: 'Grave Colossus', hp: [80, 84], bg: '#3A2A3A', pat: [{ k: 'block', v: 18, l: 'Rise' }, { k: 'atk', dmg: 18, l: 'Pound' }, { k: 'atk', dmg: 18, l: 'Pound' }], note: 'The toughest normal. Slow, so set up on its Rise turns.' },
  nullmask: { n: 'Nullmask', hp: [62, 66], bg: '#120E18', pat: [{ k: 'debuff', hush: 1, hidden: 1, l: 'Hush' }, { k: 'atk', dmg: 16, l: 'Strike' }], note: 'Faceless: you can’t see its Hush coming. Hush stops you playing Powers next turn.' },
  unwritten:{ n: 'The Unwritten', hp: [190, 200], bg: '#3A3442', elite: 1, pat: [{ k: 'atk', mimic: 1, l: 'Transcribe' }, { k: 'debuff', erase: 1, block: 12, l: 'Erase' }, { k: 'atk', dmg: 26, l: 'Rewrite' }], note: 'Transcribe copies your last Attack. Erase removes a card from your draw pile for this fight.' },
  choir:    { n: 'Choir Mouth', names: ['Mouth of Hunger', 'Mouth of Spite', 'Mouth of Sorrow'], hp: [62, 66], bg: '#5A1A2A', elite: 1, idle: 'sway', pat: [{ k: 'atk', dmg: 9, harmony: 1, l: 'Bite' }], note: 'Harmony: while all three live, each gains +2 Strength per turn. Break the chord.' },
  eclipse:  { n: 'Eclipse Duelist', hp: [180, 190], bg: '#1A1428', elite: 1, pat: [{ k: 'buff', parry: 1, block: 10, l: 'En Garde' }, { k: 'atk', dmg: 6, hits: 4, l: 'Flurry' }, { k: 'atk', dmg: 26, l: 'Riposte' }], note: 'Parry: fully blocks your first hit next turn. Lead with a cheap one.' },
  spire:    { n: 'The Faceless Spire', hp: [420, 420], bg: '#24123A', boss: 1, idle: 'sway', pat: [{ k: 'atk', dmg: 6, hits: 4, l: 'Porcelain Flurry' }, { k: 'atk', dmg: 12, block: 25, l: 'Lantern Wall' }, { k: 'atk', dmg: 30, l: 'Horned Crush' }], p2: [{ k: 'atk', dmg: 22, addCard: 'void', selfStr: 2, l: 'Void' }], note: 'Wears each hero’s mask in turn. At 40% HP it unmasks: Void hits grow stronger every turn.' }
};
/* Alternate bosses (one per act, 50% chance per run). phase = HP fraction that triggers the p2 pattern. */
Object.assign(EN, {
  briar:      { n: 'The Briar Regent', art: 'stag', hp: [175, 175], bg: '#1C3A24', boss: 1, phase: 0.5, phaseMsg: 'Overgrowth! The Regent bristles with thorns.',
    pat: [{ k: 'buff', thorns: 2, l: 'Briar Cloak' }, { k: 'atk', dmg: 5, hits: 3, weak: 1, l: 'Thorn Volley' }, { k: 'atk', dmg: 8, heal: 8, l: 'Sap' }, { k: 'atk', dmg: 18, l: 'Bramble Crush' }],
    p2: [{ k: 'buff', thorns: 3, l: 'Overgrowth' }, { k: 'atk', dmg: 7, hits: 3, vuln: 1, l: 'Barbed Storm' }, { k: 'atk', dmg: 22, l: 'Rampage' }],
    note: 'Thorns and self-healing. At half HP: Overgrowth, more Thorns and harder hits.' },
  auctioneer: { n: 'The Gilded Auctioneer', art: 'ledger', hp: [240, 240], bg: '#5A4414', boss: 1, phase: 0.5, phaseMsg: 'Fire Sale! Everything must go.',
    pat: [{ k: 'debuff', steal: 20, l: 'Going Once' }, { k: 'atk', dmg: 12, hits: 2, frail: 1, l: 'Gavel' }, { k: 'block', v: 14, l: 'Reserve Price' }, { k: 'atk', dmg: 28, tax: 1, l: 'Sold!' }],
    p2: [{ k: 'status', card: 'burn', v: 2, discard: 1, l: 'Fire Sale' }, { k: 'atk', dmg: 8, hits: 3, vuln: 1, l: 'Bidding War' }, { k: 'atk', dmg: 30, l: 'Final Bid' }],
    note: 'Steals gold. Sold! hits twice if you play 7+ cards. At half HP: Fire Sale adds 2 Burn to your discard pile.' },
  oracle:     { n: 'The Veiled Oracle', art: 'seer', hp: [400, 400], bg: '#1A1A48', boss: 1, idle: 'sway', phase: 0.4, phaseMsg: 'Unveiled! The Oracle erases and burns.',
    pat: [{ k: 'status', card: 'fate', v: 1, perm: 1, l: 'Prophecy' }, { k: 'debuff', hush: 1, hidden: 1, l: 'Hush' }, { k: 'atk', dmg: 8, hits: 3, l: 'Lashing Gaze' }, { k: 'atk', dmg: 12, block: 20, l: 'Shutter' }, { k: 'atk', dmg: 28, vuln: 1, l: 'Eclipse Beam' }],
    p2: [{ k: 'debuff', erase: 1, block: 15, l: 'Unwrite' }, { k: 'atk', dmg: 24, addCard: 'void', l: 'Void Gaze' }, { k: 'atk', dmg: 8, hits: 4, weak: 1, l: 'Starfall Rain' }],
    note: 'Hidden Hush and permanent Fate curses. At 40% HP: Unwrite and Void Gaze.' }
});
const BOSS_SIZE = { bell: 1, cog: 1, spire: 1, briar: 1, auctioneer: 1, oracle: 1 };

const ACTS = [
  { n: 'The Hollow Wood', stage: '#1F3A3A',
    easy: [['moth', 'crow'], ['rootling'], ['leech'], ['imp'], ['crow', 'crow'], ['toad']],
    hard: [['moth', 'moth', 'crow'], ['rootling', 'imp'], ['acolyte', 'crow'], ['leech', 'moth'], ['imp', 'acolyte'], ['rootling', 'leech'], ['toad', 'moth']],
    elites: [['ogre'], ['puppet', 'puppet'], ['stag']], boss: 'bell', alt: 'briar' },
  { n: 'The Rust Bazaar', stage: '#3A2414',
    easy: [['hound', 'hound'], ['mimic'], ['wraith'], ['cultist'], ['tinker']],
    hard: [['gear'], ['jailer', 'wraith'], ['cultist', 'hound'], ['mimic', 'jailer'], ['gear', 'cultist'], ['hound', 'hound', 'wraith'], ['tinker', 'hound']],
    elites: [['furnace'], ['matriarch'], ['ledger'], ['tyrant']], boss: 'cog', alt: 'auctioneer' },
  { n: 'The Faceless Crown', stage: '#2A1840',
    easy: [['voidsentry', 'voidsentry'], ['mirror'], ['ossuary'], ['seer'], ['lantern']],
    hard: [['colossus'], ['nullmask', 'seer'], ['mirror', 'ossuary'], ['voidsentry', 'nullmask'], ['colossus', 'seer'], ['lantern', 'mirror']],
    elites: [['unwritten'], ['choir', 'choir', 'choir'], ['eclipse']], boss: 'spire', alt: 'oracle' }
];
const curAct = () => ACTS[G.act - 1];

/* ---------- Map ---------- */
const ROWS = 9, LANES = 4;
function genMap(seed, act) {
  seedStream(seed ? seed + '|map|' + (act || 1) : null);
  const rows = [];
  for (let r = 0; r < ROWS; r++) {
    const row = [];
    for (let l = 0; l < LANES; l++) {
      let type;
      if (r === 0) type = 'fight';
      else if (r === 4) type = 'treasure';
      else if (r === ROWS - 1) type = 'rest';
      else {
        const bag = ['fight', 'fight', 'fight', 'fight', 'fight', 'shop'];
        if (r >= 2 && r !== 7) bag.push('rest');
        if (r >= 3) bag.push('elite', 'elite');
        if (r <= 6) bag.push('event', 'event');
        type = pick(bag);
      }
      row.push({ type, next: [], done: false });
    }
    rows.push(row);
  }
  for (let r = 0; r < ROWS - 1; r++) for (let l = 0; l < LANES; l++) {
    const n = rows[r][l].next; n.push(l);
    if (l > 0 && rng() < 0.45) n.push(l - 1);
    if (l < LANES - 1 && rng() < 0.45) n.push(l + 1);
  }
  const A = ACTS[(act || 1) - 1];
  const boss = A.alt && rng() < 0.5 ? A.alt : A.boss;
  seedStream(null);
  return { rows, boss };
}
function available() {
  if (!G.pos) return [0, 1, 2, 3].map(l => ({ r: 0, l }));
  if (G.pos.r === ROWS - 1) return [{ r: ROWS, l: 0 }];
  if (G.pos.r >= ROWS) return [];
  return G.map.rows[G.pos.r][G.pos.l].next.map(l => ({ r: G.pos.r + 1, l }));
}

/* ---------- Run setup ---------- */
const MODS = [{ k: 'horde', n: 'Brutal Foes', d: 'Enemies deal 25% more damage.', dc: 'Enemies deal 25% more damage to the whole party (the final duel is unaffected).' }, { k: 'fragile', n: 'Fragile Heroes', d: 'Your hero starts with 75% max HP.', dc: 'Each hero in the party starts with 75% max HP, including in the duel.' }, { k: 'gold', n: 'Double Gold', d: 'All gold you earn is doubled.', dc: 'Each hero earns double gold from every reward.' }, { k: 'curse', n: 'Curse Start', d: 'Your deck starts with a Fate curse (an unplayable dead card).', dc: 'Each hero starts with a Fate curse (an unplayable dead card) in their deck; it carries into the duel.' }];
function normMods(m) { m = Number(m); return Number.isInteger(m) && m >= 0 ? m & ((1 << MODS.length) - 1) : 0; }
function modOn(k, m) { const i = MODS.findIndex(x => x.k === k); if (m === undefined) m = G && G.mods; return i >= 0 && ((normMods(m) >> i) & 1) === 1; }
function goldMul() { return modOn('gold') ? 2 : 1; }
/* Daily challenge: date string -> fixed hero, one modifier, shared seed. Pure function of the date. */
function dailyChallenge(date) {
  const s = String(date || '').slice(0, 32);
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  h = Math.imul(h ^ (h >>> 15), 2246822519) >>> 0;
  const heroes = ['duelist', 'bulwark', 'brute', 'elementalist'];
  const mi = (h >>> 8) % MODS.length;
  return { seed: s, hero: heroes[h % heroes.length], mods: 1 << mi, modKey: MODS[mi].k, modName: MODS[mi].n, modDesc: MODS[mi].d, diff: 1 };
}
/* Map events (defaults for tuning) */
const EVT = { pactHp: 8, idolCost: 40, idolWin: 120, idolLoss: 10, idolOdds: 0.5, libHp: 6, forgeHp: 12, wellOdds: 0.6, wellHeal: 0.4, wellLoss: 8, boneHp: 10, boneGold: 70, mirrorOdds: 0.5, veinMax: 6, coinGold: 100, omenOdds: 0.5, omenMax: 8, omenLoss: 12, altGold: 35, altHeal: 8, altForgeHp: 6, altHurt: 3, omenPay: 25, omenAlt: 3, bonePay: 35, boneHeal: 15 };
const EVENT_KEYS = ['pact', 'idol', 'library', 'forge', 'well', 'bone', 'mirror', 'vein', 'coin', 'omen'];
function baseG(mode, diff, mods, seed) {
  seed = mode === 'solo' && typeof seed === 'string' && seed ? seed.slice(0, 32) : null;
  return { v: 3, mode, seed, code: null, screen: mode === 'coop' ? 'lobby' : 'map', act: 1, floor: 0, map: genMap(seed, 1), pos: null, P: [], combat: null, fx: [], fxSeq: 0, duelWinner: null, started: mode !== 'coop', diff: normDiff(diff), mods: normMods(mods) };
}
function newPlayer(hero, tok, mods) {
  const p = { hero: null, tok: tok || null, hp: 0, maxHp: 0, gold: 99, deck: [], relics: [], kills: 0, done: false, vote: null, ack: 0, conn: true, reward: null, shop: null, treasure: null, event: null, actclear: null, pot: [] };
  if (hero) equipHero(p, hero, mods);
  return p;
}
function equipHero(p, hero, mods) {
  const h = HEROES[hero];
  const hp = modOn('fragile', mods) ? Math.round(h.hp * 0.75) : h.hp;
  p.hero = hero; p.hp = hp; p.maxHp = hp; p.deck = h.starter.map(mk); p.relics = [h.relic];
  if (modOn('curse', mods)) p.deck.push(mk('fate'));
}
function freeRelic(pi, boss) {
  const free = Object.keys(RELICS).filter(k => !RELICS[k].start && !hasR(pi, k));
  const tier = free.filter(k => !!RELICS[k].boss === !!boss);
  const left = tier.length ? tier : free;
  return left.length ? pick(left) : null;
}
function gainRelic(pi, r) { if (!r) return; const p = P(pi); p.relics.push(r); if (r === 'heartstone') { p.maxHp += 12; p.hp += 12; } if (r === 'satchel') p.gold += 30; if (r === 'tonic') p.hp = Math.min(p.maxHp, p.hp + 15); }
function shopRelic(pi) {
  const free = Object.keys(RELICS).filter(k => !RELICS[k].start && !RELICS[k].boss && !hasR(pi, k));
  if (!free.length) return null;
  return { id: pick(free), price: rnd(150, 180) + (G.act - 1) * 8, sold: false };
}
function rollTier(kind) { const o = RAR_ODDS[kind] || RAR_ODDS.fight, x = rng() * 100; return x < o[0] ? 'c' : x < o[0] + o[1] ? 'u' : 'r'; }
function cardChoices(pi, n, kind) {
  const pool = HEROES[P(pi).hero].pool.concat(NEUTRAL), out = [];
  for (let i = 0; i < n; i++) {
    const tier = kind === 'boss' && i === 0 ? 'r' : rollTier(kind);
    let opts = pool.filter(id => RAR[id] === tier && !out.includes(id));
    if (!opts.length) opts = pool.filter(id => !out.includes(id));
    out.push(pick(opts));
  }
  return out;
}
function resetDone() { G.P.forEach(p => { p.done = false; p.vote = null; }); }
function allDone() { return G.P.every(p => p.done); }
function enterNode(r, l) {
  seedStream(G.seed ? G.seed + '|node|' + G.act + '|' + r + '|' + l : null);
  G.pos = { r, l };
  G.floor = r + 1;
  resetDone();
  const Act = curAct();
  if (r === ROWS) return startCombat([G.map.boss || Act.boss], 'boss');
  const node = G.map.rows[r][l];
  node.done = true;
  if (node.type === 'fight') startCombat(pick(r < 3 ? Act.easy : Act.hard), 'fight');
  else if (node.type === 'elite') startCombat(pick(Act.elites), 'elite');
  else if (node.type === 'rest') { G.screen = 'rest'; G.P.forEach(p => { p.rested = false; }); render(); }
  else if (node.type === 'shop') { G.P.forEach((p, pi) => { p.shop = { cards: cardChoices(pi, 4, 'shop').map(id => ({ id, price: rnd(PRICE[RAR[id]][0], PRICE[RAR[id]][1]) + (G.act - 1) * 8, sold: false })), removed: false, pot: shopPotion(p), relic: shopRelic(pi) }; }); G.screen = 'shop'; render(); }
  else if (node.type === 'treasure') {
    G.P.forEach((p, pi) => { const gold = (rnd(40, 60) + (G.act - 1) * 10) * goldMul(); p.gold += gold; const relic = freeRelic(pi); gainRelic(pi, relic); p.treasure = { gold, relic }; });
    G.screen = 'treasure'; render();
  }
  else if (node.type === 'event') {
    const k0 = pick(EVENT_KEYS);
    G.P.forEach((p, pi) => {
      let k = k0; const e = { k, used: false, msg: '' };
      if (k === 'pact') { e.relic = freeRelic(pi); if (!e.relic) k = e.k = 'idol'; }
      if (k === 'idol') e.win = rng() < EVT.idolOdds;
      else if (k === 'library') { const rare = HEROES[p.hero].pool.filter(id => RAR[id] === 'r'); e.card = rare.length ? pick(rare) : null; }
      else if (k === 'forge') { const un = HEROES[p.hero].pool.filter(id => RAR[id] === 'u'); e.cards = un.length ? [pick(un), pick(un)] : []; }
      else if (k === 'well') e.win = rng() < EVT.wellOdds;
      else if (k === 'omen') e.win = rng() < EVT.omenOdds;
      else if (k === 'mirror') { const ds = p.deck.filter(c => CARDS[c.id].c >= 0 && !CARDS[c.id].curse); e.card = ds.length ? pick(ds).id : null; e.lv = 0; const src = e.card ? ds.find(c => c.id === e.card) : null; e.lv = src && src.lv ? src.lv : 0; e.win = rng() < EVT.mirrorOdds; }
      p.event = e;
    });
    G.screen = 'event'; render();
  }
}
/* Event choice 1: the alternate option for each event kind. Validated here, so clients cannot bypass costs. */
function evtAlt(pi, p, e, ch) {
  if (ch !== 1) return note(pi, 'You cannot do that.');
  const g = Math.round(EVT.altGold * goldMul()), heal = n => { const h0 = p.hp; p.hp = Math.min(p.maxHp, p.hp + n); return p.hp - h0; };
  const hurt = () => { p.hp = Math.max(1, p.hp - EVT.altHurt); };
  if (e.k === 'pact') { p.gold += g; e.msg = 'You pry loose a few gems and leave the mask hungry. +' + g + ' gold.'; }
  else if (e.k === 'idol') { p.gold += g; hurt(); e.msg = 'You smash the idol and its teeth bite back. +' + g + ' gold, and a little blood is lost.'; }
  else if (e.k === 'library') { const h = heal(EVT.altHeal); e.msg = 'You rest among the shelves in peace. You recover ' + h + ' HP.'; }
  else if (e.k === 'forge') {
    if (!e.cards || !e.cards.length || p.hp <= EVT.altForgeHp) return note(pi, 'You cannot do that.');
    p.hp -= EVT.altForgeHp; p.deck.push(mk(e.cards[0])); e.msg = 'You take only one piece from the forge: ' + CARDS[e.cards[0]].n + '.';
  }
  else if (e.k === 'well') { const h = heal(EVT.altHeal); e.msg = 'You wash your wounds at the rim. You recover ' + h + ' HP.'; }
  else if (e.k === 'vein') { const h = heal(EVT.altHeal); e.msg = 'You take a careful sip. You recover ' + h + ' HP.'; }
  else if (e.k === 'coin') { p.gold += g; e.msg = 'You take a few coins and leave the rest. +' + g + ' gold.'; }
  else if (e.k === 'omen') {
    if (p.gold < EVT.omenPay) return note(pi, 'Not enough gold.');
    p.gold -= EVT.omenPay; p.maxHp += EVT.omenAlt; p.hp = Math.min(p.maxHp, p.hp + EVT.omenAlt); e.msg = 'Your offering is accepted. You gain ' + EVT.omenAlt + ' max HP.';
  }
  else if (e.k === 'bone') {
    if (p.gold < EVT.bonePay) return note(pi, 'Not enough gold.');
    p.gold -= EVT.bonePay; const h = heal(EVT.boneHeal); e.msg = 'The trader sells you a bitter tonic. You recover ' + h + ' HP.';
  }
  else if (e.k === 'mirror') { p.gold += g; hurt(); e.msg = 'You smash the mirror and collect the shards. +' + g + ' gold, and a little blood is lost.'; }
  else return note(pi, 'You cannot do that.');
  e.used = true;
}
function vote(pi, r, l) {
  if (!available().some(a => a.r === r && a.l === l)) return;
  P(pi).vote = r + '-' + l;
  if (G.P.some(p => !p.vote)) return render();
  const v = G.P[0].vote;
  if (G.P.every(p => p.vote === v)) return enterNode(r, l);
  // Players disagree: coin flip between the two picks
  const wi = pick(G.P.map((p, i) => i));
  const [wr, wl] = G.P[wi].vote.split('-').map(Number);
  enterNode(wr, wl);
  fx('map', 'Coin flip: ' + (G.P[wi].hero || 'Player ' + (wi + 1)) + '\'s path wins.', 'coin');
  log('Coin flip: the party follows ' + (G.P[wi].hero || 'Player ' + (wi + 1)) + '\'s path.');
  render();
}
function toMap() { seedStream(null); G.screen = 'map'; G.combat = null; G.P.forEach(p => { p.reward = null; p.shop = null; p.treasure = null; p.event = null; }); resetDone(); render(); }
function nextAct() { seedStream(null); G.act++; G.map = genMap(G.seed, G.act); G.pos = null; G.floor = 0; G.P.forEach(p => { p.actclear = null; }); G.screen = 'map'; G.combat = null; resetDone(); render(); }
function advanceIfDone() {
  if (!allDone()) return render();
  if (['reward', 'treasure', 'rest', 'shop', 'event'].includes(G.screen)) toMap();
  else if (G.screen === 'actclear') nextAct();
  else if (G.screen === 'duelintro') startDuel();
  else render();
}

/* ---------- Combat ---------- */
const DIFF = 1.5; // extra difficulty on top of the base 1.15: enemy HP and damage
const DIFFS = [{ k: 'easy', n: 'Easy', m: 0.8 }, { k: 'normal', n: 'Normal', m: 1 }, { k: 'hard', n: 'Hard', m: 1.2 }]; // G.diff indexes this; Normal = unchanged balance
function normDiff(d) { d = d == null || d === '' ? NaN : Number(d); return Number.isInteger(d) && d >= 0 && d < DIFFS.length ? d : 1; }
function diffMult() { return DIFFS[normDiff(G && G.diff)].m; }
function potDropChance(elite) { const hard = normDiff(G && G.diff) === 2; return hard ? (elite ? 25 : 10) : (elite ? 50 : 25); } // Hard = fewer potions
const MAX_LOG_LINES = 18, MAX_LOG_CHARS = 200;
function log(s) { const c = G.combat; if (!c) return; s = String(s); if (s.length > MAX_LOG_CHARS) s = s.slice(0, MAX_LOG_CHARS); c.log.unshift(s); if (c.log.length > MAX_LOG_LINES) c.log.length = MAX_LOG_LINES; }
function makeEnemy(key, idx, dup, hpOverride, raw) {
  const d = EN[key];
  const mult = raw ? 1 : 1.15 * DIFF * diffMult() * (G.P.length > 1 ? 1.6 : 1);
  const hp = Math.round((hpOverride || rnd(d.hp[0], d.hp[1])) * mult);
  return { idx, key, n: d.names ? d.names[dup % d.names.length] : d.n, variant: dup, hp, max: hp, block: 0, str: 0, weak: 0, vuln: 0, burn: 0, chill: 0, shock: 0, thorns: 0, artifact: d.artifact || 0,
    rooted: false, intangible: false, reflect: false, parry: false, ritual: 0, pi: dup % d.pat.length, dead: false, stolen: {}, acting: false, p2: false, split: false, fragile: 1, tg: 0, hitS: 0, deadS: 0 };
}
function newSide(pi) {
  const p = P(pi);
  return { isP: true, pi, hp: p.hp, max: p.maxHp, block: 0, energy: 3, flow: 0, flowEnd: 0, rage: 0, str: (hasR(pi, 'cinder') ? 1 : 0) + (hasR(pi, 'bonecrown') ? 2 : 0), weak: 0, vuln: 0, frail: 0, drain: 0, hush: 0, hushNow: 0,
    thorns: (hasR(pi, 'thornring') ? 2 : 0) + (hasR(pi, 'ironbark') ? 3 : 0), composure: 0, rhythm: 0, keep: 0, rampart: 0, keepAll: 0, bloodpact: 0, ragegain: 0, stance: hasR(pi, 'hornedmask') ? 'calm' : null, switches: 0, mantra: 0, serenity: 0, ironplus: 0,
    draw: shuffle(p.deck.map(c => { const n = mk(c.id); if (c.lv) n.lv = c.lv; return n; })), hand: [], discard: [], exhaust: [], pwr: [], played: 0, lastAttack: 5, atkTotal: 0, elu: [],
    ready: false, down: p.hp <= 0, turnN: 0, animS: 0, animK: '', fwS: 0, fwN: 0, hurtNow: false };
}
function startCombat(keys, kind) {
  const seen = {};
  G.combat = {
    kind, enemies: keys.map((k, i) => { seen[k] = (seen[k] || 0) + 1; return makeEnemy(k, i, seen[k] - 1); }),
    S: G.P.map((p, i) => newSide(i)), turn: 0, over: false, busy: false, log: [], duel: null, finalToll: false
  };
  if (G.P.some((p, i) => hasR(i, 'bellshard'))) C().enemies.forEach(e => { e.vuln = 1; });
  if (G.P.some((p, i) => hasR(i, 'thimble'))) C().enemies.forEach(e => { e.weak = Math.max(e.weak, 1); });
  if (G.P.some((p, i) => hasR(i, 'stormglass'))) C().enemies.forEach(e => { e.shock = Math.max(e.shock, 1); });
  if (G.P.some((p, i) => hasR(i, 'obsidianeye'))) C().enemies.forEach(e => { e.vuln = Math.max(e.vuln, 2); e.weak = Math.max(e.weak, 1); });
  G.P.forEach((p, i) => { const s = C().S[i]; if (s && !s.down && hasR(i, 'tallowcandle')) s.hp = Math.min(s.max, s.hp + 3); });
  log(kind === 'boss' ? EN[keys[0]].n + ' looms over you.' : 'Enemies appear: ' + C().enemies.map(e => e.n).join(', ') + '.');
  G.screen = 'combat';
  startRound();
}
function pickTargets() {
  const sides = aliveSides();
  aliveEnemies().forEach(e => { if (sides.length) e.tg = pick(sides).pi; });
}
function startRound() {
  const c = C();
  c.turn++;
  c.busy = false;
  aliveSides().forEach(startTurnSide);
  pickTargets();
  render();
}
function startTurnSide(s) {
  A = s;
  s.turnN++; { const pp = P(s.pi); if (pp) pp.tn = (pp.tn || 0) + 1; }
  const first = s.turnN === 1, pi = s.pi;
  let keep = 0;
  if (!first && P(pi).hero === 'bulwark') keep = s.keepAll ? s.block : Math.floor(s.block / 2);
  s.block = keep + (first && hasR(pi, 'locket') ? 6 : 0) + (first && hasR(pi, 'lanternhelm') ? 8 : 0) + (first && hasR(pi, 'quadmask') ? 5 : 0) + (first && hasR(pi, 'wardenseal') ? 12 : 0);
  s.energy = Math.max(0, 3 + (first && hasR(pi, 'quill') ? 1 : 0) + (first && hasR(pi, 'spurboots') && C() && (C().kind === 'elite' || C().kind === 'boss') ? 1 : 0) - s.drain);
  if (s.drain) log(heroName(pi) + ' is Shackled: ' + s.energy + ' Energy.');
  s.drain = 0;
  s.hushNow = s.hush; s.hush = 0;
  const carry = s.keep ? Math.floor((s.flowEnd || 0) / 2) : 0;
  s.flow = s.composure + (first && hasR(pi, 'mask') ? 1 : 0) + carry;
  if (s.ragegain) addRage(s.ragegain);
  s.played = 0; s.lastT = null;
  s.switches = 0;
  s.ready = false;
  if (first && hasR(pi, 'quadmask')) {
    const EL = { emberlash: 'fire', cinderbolt: 'fire', scorch: 'fire', rimespiral: 'frost', icelance: 'frost', stormcrash: 'storm', tempest: 'storm', sparkjolt: 'storm' };
    const elOf = id => (CARDS[id] && CARDS[id].t === 'attack') ? (EL[id] || 'stone') : null;
    const BASIC = { fire: 'emberlash', frost: 'rimespiral', storm: 'sparkjolt', stone: 'estrike' };
    ['fire', 'frost', 'storm', 'stone'].forEach(el => { const j = s.draw.findIndex(c => elOf(c.id) === el); if (j >= 0) s.draw.push(s.draw.splice(j, 1)[0]); else s.draw.push(mk(BASIC[el])); });
  }
  draw(5 + (first && hasR(pi, 'hourglass') ? 2 : 0) + (first && hasR(pi, 'brasscompass') ? 1 : 0) + (hasR(pi, 'ribbon') ? 1 : 0));
  if (hasR(pi, 'pocket')) gain(4, true);
  if (hasR(pi, 'aegisplate')) gain(8, true);
  if (first && hasR(pi, 'brasscompass')) gain(3, true);
  if (!first && hasR(pi, 'vigilbell')) gain(4, true);
  if (first && hasR(pi, 'ravenfeather') && C() && (C().kind === 'elite' || C().kind === 'boss')) s.str += 1;
  if (hasR(pi, 'phoenixash')) s.hp = Math.min(s.max, s.hp + 3);
}
function draw(n) {
  const s = A;
  for (let i = 0; i < n; i++) {
    if (s.hand.length >= 10) break;
    if (!s.draw.length) { if (!s.discard.length) break; s.draw = shuffle(s.discard); s.discard = []; }
    const card = s.draw.pop();
    s.hand.push(card);
    if (card.id === 'void') { s.energy = Math.max(0, s.energy - 1); float(tagOf(s), 'Void: −1 Energy', 'buff'); }
  }
}
/* Elementalist element combo defaults (tune here): same element as last Attack -> raw Block; different element -> draw cards. */
const EL_COMBO = { repeatBlock: 2, switchDraw: 1 };
/* Element-combo helpers for cards: s.elPrev is the last Attack element before the card being played. */
function elSwitched() { const s = SF(); return !!s.elPrev && !!s.el && s.elPrev !== s.el; }
function elRepeated() { const s = SF(); return !!s.elPrev && s.elPrev === s.el; }
/* Card upgrade defaults (tune freely). Lv1: +dmg/+block/power draw. Lv2: refund energy. Lv3: Link bonus when the previous card this turn was a different type. */
const UPG = { dmg: 2, block: 2, powerDraw: 1, refund: 1, linkDmg: 4, linkBlock: 4, linkDraw: 1, linkEnergy: 1 };
function gain(n, raw) {
  const s = A;
  if (!raw && s.frail > 0) n = Math.floor(n * 0.75);
  if (n <= 0) return;
  s.block += n; float(tagOf(s), '+' + n + ' Block', 'block');
}
const STANCE = {
  fury: { n: 'Fury', d: 'Attacks deal 50% more. You take 25% more damage.' },
  iron: { n: 'Iron', d: 'Gain 4 Block at the end of your turn. Attacks deal 25% less.' },
  calm: { n: 'Calm', d: 'When you leave Calm, gain 2 Energy.' }
};
function enterStance(st) {
  const s = A;
  if (!s || s.down || s.stance === st) return;
  const old = s.stance;
  s.stance = st;
  s.switches++;
  float(tagOf(s), STANCE[st].n + '!', 'buff');
  log(heroName(s.pi) + ' enters ' + STANCE[st].n + '.');
  if (old === 'calm') { s.energy += 2; float(tagOf(s), '+2 Energy', 'buff'); if (s.serenity) draw(s.serenity); }
  draw(1);
  if (s.mantra) foes().slice().forEach(e => hit(e, s.mantra));
}
function addRage(n) { if (n <= 0) return; A.rage += n; float(tagOf(A), '+' + n + ' Rage', 'buff'); }
function heal(n) { const s = A; const before = s.hp; s.hp = Math.min(s.max, s.hp + n); if (s.hp > before) float(tagOf(s), '+' + (s.hp - before), 'heal'); }
function selfHurt(n) {
  const s = A;
  s.hp -= n; float(tagOf(s), '−' + n);
  anim(s, 'hurt');
  if (s.bloodpact) addRage(s.bloodpact);
  if (s.hp <= 0) sideDown(s);
}
function debuffEnemy(e, kind, n) {
  if (!e || e.dead || e.down) return;
  if (e.artifact > 0) { e.artifact--; float(tagOf(e), 'Negated', 'miss'); return; }
  e[kind] = (e[kind] || 0) + n;
  if (kind === 'burn' && A) e.burnBy = A.pi;
}
function patOf(e) { const d = EN[e.key]; return e.p2 && d.p2 ? d.p2 : d.pat; }
function intentOf(e, ahead) {
  const d = EN[e.key], p = patOf(e);
  let i = e.pi + (ahead || 0);
  if (!e.p2 && d.loop != null && i >= p.length) i = d.loop + (i - d.loop) % (p.length - d.loop);
  else i = i % p.length;
  return p[i];
}
function enemyDmg(e, base, T) {
  let d = Math.round(base * 1.15 * DIFF * diffMult() * (modOn('horde') ? 1.25 : 1)) + e.str;
  if (e.weak > 0) d -= e.weak;
  if (e.chill > 0) d = Math.floor(d * 0.75);
  if (T && T.vuln > 0) d = Math.floor(d * 1.5);
  if (T && T.stance === 'fury') d = Math.floor(d * 1.25);
  return Math.max(0, d);
}
function checkPhase(e) {
  const c = C();
  if (e.key === 'bell' && !c.finalToll && e.hp * 2 <= e.max) { c.finalToll = true; log('The Bellwarden rings the Final Toll.'); banner('Final Toll! Doom Bells now burn at end of turn.'); }
  if (e.key === 'cog' && !e.p2 && e.hp * 2 <= e.max) { e.p2 = true; e.block = 0; e.fragile = 1.25; log('King Cog’s gears shatter. He acts twice a turn now.'); banner('Gears shattered: King Cog acts twice, but takes 25% more damage.'); }
  if (e.key === 'spire' && !e.p2 && e.hp * 5 <= e.max * 2) { e.p2 = true; e.pi = 0; log('The Faceless Spire casts off its masks.'); banner('Unmasked! The Void grows stronger every turn.'); }
  const ed = EN[e.key];
  if (ed.phase && ed.p2 && !e.p2 && e.hp > 0 && e.hp <= e.max * ed.phase) { e.p2 = true; e.pi = 0; log(ed.n + ' enters its second phase.'); banner(ed.phaseMsg || 'Phase two!'); }
  if (e.key === 'ossuary' && !e.split && e.hp * 2 <= e.max) {
    e.split = true;
    const half = Math.max(1, e.hp);
    e.max = half;
    const twin = makeEnemy('ossuary', c.enemies.length, 1, half, true);
    twin.split = true; twin.tg = e.tg;
    c.enemies.push(twin);
    log('The Ossuary Swarm splits in two.');
    float(tagOf(e), 'Splits!', 'buff');
  }
}
function hit(t, base, times) {
  const c = C(), a = A;
  times = times || 1;
  for (let i = 0; i < times; i++) {
    if (!t || t.dead || t.down || c.over || a.down) break;
    let d = base + a.str + a.rage + (hasR(a.pi, 'whetstone') ? 1 : 0) + (a.lvDmg || 0) + (a.rhythm || 0) * a.flow;
    if (a.weak > 0) d -= a.weak;
    if (a.stance === 'fury') d = Math.floor(d * 1.5);
    if (a.stance === 'iron' && !a.ironplus) d = Math.floor(d * 0.75);
    if (t.vuln > 0) d = Math.floor(d * 1.5);
    if (!t.isP && t.shock > 0) { d += 3; t.shock--; }
    if (t.isP && t.stance === 'fury') d = Math.floor(d * 1.25);
    if (t.rooted) d = Math.floor(d / 2);
    d = Math.max(0, Math.floor(d * (t.fragile || 1)));
    if (t.intangible) d = Math.min(d, 1);
    if (t.parry && d > 0) { t.parry = false; float(tagOf(t), 'Parried!', 'miss'); log(t.n + ' parries a hit.'); continue; }
    a.atkTotal += d;
    const ab = Math.min(t.block, d);
    if (!t.isP) { const pp = P(a.pi); pp.dmg = (pp.dmg || 0) + Math.max(0, Math.min(t.hp, d - ab)); } t.block -= ab; t.hp -= d - ab;
    const s = float(tagOf(t), d - ab > 0 ? '−' + (d - ab) : 'Blocked', d - ab > 0 ? '' : 'miss');
    if (t.isP) { if (d - ab > 0) { anim(t, 'hurt'); t.hurtNow = true; } } else t.hitS = s;
    if (t.reflect && d > 0) { const r = Math.floor(d / 2); if (r) { hurtSide(a, r, null); log('The mirror reflects ' + r + ' damage.'); } }
    if (t.thorns > 0) { hurtSide(a, t.thorns, null); log('Thorns prick ' + heroName(a.pi) + ' for ' + t.thorns + '.'); }
    if (c.over) return;
    if (t.hp <= 0) { if (t.isP) sideDown(t); else kill(t, a.pi); }
    else if (!t.isP) checkPhase(t);
  }
}
function kill(e, by) {
  const c = C();
  e.dead = true; e.hp = 0; e.deadS = fx(tagOf(e), '', 'miss');
  if (by != null && G.P[by]) {
    G.P[by].kills++;
    if (hasR(by, 'bountypouch')) { G.P[by].gold += 3; log(heroName(by) + ' pockets 3 gold.'); }
    const ks = c.S[by];
    if (ks && !ks.down && hasR(by, 'carrion')) { ks.hp = Math.min(ks.max, ks.hp + 2); float(tagOf(ks), '+2 HP', 'buff'); }
  }
  log(e.n + ' is defeated.');
  if (e.key === 'moth') { const s = c.S[by != null ? by : e.tg]; if (s) { s.discard.push(mk('dazed')); log('Glowdust: a Dazed joins ' + heroName(s.pi) + '’s discard pile.'); } }
  Object.keys(e.stolen).forEach(k => {
    const amt = e.stolen[k] * (e.key === 'mimic' ? 2 : 1);
    if (amt && G.P[k]) { G.P[k].gold += amt; log(heroName(+k) + ' takes back ' + amt + ' gold.'); }
  });
  if (e.key === 'puppet') aliveEnemies().filter(x => x.key === 'puppet').forEach(x => { x.str += 5; float(tagOf(x), '+5 Strength', 'buff'); log(x.n + ' gains 5 Strength in grief.'); });
}
function hurtSide(s, d, src, steal) {
  if (s.down) return;
  const ab = Math.min(s.block, d);
  s.block -= ab;
  const un = d - ab;
  s.hp -= un;
  float(tagOf(s), un > 0 ? '−' + un : 'Blocked', un > 0 ? '' : 'miss');
  if (un > 0) { anim(s, 'hurt'); if (src) s.hurtNow = true; }
  if (src && steal && un > 0) { const p = P(s.pi); const st = Math.min(p.gold, steal); p.gold -= st; src.stolen[s.pi] = (src.stolen[s.pi] || 0) + st; }
  if (src && !src.isP && s.thorns > 0 && !src.dead) {
    src.hp -= s.thorns; src.hitS = float(tagOf(src), '−' + s.thorns + ' Thorns');
    if (src.hp <= 0) kill(src, s.pi);
  }
  if (s.hp <= 0) sideDown(s);
}
function sideDown(s) {
  const c = C();
  s.hp = 0;
  if (s.down) return;
  s.down = true; s.ready = true;
  log(heroName(s.pi) + ' falls!');
  if (c.duel) { duelOver(1 - s.pi); return; }
  if (!aliveSides().length) {
    c.over = true; syncHP(); G.screen = 'defeat'; clearSave();
  } else banner(heroName(s.pi) + ' is down! They return after this fight.');
}
function syncHP() {
  const c = G.combat; if (!c) return;
  c.S.forEach(s => { P(s.pi).hp = Math.max(0, s.hp); });
}
/* ---------- Potions ---------- */
const POT_MAX = 3;
const POTIONS = {
  emberflask: { n: 'Ember Flask', h: 'elementalist', k: 'burn', v: 4, p: [30, 45], d: 'Apply 4 Burn to ALL enemies.' },
  frosttonic: { n: 'Frost Tonic', h: 'elementalist', k: 'chill', v: 2, p: [30, 45], d: 'Apply 2 Chill to ALL enemies.' },
  stormdraught: { n: 'Storm Draught', h: 'elementalist', k: 'shock', v: 3, p: [30, 45], d: 'Apply 3 Shock to ALL enemies.' },
  quickstep: { n: 'Quickstep Tonic', h: 'duelist', k: 'flow', v: 3, p: [30, 45], d: 'Gain 3 Flow.' },
  hexingoil: { n: 'Hexing Oil', h: 'duelist', k: 'weak', v: 2, p: [30, 45], d: 'Apply 2 Weak to ALL enemies.' },
  breakersbrew: { n: 'Breaker’s Brew', h: 'duelist', k: 'vuln', v: 2, p: [30, 45], d: 'Apply 2 Vulnerable to ALL enemies.' },
  pyretincture: { n: 'Pyre Tincture', h: 'elementalist', k: 'burn', v: 7, fx: [['burn', 7]], p: [30, 45], d: 'Apply 7 Burn to ALL enemies.' },
  glaciersalve: { n: 'Glacier Salve', h: 'elementalist', k: 'chill', v: 4, fx: [['chill', 4]], p: [30, 45], d: 'Apply 4 Chill to ALL enemies.' },
  prismelixir: { n: 'Prism Elixir', h: 'elementalist', k: 'prism', fx: [['burn', 2], ['chill', 2], ['shock', 2]], p: [35, 50], d: 'Apply 2 Burn, 2 Chill and 2 Shock to ALL enemies.' },
  rhythmelixir: { n: 'Rhythm Elixir', h: 'duelist', k: 'flow', v: 6, fx: [['flow', 6]], p: [30, 45], d: 'Gain 6 Flow.' },
  sunderingdraught: { n: 'Sundering Draught', h: 'duelist', k: 'sunder', fx: [['weak', 1], ['vuln', 2]], p: [35, 50], d: 'Apply 1 Weak and 2 Vulnerable to ALL enemies.' },
  cleansingtonic: { n: 'Cleansing Tonic', h: 'duelist', k: 'cleanse', fx: [['cleanse', 1], ['flow', 3]], p: [30, 45], d: 'Remove your Frail and Vulnerable. Gain 3 Flow.' }
};
function potionPick(p) {
  const ids = Object.keys(POTIONS).filter(k => POTIONS[k].h === p.hero);
  return ids.length ? ids[Math.max(0, Math.min(ids.length - 1, rnd(0, ids.length - 1)))] : null;
}
function shopPotion(p) {
  const id = potionPick(p);
  if (!id) return null;
  return { id, price: rnd(POTIONS[id].p[0], POTIONS[id].p[1]) + (G.act - 1) * 5, sold: false };
}
function usePotion(pi, i) {
  const c = C();
  if (!c || G.screen !== 'combat') return;
  const s = c.S[pi], p = P(pi);
  if (c.over || c.busy || !s || s.down || s.ready) return;
  if (c.duel && c.duel.active !== pi) return note(pi, 'Wait for your turn.');
  const id = p.pot && p.pot[i], d = POTIONS[id];
  if (!d) return;
  A = s;
  (d.fx || [[d.k, d.v]]).forEach(f => {
    const kind = f[0], v = f[1];
    if (kind === 'flow') { s.flow += v; float(tagOf(s), '+' + v + ' Flow', 'buff'); }
    else if (kind === 'cleanse') { s.frail = 0; s.vuln = 0; float(tagOf(s), 'Cleansed', 'buff'); }
    else foes().forEach(e => debuffEnemy(e, kind, v));
  });
  p.pot = p.pot.filter((q, j) => j !== i);
  log(heroName(pi) + ' drinks ' + d.n + '.');
  render();
}
function playCard(pi, uid, tgt) {
  const c = C();
  if (!c || G.screen !== 'combat') return;
  const s = c.S[pi];
  if (c.over || c.busy || !s || s.down || s.ready) return;
  if (c.duel && c.duel.active !== pi) return note(pi, 'Wait for your turn.');
  const i = s.hand.findIndex(x => x.u === uid);
  if (i < 0) return;
  const card = s.hand[i];
  const d = CARDS[card.id];
  if (d.c < 0) return note(pi, d.n + ' can’t be played.');
  if (d.c > s.energy) return note(pi, 'Not enough Energy.');
  if (d.t === 'power' && s.hushNow) return note(pi, 'Hushed: you can’t play Powers this turn.');
  A = s;
  let t = null;
  if (d.tg) {
    const fs = foes();
    if (c.duel) t = fs[0] || null;
    else if (tgt != null) t = c.enemies[tgt];
    else if (fs.length === 1) t = fs[0];
    if (!t || t.dead || t.down) return;
  }
  { const aE = aliveEnemies(); const pt = t ? tagOf(t) : d.t === 'attack' ? (c.duel ? 'p' + (1 - pi) : (aE[0] ? tagOf(aE[0]) : 'p' + pi)) : 'p' + pi; G.fxSeq = (G.fxSeq || 0) + 1; c.pl = [G.fxSeq, pi, card.id, pt]; }
  s.energy -= d.c; s.hand.splice(i, 1); s.atkTotal = 0; s.played++; P(pi).cp = (P(pi).cp || 0) + 1;
  log(heroName(pi) + ' plays ' + d.n + (t ? ' on ' + nameOf(t) : '') + '.');
  const b0 = s.block, hk = P(pi).hero;
  const elPrev = s.el; s.elPrev = elPrev;
  if (d.t === 'attack' && hk === 'elementalist') s.el = ({ emberlash: 'fire', cinderbolt: 'fire', scorch: 'fire', rimespiral: 'frost', icelance: 'frost', stormcrash: 'storm', tempest: 'storm', sparkjolt: 'storm', kindle: 'fire', thermalshock: 'fire', staticedge: 'storm', chainbolt: 'storm', smolder: 'fire', eternalflame: 'fire', hoarfrost: 'frost', arcflash: 'storm', flamewheel: 'fire', wildfire: 'fire', coldsnap: 'frost', glaciercrush: 'frost', blizzard: 'frost', superconduct: 'storm', overload: 'storm' })[card.id] || 'stone';
  if (d.t === 'attack' && hk === 'elementalist' && s.el) { s.elu = s.elu || []; if (!s.elu.includes(s.el)) s.elu.push(s.el); }
  if (d.t === 'attack') anim(s, hk === 'bulwark' ? 'slam' : hk === 'brute' ? 'smash' : hk === 'elementalist' ? 'cast' : 'lunge');
  const o = c.duel ? opp(s) : null;
  if (o) o.hurtNow = false;
  const lv = card.lv || 0, prevT = s.lastT, link = lv >= 3 && !!prevT && prevT !== d.t; s.lastT = d.t;
  s.lvDmg = d.t === 'attack' ? (lv >= 1 ? UPG.dmg : 0) + (link ? UPG.linkDmg : 0) : 0;
  if (d.p) d.p(t);
  s.lvDmg = 0;
  if (!c.over) {
    if (lv >= 1 && d.t === 'skill') gain(UPG.block, true);
    if (lv >= 1 && d.t === 'power') draw(UPG.powerDraw);
    if (lv >= 2 && d.c >= 1) s.energy += UPG.refund;
    if (link && d.t === 'skill') { gain(UPG.linkBlock, true); draw(UPG.linkDraw); }
    if (link && d.t === 'power') s.energy += UPG.linkEnergy;
    if (link) log(d.n + ' links from ' + prevT + ' (+3 upgrade).');
  }
  if (d.t !== 'attack') anim(s, s.block > b0 ? 'guard' : 'buff');
  if (c.over) return render();
  if (d.t === 'attack') { if (P(pi).hero === 'elementalist') { A = s; gain(1, true); if (elPrev && s.el) { if (s.el === elPrev) { if (EL_COMBO.repeatBlock > 0) { gain(EL_COMBO.repeatBlock, true); log('Elemental echo: repeated ' + s.el + '.'); } } else if (EL_COMBO.switchDraw > 0) { draw(EL_COMBO.switchDraw); log('Elemental shift: ' + elPrev + ' to ' + s.el + ', draw ' + EL_COMBO.switchDraw + '.'); } } } if (P(pi).hero === 'duelist') s.flow++; if (s.atkTotal > 0) s.lastAttack = s.atkTotal; }
  if (d.t === 'skill' && !c.duel) aliveEnemies().filter(x => x.key === 'ogre').forEach(og => { og.str += 2; float(tagOf(og), '+2 Strength', 'buff'); log('The Ogre enrages: +2 Strength.'); });
  if (d.t !== 'power') (d.x ? s.exhaust : s.discard).push(card); else (s.pwr || (s.pwr = [])).push(card.id);
  if (!c.duel && !aliveEnemies().length) { c.busy = true; render(); setTimeout(win, isReduce() ? 100 : paceRow().win); return; }
  render();
}
function endTurnAction(pi) {
  const c = C();
  if (!c || c.over || c.busy || G.screen !== 'combat') return;
  const s = c.S[pi];
  if (c.duel) { if (c.duel.active === pi) duelEndTurn(); return; }
  if (!s || s.down || s.ready) return;
  s.ready = true;
  if (aliveSides().every(x => x.ready)) enemyPhase(); else render();
}
async function endSides(sides) {
  const c = C();
  const fw = sides.filter(s => P(s.pi).hero === 'duelist' && s.flow > 0);
  sides.forEach(s => { s.flowEnd = s.flow; });
  if (fw.length) {
    fw.forEach(s => { G.fxSeq++; s.fwS = G.fxSeq; s.fwN = s.flow; });
    render();
    await wait(paceRow().footwork);
    if (G.combat !== c) return;
    fw.forEach(s => { A = s; gain(2 * s.flow); log('Footwork: ' + heroName(s.pi) + '’s ' + s.flow + ' Flow became ' + 2 * s.flow + ' Block.'); s.flow = 0; });
    render();
    await wait(paceRow().footwork2);
    if (G.combat !== c) return;
  }
  for (const s of sides) {
    A = s;
    if (s.rampart) { gain(3 * s.rampart); log('Rampart: +' + 3 * s.rampart + ' Block.'); }
    if (s.stance === 'iron') { gain(4 + s.ironplus); log('Iron stance: +' + (4 + s.ironplus) + ' Block.'); }
    const bells = s.hand.filter(x => x.id === 'doombell').length;
    const burns = s.hand.filter(x => x.id === 'burn').length;
    const self = (c.finalToll ? 5 * bells : 0) + 3 * burns;
    if (self) { hurtSide(s, self, null); log('Cards in ' + heroName(s.pi) + '’s hand burn for ' + self + '.'); if (c.over) return; }
    s.hand.forEach(x => (CARDS[x.id].eth ? s.exhaust : s.discard).push(x));
    s.hand = [];
    if (s.weak > 0) s.weak--;
    if (s.frail > 0) s.frail--;
  }
}
async function enemyPhase() {
  const c = C();
  c.busy = true;
  await endSides(aliveSides());
  if (G.combat !== c) return;
  if (c.over) return render();
  render();
  await wait(paceRow().phase);
  const actors = aliveEnemies().slice();
  for (const e of actors) {
    if (e.dead) continue;
    if (e.burn > 0) {
      const bd = e.burn; e.hp -= bd; e.burn--;
      e.hitS = float(tagOf(e), '−' + bd + ' Burn', '');
      log(e.n + ' burns for ' + bd + '.');
      if (e.hp <= 0) kill(e, e.burnBy != null ? e.burnBy : null); else checkPhase(e);
      if (e.dead) continue;
    }
    e.block = 0; e.rooted = false; e.intangible = false; e.reflect = false; e.parry = false;
    if (e.ritual) { e.str += e.ritual; float(tagOf(e), '+' + e.ritual + ' Strength', 'buff'); }
    const acts = e.key === 'cog' && e.p2 ? 2 : 1;
    for (let k = 0; k < acts; k++) {
      if (e.dead) break;
      let T = c.S[e.tg];
      if (!T || T.down) { const al = aliveSides(); if (!al.length) break; T = pick(al); e.tg = T.pi; }
      e.acting = true; e.actS = fx(tagOf(e), '', 'miss'); render();
      await wait(paceRow().telegraph);
      if (G.combat !== c) return;
      c.S.forEach(s => { s.hurtNow = false; });
      enemyAct(e, T);
      e.acting = false;
      if (c.over) return render();
      e.pi++;
      render();
      await wait(paceRow().after);
      if (G.combat !== c) return;
    }
    if (actors.indexOf(e) < actors.length - 1) { await wait(paceRow().gap); if (G.combat !== c) return; }
    if (e.weak > 0) e.weak--;
    if (e.chill > 0) e.chill--;
    if (e.vuln > 0) e.vuln--;
  }
  if (G.combat !== c) return;
  c.S.forEach(s => { if (s.vuln > 0) s.vuln--; });
  if (!aliveEnemies().length) { win(); return; }
  startRound();
}
function enemyAct(e, T) {
  const c = C();
  const it = intentOf(e);
  const tt = tagOf(T);
  const others = () => aliveEnemies().filter(x => x !== e);
  if (it.block) { e.block += it.block; float(tagOf(e), '+' + it.block + ' Block', 'block'); }
  if (it.k === 'atk') {
    let hits = it.hits || 1;
    if (it.tax && T.played >= 7) hits *= 2;
    const base = it.mimic ? T.lastAttack : it.dmg;
    let total = 0;
    for (let h = 0; h < hits; h++) {
      if (e.dead || T.down) break;
      const d = enemyDmg(e, base, T); total += d; hurtSide(T, d, e, it.steal);
      if (c.over) return;
    }
    log(e.n + ' uses ' + it.l + ' on ' + heroName(T.pi) + ' for ' + total + '.');
    if (it.heal && !e.dead) { e.hp = Math.min(e.max, e.hp + it.heal); float(tagOf(e), '+' + it.heal, 'heal'); }
    if (it.weak) { T.weak += it.weak; float(tt, 'Weak', 'buff'); }
    if (it.vuln) { T.vuln += it.vuln; float(tt, 'Vulnerable', 'buff'); }
    if (it.frail) { T.frail += it.frail; float(tt, 'Frail', 'buff'); }
    if (it.harmony && aliveEnemies().filter(x => x.key === 'choir').length === 3) { e.str += 2; float(tagOf(e), '+2 Strength', 'buff'); }
    if (it.addCard) { T.draw.splice(rnd(0, T.draw.length), 0, mk(it.addCard)); log('A ' + CARDS[it.addCard].n + ' is shuffled into ' + heroName(T.pi) + '’s draw pile.'); }
    if (it.selfStr) { e.str += it.selfStr; float(tagOf(e), '+' + it.selfStr + ' Strength', 'buff'); }
  } else if (it.k === 'block') {
    e.block += it.v; if (it.root) e.rooted = true;
    float(tagOf(e), '+' + it.v + ' Block', 'block');
    log(e.n + ' uses ' + it.l + ' (Block ' + it.v + ').');
  } else if (it.k === 'debuff') {
    if (it.weak) { T.weak += it.weak; float(tt, 'Weak', 'buff'); }
    if (it.drain) { T.drain += it.drain; float(tt, '−1 Energy next turn', 'buff'); }
    if (it.hush) { T.hush = 1; float(tt, 'Hushed', 'buff'); }
    if (it.steal) { const p = P(T.pi); const st = Math.min(p.gold, it.steal); p.gold -= st; e.stolen[T.pi] = (e.stolen[T.pi] || 0) + st; float(tt, '−' + st + ' gold', 'buff'); }
    if (it.erase && T.draw.length) { const j = rnd(0, T.draw.length - 1); const cd = T.draw.splice(j, 1)[0]; T.exhaust.push(cd); log(e.n + ' erases ' + CARDS[cd.id].n + ' from ' + heroName(T.pi) + '’s draw pile.'); float(tt, 'Erased: ' + CARDS[cd.id].n, 'buff'); }
    log(e.n + ' uses ' + it.l + ' on ' + heroName(T.pi) + '.');
  } else if (it.k === 'buff') {
    if (it.str) { e.str += it.str; float(tagOf(e), '+' + it.str + ' Strength', 'buff'); }
    if (it.thorns) { e.thorns += it.thorns; float(tagOf(e), '+' + it.thorns + ' Thorns', 'buff'); }
    if (it.ally) { const o = others(); (o.length ? o : [e]).forEach(x => { x.str += it.ally; float(tagOf(x), '+' + it.ally + ' Strength', 'buff'); }); }
    if (it.ritual) { e.ritual += it.ritual; float(tagOf(e), 'Ritual', 'buff'); }
    if (it.reflect) { e.reflect = true; float(tagOf(e), 'Reflecting', 'buff'); }
    if (it.parry) { e.parry = true; float(tagOf(e), 'En Garde', 'buff'); }
    if (it.intangible) { e.intangible = true; float(tagOf(e), 'Intangible', 'buff'); }
    log(e.n + ' uses ' + it.l + '.');
  } else if (it.k === 'status') {
    for (let k = 0; k < it.v; k++) {
      const card = mk(it.card);
      if (it.discard) T.discard.push(card); else T.draw.splice(rnd(0, T.draw.length), 0, card);
      if (it.perm) P(T.pi).deck.push(mk(it.card));
    }
    float(tt, '+' + it.v + ' ' + CARDS[it.card].n, 'buff');
    log(e.n + ' uses ' + it.l + ': ' + it.v + ' ' + CARDS[it.card].n + ' for ' + heroName(T.pi) + (it.perm ? ', permanently.' : '.'));
  } else if (it.k === 'summon') {
    const cnt = aliveEnemies().length;
    if (it.howl && cnt > 1) { e.str += 2; float(tagOf(e), '+2 Strength', 'buff'); log(e.n + ' howls: +2 Strength.'); }
    else {
      const room = Math.max(0, 4 - cnt);
      const n = Math.min(it.count, room);
      for (let k = 0; k < n; k++) { const pup = makeEnemy(it.key, c.enemies.length, k, it.hp); pup.n = it.hp <= 22 ? 'Scrap Pup' : pup.n; pup.tg = pick(aliveSides()).pi; c.enemies.push(pup); }
      log(e.n + ' uses ' + it.l + (n ? ': ' + n + ' joins the fight.' : ', but there is no room.'));
    }
  } else if (it.k === 'flee') {
    e.dead = true; e.deadS = fx(tagOf(e), 'Fled', 'miss');
    const tot = Object.values(e.stolen).reduce((a, b) => a + b, 0);
    log(e.n + ' flees with ' + tot + ' gold.');
  }
}
function win() {
  const c = C();
  if (!c || c.over) return;
  c.over = true;
  seedStream(null);
  c.S.forEach(s => { P(s.pi).hp = s.down ? Math.ceil(s.max * 0.25) : Math.max(1, s.hp); });
  G.P.forEach((p, pi) => { p.hp = Math.min(p.maxHp, p.hp + 2 + (hasR(pi, 'ember') ? 5 : 0) + (hasR(pi, 'bloodchalice') ? 8 : 0)); if (hasR(pi, 'luckycoin')) p.gold += 10; });
  resetDone();
  const Act = G.act;
  if (c.kind === 'boss') {
    if (Act >= 3) {
      if (G.P.length > 1) { G.screen = 'duelintro'; return render(); }
      G.screen = 'victory'; clearSave(); return render();
    }
    G.P.forEach((p, pi) => {
      seedStream(G.seed ? G.seed + '|boss|' + Act + '|' + pi : null);
      const relic = freeRelic(pi, true); gainRelic(pi, relic);
      const healed = Math.ceil((p.maxHp - p.hp) * 0.4); p.hp += healed;
      const gold = rnd(60, 80) * goldMul(); p.gold += gold;
      p.actclear = { act: Act, boss: G.map.boss, relic, healed, gold, cards: cardChoices(pi, 3, 'boss'), taken: false };
    });
    seedStream(null);
    G.screen = 'actclear';
    return render();
  }
  const elite = c.kind === 'elite';
  G.P.forEach((p, pi) => {
    seedStream(G.seed ? G.seed + '|rw|' + Act + '|' + G.floor + '|' + pi : null);
    const gold = ((elite ? rnd(28, 36) : rnd(12, 20)) + (Act - 1) * 6) * goldMul();
    p.gold += gold;
    const relic = elite ? freeRelic(pi) : null;
    gainRelic(pi, relic);
    p.reward = { gold, relic, cards: cardChoices(pi, 3, elite ? 'elite' : 'fight'), taken: false };
    const rp = (p.pot || []).length < POT_MAX && rnd(1, 100) <= potDropChance(elite) ? potionPick(p) : null;
    if (rp) { p.pot = (p.pot || []).concat(rp); p.reward.pot = rp; }
  });
  seedStream(null);
  G.screen = 'reward';
  render();
}

/* ---------- Duel ---------- */
function startDuel() {
  const first = rnd(0, 1);
  G.combat = { kind: 'duel', enemies: [], S: G.P.map((p, i) => newSide(i)), turn: 1, over: false, busy: false, log: [], duel: { active: first, round: 1, first }, finalToll: false };
  G.screen = 'combat';
  log('Only one mask may leave the Spire. ' + heroName(first) + ' strikes first.');
  banner('The duel begins! ' + heroName(first) + ' goes first.');
  startTurnSide(C().S[first]);
  render();
}
async function duelEndTurn() {
  const c = C();
  c.busy = true;
  const s = c.S[c.duel.active];
  await endSides([s]);
  if (G.combat !== c || c.over) return render();
  const o = opp(s);
  if (o.vuln > 0) o.vuln--;
  if (o.pi === c.duel.first) c.duel.round++;
  c.duel.active = o.pi;
  c.busy = false;
  startTurnSide(o);
  if (c.duel.round > 8) {
    const dmg = 2 * (c.duel.round - 8);
    o.hp -= dmg; float(tagOf(o), '−' + dmg + ' Sudden death'); anim(o, 'hurt');
    log('Sudden death: ' + heroName(o.pi) + ' loses ' + dmg + ' HP.');
    if (o.hp <= 0) sideDown(o);
  }
  render();
}
function duelOver(winner) {
  const c = C();
  c.over = true; syncHP();
  G.duelWinner = winner;
  G.screen = 'duelend';
  clearSave();
  render();
}

/* ---------- Actions (host applies for every player) ---------- */
function doAction(pi, a, x, y) {
  if (!G || !G.P[pi]) return;
  const p = G.P[pi];
  const scr = G.screen;
  switch (a) {
    case 'hero':
      if (scr === 'lobby' && HEROES[x]) { p.hero = x; render(); }
      break;
    case 'mods':
      if (scr === 'lobby' && pi === 0 && x != null) { G.mods = normMods(x); render(); }
      break;
    case 'diff':
      if (scr === 'lobby' && pi === 0 && x != null) { G.diff = normDiff(x); render(); }
      break;
    case 'start':
      if (scr === 'lobby' && pi === 0 && G.P.length === 2 && G.P.every(q => q.hero) && G.P[1].conn) {
        G.P.forEach(q => equipHero(q, q.hero, G.mods)); G.started = true; G.screen = 'map'; resetDone(); render();
      }
      break;
    case 'node': if (scr === 'map') { const [r, l] = String(x).split('-').map(Number); vote(pi, r, l); } break;
    case 'card': playCard(pi, Number(x), y == null ? null : Number(y)); break;
    case 'end': endTurnAction(pi); break;
    case 'potion': usePotion(pi, Number(x)); break;
    case 'reward': if (scr === 'reward' && p.reward && !p.reward.taken && p.reward.cards[x]) { p.deck.push(mk(p.reward.cards[x])); p.reward.taken = true; render(); } break;
    case 'bossreward': if (scr === 'actclear' && p.actclear && !p.actclear.taken && p.actclear.cards[x]) { p.deck.push(mk(p.actclear.cards[x])); p.actclear.taken = true; render(); } break;
    case 'done': if (['reward', 'treasure', 'shop', 'event', 'actclear', 'duelintro'].includes(scr)) { p.done = true; advanceIfDone(); } break;
    case 'restheal': if (scr === 'rest' && !p.done) { p.hp = Math.min(p.maxHp, p.hp + Math.ceil(p.maxHp * 0.25)); p.done = true; advanceIfDone(); } break;
    case 'upgrade': {
      const k = p.deck.find(q => q.u === Number(x));
      if (scr === 'rest' && !p.done && k && (k.lv || 0) < 3 && CARDS[k.id].c >= 0 && !CARDS[k.id].curse) { k.lv = (k.lv || 0) + 1; p.done = true; note(pi, CARDS[k.id].n + ' upgraded to +' + k.lv + '.'); advanceIfDone(); }
      break;
    }
    case 'remove': {
      const i = p.deck.findIndex(c => c.u === Number(x));
      if (i < 0 || p.deck.length <= 5) break;
      if (scr === 'rest' && !p.done && y === 'rest') { p.deck.splice(i, 1); p.done = true; advanceIfDone(); }
      else if (scr === 'shop' && y === 'shop' && p.shop && !p.shop.removed && p.gold >= 60) { p.deck.splice(i, 1); p.gold -= 60; p.shop.removed = true; render(); }
      else if (scr === 'event' && y === 'event' && p.event && p.event.k === 'library' && p.event.card && !p.event.used && !p.done && p.maxHp > EVT.libHp) { const rc = p.event.card; p.deck.splice(i, 1); p.deck.push(mk(rc)); p.maxHp -= EVT.libHp; p.hp = Math.min(p.hp, p.maxHp); p.event.used = true; p.event.msg = 'The library takes a page from you and a piece of your health. You gain ' + CARDS[rc].n + '.'; render(); }
      break;
    }
    case 'evt': {
      const e = p.event;
      if (scr !== 'event' || !e || e.used || p.done) break;
      const ch = Number(x) || 0;
      if (ch) { evtAlt(pi, p, e, ch); render(); break; }
      if (e.k === 'pact' && e.relic && p.hp > EVT.pactHp) { p.hp -= EVT.pactHp; gainRelic(pi, e.relic); e.msg = 'The mask drinks deep. You gain ' + RELICS[e.relic].n + '.'; e.used = true; }
      else if (e.k === 'idol' && p.gold >= EVT.idolCost) {
        p.gold -= EVT.idolCost;
        if (e.win) { const g = EVT.idolWin * goldMul(); p.gold += g; e.msg = 'The idol smiles. You win ' + g + ' gold.'; }
        else { p.hp = Math.max(1, p.hp - EVT.idolLoss); e.msg = 'The idol laughs. You lose ' + EVT.idolLoss + ' HP.'; }
        e.used = true;
      }
      else if (e.k === 'forge' && e.cards && e.cards.length && p.hp > EVT.forgeHp) { p.hp -= EVT.forgeHp; e.cards.forEach(id => p.deck.push(mk(id))); e.msg = 'The forge scalds you and hands over ' + e.cards.map(id => CARDS[id].n).join(' and ') + '.'; e.used = true; }
      else if (e.k === 'well') {
        if (e.win) { const h = Math.ceil(p.maxHp * EVT.wellHeal); p.hp = Math.min(p.maxHp, p.hp + h); e.msg = 'The water is warm and sweet. You recover up to ' + h + ' HP.'; }
        else { p.hp = Math.max(1, p.hp - EVT.wellLoss); e.msg = 'The water is bitter and cold. You lose ' + EVT.wellLoss + ' HP.'; }
        e.used = true;
      }
      else if (e.k === 'vein' && p.maxHp > EVT.veinMax + 24) { p.maxHp -= EVT.veinMax; p.hp = p.maxHp; e.msg = 'The vein runs dry and you are made whole. You lose ' + EVT.veinMax + ' max HP.'; e.used = true; }
      else if (e.k === 'coin') { const g = EVT.coinGold * goldMul(); p.gold += g; p.deck.push(mk('fate')); e.msg = 'The coins are yours: +' + g + ' gold. A Fate curse follows you.'; e.used = true; }
      else if (e.k === 'omen') {
        if (e.win) { p.maxHp += EVT.omenMax; p.hp = Math.min(p.maxHp, p.hp + EVT.omenMax); e.msg = 'The shrine glows. You gain ' + EVT.omenMax + ' max HP.'; }
        else { p.hp = Math.max(1, p.hp - EVT.omenLoss); e.msg = 'The shrine rejects you. You lose ' + EVT.omenLoss + ' HP.'; }
        e.used = true;
      }
      else if (e.k === 'bone' && p.hp > EVT.boneHp) { const g = EVT.boneGold * goldMul(); p.hp -= EVT.boneHp; p.gold += g; e.msg = 'The merchant takes his due in blood. You gain ' + g + ' gold.'; e.used = true; }
      else if (e.k === 'mirror' && e.card) {
        if (e.win) { const n = mk(e.card); if (e.lv) n.lv = e.lv; p.deck.push(n); e.msg = 'The mirror answers. A second ' + CARDS[e.card].n + ' steps out.'; }
        else { p.deck.push(mk('fate')); e.msg = 'The mirror cracks and a Fate curse slips into your deck.'; }
        e.used = true;
      }
      else note(pi, 'You cannot do that.');
      render(); break;
    }
    case 'buy': {
      if (scr !== 'shop' || !p.shop) break;
      const s = p.shop.cards[x];
      if (!s || s.sold) break;
      if (s.price > p.gold) { note(pi, 'Not enough gold.'); render(); break; }
      p.gold -= s.price; s.sold = true; p.deck.push(mk(s.id)); note(pi, CARDS[s.id].n + ' added to your deck.'); render();
      break;
    }
    case 'buyrelic': {
      const sr = p.shop && p.shop.relic;
      if (scr !== 'shop' || !sr || sr.sold || !RELICS[sr.id] || hasR(pi, sr.id)) break;
      if (sr.price > p.gold) { note(pi, 'Not enough gold.'); render(); break; }
      p.gold -= sr.price; sr.sold = true; gainRelic(pi, sr.id); note(pi, RELICS[sr.id].n + ' acquired.'); render();
      break;
    }
    case 'buypot': {
      const sp = p.shop && p.shop.pot;
      if (scr !== 'shop' || !sp || sp.sold) break;
      if ((p.pot || []).length >= POT_MAX) { note(pi, 'Your potion belt is full.'); render(); break; }
      if (sp.price > p.gold) { note(pi, 'Not enough gold.'); render(); break; }
      p.gold -= sp.price; sp.sold = true; p.pot = (p.pot || []).concat(sp.id); note(pi, POTIONS[sp.id].n + ' added to your belt.'); render();
      break;
    }
    case 'rematch':
      if (G.mode === 'coop' && ['defeat', 'victory', 'duelend'].includes(scr)) {
        p.done = true;
        if (G.P.every(q => q.done || !q.conn)) {
          G.P.forEach(q => {
            const keep = { conn: q.conn, ack: q.ack };
            const hero = q.hero, tok = q.tok;
            Object.keys(q).forEach(k => { delete q[k]; });
            Object.assign(q, newPlayer(hero, tok, G.mods), keep);
          });
          G.map = genMap(); G.act = 1; G.floor = 0; G.pos = null; G.combat = null; G.fx = [];
          G.duelWinner = null; G.started = false; G.screen = 'lobby';
        }
        render();
      }
      break;
    default: break;
  }
}

/* ---------- Save hooks ---------- */
function save() { if (hooks.save) hooks.save(G, uidN); }
function clearSave() { if (hooks.clear) hooks.clear(); }
function render() { if (hooks.onChange) hooks.onChange(); }

/* ---------- View building (what one player sees) ---------- */
function describeIntent(e, it, T) {
  const c = C();
  const extra = [];
  if (it.hidden) return { c: 'k-deb', v: '?', x: 'Unknown intent', tot: 0 };
  if (it.block) extra.push('gains ' + it.block + ' Block');
  if (it.k === 'atk') {
    const base = it.mimic ? (T ? T.lastAttack : 5) : it.dmg;
    const d = enemyDmg(e, base, T);
    let hits = it.hits || 1;
    if (it.tax && T && T.played >= 7) hits *= 2;
    if (it.heal) extra.push('heals ' + it.heal);
    if (it.steal) extra.push('steals gold');
    if (it.weak) extra.push('Weak');
    if (it.vuln) extra.push('Vulnerable');
    if (it.frail) extra.push('Frail');
    if (it.harmony) extra.push(aliveEnemies().filter(x => x.key === 'choir').length === 3 ? 'then +2 Strength' : 'harmony broken');
    if (it.addCard) extra.push('adds a ' + CARDS[it.addCard].n);
    if (it.selfStr) extra.push('then +' + it.selfStr + ' Strength');
    if (it.tax) extra.push('hits twice at 7+ cards (' + (T ? T.played : 0) + ' so far)');
    const what = it.mimic ? 'copies the last Attack' : hits > 1 ? hits + ' hits (' + d * hits + ' total)' : 'attacks';
    return { c: 'k-atk', v: d + (hits > 1 ? '×' + hits : ''), m: hits > 1 ? 1 : 0, x: it.l + ': ' + what + (extra.length ? ', ' + extra.join(', ') : ''), tot: d * hits };
  }
  if (it.k === 'block') return { c: 'k-def', v: it.v, x: it.l + ': gains ' + it.v + ' Block' + (it.root ? ' and roots' : ''), tot: 0 };
  if (it.k === 'buff') {
    if (it.str) extra.push('+' + it.str + ' Strength');
    if (it.thorns) extra.push('+' + it.thorns + ' Thorns');
    if (it.ally) extra.push('+' + it.ally + ' Strength to allies');
    if (it.ritual) extra.push('gains ' + it.ritual + ' Strength every turn');
    if (it.reflect) extra.push('reflects half of Attack damage');
    if (it.parry) extra.push('parries the first hit');
    if (it.intangible) extra.push('Intangible (hits deal 1)');
    return { c: 'k-buf', v: '', x: it.l + ': ' + extra.join(', '), tot: 0 };
  }
  if (it.k === 'debuff') {
    if (it.weak) extra.push('Weak (deal 1 less damage per stack)');
    if (it.drain) extra.push('−1 Energy next turn');
    if (it.steal) extra.push('steals ' + it.steal + ' gold');
    if (it.erase) extra.push('erases a card from the draw pile');
    if (it.hush) extra.push('no Powers next turn');
    return { c: 'k-deb', v: '', x: it.l + ': ' + extra.join(', '), tot: 0 };
  }
  if (it.k === 'status') return { c: 'k-deb', v: '×' + it.v, x: it.l + ': adds ' + it.v + ' ' + CARDS[it.card].n + (it.perm ? ' to the deck forever' : it.discard ? ' to the discard pile' : ' to the draw pile'), tot: 0 };
  if (it.k === 'summon') {
    const alone = aliveEnemies().length <= 1;
    return { c: 'k-buf', v: '', x: it.l + ': ' + (it.howl && !alone ? '+2 Strength' : 'summons ' + it.count + ' Scrap ' + (it.hp <= 22 ? 'Pup' : 'Hound') + (it.count > 1 ? 's' : '')), tot: 0 };
  }
  if (it.k === 'flee') return { c: 'k-deb', v: '', x: it.l + ': escapes with the stolen gold', tot: 0 };
  return { c: 'k-buf', v: '', x: it.l, tot: 0 };
}
function guardOf(s) {
  return s.block + (P(s.pi).hero === 'duelist' ? 2 * s.flow : 0) + 3 * s.rampart + (s.stance === 'iron' ? 4 + s.ironplus : 0);
}
/* Walk living enemies in real act order, tracking Vulnerable applied to each target by earlier attacks (it lands after the hits, like enemyAct). */
function simIncoming(me) {
  const c = C();
  const vul = c.S.map(s => s.vuln > 0);
  const out = { inc: 0, T: {}, tot: {} };
  aliveEnemies().forEach(e => {
    const base = c.S[e.tg];
    if (!base) { out.tot[e.idx] = 0; return; }
    const acts = e.key === 'cog' && e.p2 ? 2 : 1;
    let t = 0;
    for (let k = 0; k < acts; k++) {
      const it = intentOf(e, k);
      const sim = Object.assign({}, base, { vuln: vul[base.pi] ? 1 : 0 });
      if (k === 0) out.T[e.idx] = sim;
      t += describeIntent(e, it, sim).tot;
      if (it.k === 'atk' && it.vuln) vul[base.pi] = true;
    }
    out.tot[e.idx] = t;
    if (e.tg === me) out.inc += t;
  });
  return out;
}
function enemyTotal(e) {
  return simIncoming(e.tg).tot[e.idx] || 0;
}
function previewCard(id, s, e) {
  const f = s.flow || 0, r = s.rage || 0, bl = s.block || 0, sw = s.sw || 0;
  const tbl = {
    strike: [7], lunge: [5], riposte: [5], flurry: [2, 3], needle: [3], crescendo: [4 + 4 * f], bladedance: [3, 2 + f],
    pinpoint: [7], hamstring: [7], whirl: [5], coup: [e.hp * 2 < e.max ? 22 : 14], cascade: [6], finale: [5 * f],
    bstrike: [6], bash: [Math.floor(bl / 2)], counter: [6], bulldoze: [Math.floor(bl / 2)], flare: [4], heavyswing: [16],
    rstrike: [7], haymaker: [14], cleave: [7], uppercut: [12], frenzy: [3, 4], headbutt: [9], reckless: [9], rampage: [5 + 3 * r], feast: [18],
    eruption: [9], wildswing: [8], formbreak: [6 + 6 * sw], avalanche: [7, 1 + sw],
    estrike: [6], sparkjolt: [5], emberlash: [4], rimespiral: [5], cinderbolt: [4], scorch: [9], icelance: [7], stormcrash: [11], tempest: [6, 2]
  };
  const row = tbl[id];
  if (!row || (id === 'finale' && !f)) return null;
  const hits = row[1] || 1, st = s.st || [], sx = s.sx || [];
  let d = row[0] + (s.sr || 0) + r + (s.wh || 0) + (st[7] || 0) * f;
  if (st[0] > 0) d = Math.floor(d * 0.75);
  if (s.sn === 'fury') d = Math.floor(d * 1.5);
  if (s.sn === 'iron' && !sx[2]) d = Math.floor(d * 0.75);
  const es = e.st || [];
  if (es[3] > 0) d = Math.floor(d * 1.5);
  if (es[6]) d = Math.floor(d / 2);
  d = Math.max(0, Math.floor(d * (e.key === 'cog' && e.p2 ? 1.25 : 1)));
  if (es[7]) d = Math.min(d, 1);
  let hp = e.hp, blk = e.block || 0, loss = 0, blocked = 0, parried = 0, parry = !!es[9];
  for (let i = 0; i < hits; i++) {
    if (hp <= 0) break;
    if (parry && d > 0) { parry = false; parried++; continue; }
    const ab = Math.min(blk, d);
    blk -= ab; blocked += ab; hp -= d - ab; loss += d - ab;
  }
  return { d, hits, loss, blocked, parried, lethal: hp <= 0, hp: Math.max(0, hp) };
}
function sideView(s) {
  const hero = P(s.pi).hero;
  return {
    pi: s.pi, hp: s.hp, mx: s.max, block: s.block, gd: guardOf(s), energy: s.energy, flow: s.flow, rage: s.rage,
    st: [s.weak, s.vuln, s.frail, s.hushNow, s.drain, s.thorns, s.composure, s.rhythm, s.keep, s.rampart, s.keepAll, s.bloodpact, s.ragegain],
    sn: s.stance, sw: s.switches, sx: [s.mantra, s.serenity, s.ironplus],
    rdy: s.ready ? 1 : 0, dn: s.down ? 1 : 0, an: [s.animS, s.animK], el: s.el || '', eu: s.elu ? s.elu.length : 0, fw: [s.fwS, s.fwN], hn: s.hand.length,
    kb: hero === 'bulwark' ? (s.keepAll ? s.block : Math.floor(s.block / 2)) : 0,
    sr: s.str || 0, wh: hasR(s.pi, 'whetstone') ? 1 : 0
  };
}
function buildView(me) {
  const p = G.P[me];
  const V = {
    me, n: G.P.length, mode: G.mode, code: G.code, scr: G.screen, act: G.act, floor: G.floor, tok: p ? p.tok : null, ack: p ? p.ack : 0,
    P: G.P.map(q => ({ h: q.hero, hp: q.hp, mx: q.maxHp, g: q.gold, rl: q.relics, dn: q.done ? 1 : 0, vt: q.vote, on: q.conn ? 1 : 0, k: q.kills })),
    deck: p ? p.deck.map(x => [x.u, x.id, x.lv || 0]) : [], fx: G.fx.slice(-12), started: G.started ? 1 : 0, df: normDiff(G.diff), md: normMods(G.mods), rs: p ? { cp: p.cp || 0, dm: p.dmg || 0, tn: p.tn || 0 } : null, pt: p ? (p.pot || []) : []
  };
  const c = G.combat;
  if (G.screen === 'map') {
    V.map = G.map.rows.map(r => r.map(n => [n.type, n.next, n.done ? 1 : 0]));
    V.pos = G.pos; V.av = available().map(a => a.r + '-' + a.l); V.bsk = G.map.boss || null;
  }
  if (c && G.screen === 'combat') {
    c.S.forEach(s => { V.P[s.pi].hp = s.hp; });
    const s = c.S[me];
    const sim = c.duel ? { inc: 0, T: {}, tot: {} } : simIncoming(me);
    const en = c.enemies.filter(e => !e.dead || e.deadS > (G.fxSeq - 14)).map(e => {
      const T = sim.T[e.idx] || c.S[e.tg];
      const it = e.dead ? null : describeIntent(e, intentOf(e), T);
      if (it && e.key === 'cog' && e.p2) { it.x += ' · then ' + intentOf(e, 1).l; it.tot = sim.tot[e.idx] != null ? sim.tot[e.idx] : enemyTotal(e); }
      const nx = intentOf(e, e.key === 'cog' && e.p2 ? 2 : 1);
      return { idx: e.idx, key: e.key, n: e.n, variant: e.variant, hp: e.hp, max: e.max, block: e.block, split: e.split ? 1 : 0, p2: e.p2 ? 1 : 0, dead: e.dead ? 1 : 0,
        st: [e.str, e.ritual, e.weak, e.vuln, e.thorns, e.artifact, e.rooted ? 1 : 0, e.intangible ? 1 : 0, e.reflect ? 1 : 0, e.parry ? 1 : 0, Object.values(e.stolen).reduce((a, b) => a + b, 0), e.burn || 0, e.chill || 0, e.shock || 0],
        it, tg: e.tg, nx: nx.hidden ? '???' : nx.l, hs: e.hitS, ds: e.deadS, ac: e.actS || 0 };
    });
    const inc = sim.inc;
    const guard = guardOf(s);
    const parts = { bl: s.block, fw: P(me).hero === 'duelist' ? 2 * s.flow : 0, flow: s.flow, rp: 3 * s.rampart, rpn: s.rampart, ir: s.stance === 'iron' ? 4 + s.ironplus : 0 };
    V.cb = {
      k: c.kind, t: c.turn, busy: c.busy ? 1 : 0, logs: c.log.slice(0, 5), duel: c.duel ? { a: c.duel.active, r: c.duel.round } : null, toll: c.finalToll ? 1 : 0,
      en, S: c.S.map(sideView), hand: s.hand.map(x => [x.u, x.id, x.lv || 0]), piles: [s.draw.length, s.discard.length, s.exhaust.length], pc: [s.draw, s.discard, s.exhaust].map(a => a.map(x => x.id).sort()), pwr: (s.pwr || []).slice().sort(), played: s.played, pl: c.pl || null,
      inc: { tot: inc, guard, parts, extra: guard > s.block ? 1 : 0 }
    };
  }
  if (G.screen === 'reward') V.rw = p.reward;
  if (G.screen === 'shop') V.shop = p.shop;
  if (G.screen === 'treasure') V.tr = p.treasure;
  if (G.screen === 'event') V.ev = p.event ? Object.assign({}, p.event, { win: undefined, c: EVT }) : null;
  if (G.screen === 'actclear') V.ac = p.actclear;
  if (G.screen === 'duelend') V.win = G.duelWinner;
  return V;
}
const ENC = new TextEncoder();
const bytes = o => ENC.encode(JSON.stringify(o)).length;
const LIMIT = 3850;
function fitView(V) {
  if (bytes(V) > LIMIT && V.cb) V.cb.logs = V.cb.logs.slice(0, 1);
  if (bytes(V) > LIMIT && V.cb) V.cb.pl = null;
  if (bytes(V) > LIMIT) V.fx = V.fx.slice(-6);
  if (bytes(V) > LIMIT) { V.deck = []; V.deckCut = 1; }
  if (bytes(V) > LIMIT && V.cb) V.cb.en.forEach(e => { if (e.it) e.it.x = e.it.x.slice(0, 40); });
  if (bytes(V) > LIMIT) V.fx = [];
  return V;
}


return {
  get G() { return G; }, set G(v) { G = v; },
  get uidN() { return uidN; }, set uidN(v) { uidN = v; },
  dailyChallenge, doAction, buildView, previewCard, newPlayer, baseG, equipHero, startCombat, startDuel, win,
  DIFFS, MODS, CARDS, RAR, RAR_NAME, HEROES, RELICS, EN, ACTS, BOSS_SIZE, STANCE, ROWS, LANES, PRICE, POTIONS, POT_MAX
};
}
if (typeof module !== 'undefined' && module.exports) module.exports = { createEngine };
else root.createEngine = createEngine;
})(typeof self !== 'undefined' ? self : this);
