/* Masked Spire game engine: rules, data and per-player views.
   Shared by the browser (solo runs) and the Render server (co-op matches).
   Each call to createEngine() is an independent game. */
(function (root) {
'use strict';
function createEngine(hooks) {
hooks = hooks || {};
const REDUCE = !!hooks.reduce;

const rnd = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
const pick = a => a[Math.floor(Math.random() * a.length)];
function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
const wait = ms => new Promise(r => setTimeout(r, REDUCE ? Math.min(ms, 120) : ms));
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
  counter: 'c', taunt: 'c', heavyswing: 'c', endure: 'c', chainlock: 'c', flare: 'c',
  ironwall: 'u', spikes: 'u', ironresolve: 'u', rampart: 'u',
  reinforce: 'r', bulldoze: 'r', bastion: 'r',
  cleave: 'c', headbutt: 'c', ironhide: 'c', frenzy: 'c', reckless: 'c', braceimpact: 'c',
  uppercut: 'u', warcry: 'u', intimidate: 'u', feast: 'u',
  rampage: 'r', bloodpact: 'r', unstoppable: 'r',
  eruption: 'c', innerpeace: 'c', ironform: 'c', wildswing: 'c', breathe: 'c',
  formbreak: 'u', tidal: 'u',
  avalanche: 'r', mantra: 'r', serenity: 'r', bastionform: 'r'
};
const RAR_NAME = { c: 'Common', u: 'Uncommon', r: 'Rare' };
const RAR_ODDS = { fight: [62, 32, 6], elite: [40, 45, 15], shop: [55, 35, 10], boss: [0, 50, 50] };
const PRICE = { c: [45, 55], u: [68, 82], r: [130, 150] };


/* ---------- Heroes ---------- */
const HEROES = {
  duelist: {
    n: 'The Duelist', tag: 'Slim · speed & combos', hp: 85, relic: 'mask', color: '#1C6670', edge: '#2E8E99',
    passive: 'Footwork: each Attack you play gives 1 Flow. At end of turn, each Flow becomes 2 Block.',
    starter: ['strike', 'strike', 'strike', 'strike', 'parry', 'parry', 'parry', 'parry', 'lunge', 'riposte'],
    pool: ['flurry', 'needle', 'feint', 'crescendo', 'bladedance', 'pinpoint', 'hamstring', 'whirl', 'coup', 'quickstep', 'secondwind', 'shadowstep', 'tempo', 'disarm', 'composure', 'momentum', 'flowguard', 'ebb', 'cascade', 'finale', 'rhythm', 'unbroken'],
    style: 'Chain cheap Attacks to build Flow, then cash it in or let Footwork turn it into Block.'
  },
  bulwark: {
    n: 'The Bulwark', tag: 'Heavy · block & endure', hp: 95, relic: 'lanternhelm', color: '#B4561B', edge: '#D07228',
    passive: 'Iron Shell: at the start of your turn, keep half your Block instead of losing it.',
    starter: ['bstrike', 'bstrike', 'bstrike', 'bstrike', 'defend', 'defend', 'defend', 'defend', 'bash', 'brace'],
    pool: ['ironwall', 'rampart', 'reinforce', 'counter', 'bulldoze', 'spikes', 'taunt', 'flare', 'bastion', 'chainlock', 'heavyswing', 'endure', 'ironresolve'],
    style: 'Stack Block that carries over between turns. Shield Bash turns half of it into damage, so you need a big wall first.'
  },
  brute: {
    n: 'The Brute', tag: 'Muscular · stances', hp: 90, relic: 'hornedmask', color: '#7E1B26', edge: '#B53A44',
    passive: 'Warrior Forms: switch between three stances. Fury: Attacks deal 50% more, you take 25% more. Iron: +4 Block at end of turn, Attacks deal 25% less. Calm: leaving it gives +2 Energy. Every switch draws a card.',
    starter: ['rstrike', 'rstrike', 'rstrike', 'rstrike', 'rdefend', 'rdefend', 'rdefend', 'rdefend', 'eruption', 'innerpeace'],
    pool: ['cleave', 'frenzy', 'ironhide', 'reckless', 'ironform', 'wildswing', 'breathe', 'uppercut', 'intimidate', 'feast', 'formbreak', 'tidal', 'avalanche', 'mantra', 'serenity', 'bastionform'],
    style: 'Bank Energy in Calm, cash it out in Fury, and drop into Iron before the big hits land.'
  }
};

/* ---------- Relics ---------- */
const RELICS = {
  mask:        { n: 'Cracked Mask', d: 'Start each combat with 1 Flow on your first turn.', start: 1 },
  lanternhelm: { n: 'Lantern Helm', d: 'Start each combat with 8 Block.', start: 1 },
  hornedmask:  { n: 'Horned Mask', d: 'Start each combat in Calm stance.', start: 1 },
  whetstone:   { n: 'Whetstone', d: 'Your Attacks deal 1 extra damage per hit.' },
  locket:      { n: 'Iron Locket', d: 'Start each combat with 6 Block.' },
  hourglass:   { n: 'Sand Hourglass', d: 'Draw 2 extra cards on your first turn.' },
  ember:       { n: 'Ember Ring', d: 'Heal 5 HP after each combat.' },
  quill:       { n: 'Golden Quill', d: 'Gain 1 extra Energy on your first turn.' },
  heartstone:  { n: 'Heartstone', d: 'Raise your Max HP by 12 when picked up.' },
  thornring:   { n: 'Thorn Ring', d: 'Start each combat with 2 Thorns.' },
  bellshard:   { n: 'Bell Shard', d: 'Enemies start each combat with 1 Vulnerable.' }
};

/* ---------- Enemies ---------- */
const EN = {
  /* Act I */
  moth:     { n: 'Lantern Moth', hp: [12, 14], bg: '#1F5F55', idle: 'flutter', pat: [{ k: 'debuff', weak: 1, l: 'Flicker' }, { k: 'atk', dmg: 5, l: 'Wing Slash' }], note: 'On death: adds a Dazed to your discard pile.' },
  rootling: { n: 'Rootling', hp: [17, 19], bg: '#23584A', pat: [{ k: 'block', v: 8, root: 1, l: 'Burrow' }, { k: 'atk', dmg: 5, l: 'Lash' }], note: 'Rooted: takes half damage until its next turn.' },
  crow:     { n: 'Masked Crow', hp: [14, 16], bg: '#1A4E58', pat: [{ k: 'atk', dmg: 3, hits: 2, steal: 2, l: 'Peck' }], note: 'Steals 2 gold per unblocked hit. Returns it if killed.' },
  leech:    { n: 'Bog Leech', hp: [19, 21], bg: '#2E4A30', pat: [{ k: 'atk', dmg: 5, heal: 4, l: 'Latch' }, { k: 'atk', dmg: 5, heal: 4, l: 'Latch' }, { k: 'block', v: 6, l: 'Submerge' }], note: 'Heals 4 each time it Latches.' },
  imp:      { n: 'Thorn Imp', hp: [15, 17], bg: '#3A5228', pat: [{ k: 'atk', dmg: 7, l: 'Jab' }, { k: 'buff', thorns: 2, l: 'Bristle' }], note: 'Thorns: you take damage for every hit you land.' },
  acolyte:  { n: 'Candle Acolyte', hp: [21, 23], bg: '#2A4652', pat: [{ k: 'buff', ally: 2, l: 'Kindle' }, { k: 'atk', dmg: 4, l: 'Singe' }], note: 'Kindle gives every other enemy +2 Strength.' },
  ogre:     { n: 'Mossback Ogre', hp: [70, 74], bg: '#2C4A2A', elite: 1, pat: [{ k: 'atk', dmg: 13, l: 'Smash' }, { k: 'atk', dmg: 13, l: 'Smash' }, { k: 'buff', str: 3, l: 'Bellow' }], note: 'Enrage: +2 Strength whenever you play a Skill.' },
  puppet:   { n: 'Puppeteer', names: ['Puppeteer of Mirth', 'Puppeteer of Sorrow'], hp: [33, 35], bg: '#3A3050', elite: 1, idle: 'sway', pat: [{ k: 'atk', mimic: 1, l: 'Mimic' }, { k: 'atk', dmg: 6, hits: 2, l: 'Cut' }], note: 'Mimic copies your last Attack. Kill one and the other gains 5 Strength.' },
  stag:     { n: 'Hollow Stag', hp: [82, 86], bg: '#1E3E3A', elite: 1, pat: [{ k: 'block', v: 12, l: 'Antler Guard' }, { k: 'atk', dmg: 9, l: 'Gore' }, { k: 'atk', dmg: 20, l: 'CHARGE' }], note: 'The Charge is always telegraphed a turn early.' },
  bell:     { n: 'The Weeping Bellwarden', hp: [180, 180], bg: '#173A44', boss: 1, idle: 'sway', pat: [{ k: 'status', card: 'doombell', v: 2, l: 'Toll' }, { k: 'atk', dmg: 18, l: 'Slam' }, { k: 'atk', dmg: 6, hits: 3, l: 'Peal' }], note: 'At half HP: Final Toll. Each Doom Bell in hand deals 5 damage at end of turn.' },
  /* Act II */
  hound:    { n: 'Scrap Hound', hp: [32, 35], bg: '#8A4A1E', pat: [{ k: 'atk', dmg: 10, l: 'Bite' }, { k: 'atk', dmg: 10, l: 'Bite' }, { k: 'summon', key: 'hound', count: 1, hp: 20, howl: 1, l: 'Howl' }], note: 'Howl: summons a pup if alone, otherwise +2 Strength.' },
  mimic:    { n: 'Coinmouth Mimic', hp: [40, 44], bg: '#7A3A18', pat: [{ k: 'debuff', steal: 15, l: 'Swallow' }, { k: 'atk', dmg: 11, l: 'Chomp' }, { k: 'debuff', steal: 15, l: 'Swallow' }, { k: 'atk', dmg: 11, l: 'Chomp' }, { k: 'flee', l: 'Flee' }], note: 'Flees after 4 turns with your gold. Kill it first for double back.' },
  wraith:   { n: 'Smog Wraith', hp: [29, 32], bg: '#5A4A3E', pat: [{ k: 'buff', intangible: 1, l: 'Fade' }, { k: 'atk', dmg: 9, weak: 2, l: 'Choke' }], note: 'Faded: every hit deals only 1 damage. Block on those turns.' },
  gear:     { n: 'Gear Sentinel', hp: [44, 48], bg: '#6E4A28', artifact: 1, pat: [{ k: 'block', v: 12, l: 'Lock' }, { k: 'atk', dmg: 9, frail: 1, l: 'Piston' }], note: 'Artifact 1: negates the first debuff you apply.' },
  cultist:  { n: 'Ash Cultist', hp: [36, 40], bg: '#7A2E1E', loop: 1, pat: [{ k: 'buff', ritual: 3, l: 'Ritual' }, { k: 'atk', dmg: 6, l: 'Ash Strike' }], note: 'Ritual: gains 3 Strength every turn. Kill it fast.' },
  jailer:   { n: 'Chain Jailer', hp: [42, 46], bg: '#4E3A2E', pat: [{ k: 'debuff', drain: 1, l: 'Shackle' }, { k: 'atk', dmg: 10, l: 'Lash' }, { k: 'block', v: 5, l: 'Brace' }], note: 'Shackle: you have 1 less Energy next turn.' },
  furnace:  { n: 'Furnace Knight', hp: [125, 130], bg: '#6E2A14', elite: 1, pat: [{ k: 'status', card: 'burn', v: 2, discard: 1, l: 'Stoke' }, { k: 'atk', dmg: 20, l: 'Brand' }, { k: 'block', v: 8, l: 'Bulwark' }], note: 'Burns in your hand deal 3 damage at end of turn.' },
  matriarch:{ n: 'Brass Matriarch', hp: [115, 120], bg: '#7A5A1E', elite: 1, pat: [{ k: 'summon', key: 'hound', count: 2, hp: 20, l: 'Assemble' }, { k: 'buff', ally: 3, l: 'Command' }, { k: 'atk', dmg: 18, l: 'Crush' }], note: 'Summons Scrap Hounds and empowers them. Area damage helps.' },
  ledger:   { n: 'The Ledger', hp: [110, 115], bg: '#3E2E22', elite: 1, pat: [{ k: 'block', v: 8, l: 'Audit' }, { k: 'atk', dmg: 22, tax: 1, l: 'Collect' }], note: 'Tax: if you play 7+ cards in a turn, Collect hits twice.' },
  cog:      { n: 'King Cog, the Hollow Crown', hp: [260, 260], bg: '#5A3414', boss: 1, pat: [{ k: 'atk', dmg: 14, hits: 2, l: 'Grind' }, { k: 'block', v: 15, l: 'Wind Up' }, { k: 'buff', str: 3, l: 'Overclock' }, { k: 'atk', dmg: 32, l: 'Crown Beam' }], note: 'At half HP the gears shatter: he acts twice a turn but takes 25% more damage.' },
  /* Act III */
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
const BOSS_SIZE = { bell: 1, cog: 1, spire: 1 };

const ACTS = [
  { n: 'The Hollow Wood', stage: '#1F3A3A',
    easy: [['moth', 'crow'], ['rootling'], ['leech'], ['imp'], ['crow', 'crow']],
    hard: [['moth', 'moth', 'crow'], ['rootling', 'imp'], ['acolyte', 'crow'], ['leech', 'moth'], ['imp', 'acolyte'], ['rootling', 'leech']],
    elites: [['ogre'], ['puppet', 'puppet'], ['stag']], boss: 'bell' },
  { n: 'The Rust Bazaar', stage: '#3A2414',
    easy: [['hound', 'hound'], ['mimic'], ['wraith'], ['cultist']],
    hard: [['gear'], ['jailer', 'wraith'], ['cultist', 'hound'], ['mimic', 'jailer'], ['gear', 'cultist'], ['hound', 'hound', 'wraith']],
    elites: [['furnace'], ['matriarch'], ['ledger']], boss: 'cog' },
  { n: 'The Faceless Crown', stage: '#2A1840',
    easy: [['voidsentry', 'voidsentry'], ['mirror'], ['ossuary'], ['seer']],
    hard: [['colossus'], ['nullmask', 'seer'], ['mirror', 'ossuary'], ['voidsentry', 'nullmask'], ['colossus', 'seer']],
    elites: [['unwritten'], ['choir', 'choir', 'choir'], ['eclipse']], boss: 'spire' }
];
const curAct = () => ACTS[G.act - 1];

/* ---------- Map ---------- */
const ROWS = 9, LANES = 4;
function genMap() {
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
        type = pick(bag);
      }
      row.push({ type, next: [], done: false });
    }
    rows.push(row);
  }
  for (let r = 0; r < ROWS - 1; r++) for (let l = 0; l < LANES; l++) {
    const n = rows[r][l].next; n.push(l);
    if (l > 0 && Math.random() < 0.45) n.push(l - 1);
    if (l < LANES - 1 && Math.random() < 0.45) n.push(l + 1);
  }
  return { rows };
}
function available() {
  if (!G.pos) return [0, 1, 2, 3].map(l => ({ r: 0, l }));
  if (G.pos.r === ROWS - 1) return [{ r: ROWS, l: 0 }];
  if (G.pos.r >= ROWS) return [];
  return G.map.rows[G.pos.r][G.pos.l].next.map(l => ({ r: G.pos.r + 1, l }));
}

/* ---------- Run setup ---------- */
function baseG(mode) {
  return { v: 3, mode, code: null, screen: mode === 'coop' ? 'lobby' : 'map', act: 1, floor: 0, map: genMap(), pos: null, P: [], combat: null, fx: [], fxSeq: 0, duelWinner: null, started: mode !== 'coop' };
}
function newPlayer(hero, tok) {
  const p = { hero: null, tok: tok || null, hp: 0, maxHp: 0, gold: 99, deck: [], relics: [], kills: 0, done: false, vote: null, ack: 0, conn: true, reward: null, shop: null, treasure: null, actclear: null };
  if (hero) equipHero(p, hero);
  return p;
}
function equipHero(p, hero) {
  const h = HEROES[hero];
  p.hero = hero; p.hp = h.hp; p.maxHp = h.hp; p.deck = h.starter.map(mk); p.relics = [h.relic];
}
function freeRelic(pi) { const left = Object.keys(RELICS).filter(k => !RELICS[k].start && !hasR(pi, k)); return left.length ? pick(left) : null; }
function gainRelic(pi, r) { if (!r) return; const p = P(pi); p.relics.push(r); if (r === 'heartstone') { p.maxHp += 12; p.hp += 12; } }
function rollTier(kind) { const o = RAR_ODDS[kind] || RAR_ODDS.fight, x = Math.random() * 100; return x < o[0] ? 'c' : x < o[0] + o[1] ? 'u' : 'r'; }
function cardChoices(pi, n, kind) {
  const pool = HEROES[P(pi).hero].pool, out = [];
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
  G.pos = { r, l };
  G.floor = r + 1;
  resetDone();
  const Act = curAct();
  if (r === ROWS) return startCombat([Act.boss], 'boss');
  const node = G.map.rows[r][l];
  node.done = true;
  if (node.type === 'fight') startCombat(pick(r < 3 ? Act.easy : Act.hard), 'fight');
  else if (node.type === 'elite') startCombat(pick(Act.elites), 'elite');
  else if (node.type === 'rest') { G.screen = 'rest'; G.P.forEach(p => { p.rested = false; }); render(); }
  else if (node.type === 'shop') { G.P.forEach((p, pi) => { p.shop = { cards: cardChoices(pi, 4, 'shop').map(id => ({ id, price: rnd(PRICE[RAR[id]][0], PRICE[RAR[id]][1]) + (G.act - 1) * 8, sold: false })), removed: false }; }); G.screen = 'shop'; render(); }
  else if (node.type === 'treasure') {
    G.P.forEach((p, pi) => { const gold = rnd(40, 60) + (G.act - 1) * 10; p.gold += gold; const relic = freeRelic(pi); gainRelic(pi, relic); p.treasure = { gold, relic }; });
    G.screen = 'treasure'; render();
  }
}
function vote(pi, r, l) {
  if (!available().some(a => a.r === r && a.l === l)) return;
  P(pi).vote = r + '-' + l;
  const v = G.P[0].vote;
  if (G.P.every(p => p.vote === v)) enterNode(r, l); else render();
}
function toMap() { G.screen = 'map'; G.combat = null; G.P.forEach(p => { p.reward = null; p.shop = null; p.treasure = null; }); resetDone(); render(); }
function nextAct() { G.act++; G.map = genMap(); G.pos = null; G.floor = 0; G.P.forEach(p => { p.actclear = null; }); G.screen = 'map'; G.combat = null; resetDone(); render(); }
function advanceIfDone() {
  if (!allDone()) return render();
  if (['reward', 'treasure', 'rest', 'shop'].includes(G.screen)) toMap();
  else if (G.screen === 'actclear') nextAct();
  else if (G.screen === 'duelintro') startDuel();
  else render();
}

/* ---------- Combat ---------- */
function log(s) { const c = G.combat; if (!c) return; c.log.unshift(s); if (c.log.length > 18) c.log.length = 18; }
function makeEnemy(key, idx, dup, hpOverride, raw) {
  const d = EN[key];
  const mult = raw ? 1 : 1.15 * (G.P.length > 1 ? 1.6 : 1);
  const hp = Math.round((hpOverride || rnd(d.hp[0], d.hp[1])) * mult);
  return { idx, key, n: d.names ? d.names[dup % d.names.length] : d.n, variant: dup, hp, max: hp, block: 0, str: 0, weak: 0, vuln: 0, thorns: 0, artifact: d.artifact || 0,
    rooted: false, intangible: false, reflect: false, parry: false, ritual: 0, pi: dup % d.pat.length, dead: false, stolen: {}, acting: false, p2: false, split: false, fragile: 1, tg: 0, hitS: 0, deadS: 0 };
}
function newSide(pi) {
  const p = P(pi);
  return { isP: true, pi, hp: p.hp, max: p.maxHp, block: 0, energy: 3, flow: 0, flowEnd: 0, rage: 0, str: 0, weak: 0, vuln: 0, frail: 0, drain: 0, hush: 0, hushNow: 0,
    thorns: hasR(pi, 'thornring') ? 2 : 0, composure: 0, rhythm: 0, keep: 0, rampart: 0, keepAll: 0, bloodpact: 0, ragegain: 0, stance: hasR(pi, 'hornedmask') ? 'calm' : null, switches: 0, mantra: 0, serenity: 0, ironplus: 0,
    draw: shuffle(p.deck.map(c => mk(c.id))), hand: [], discard: [], exhaust: [], played: 0, lastAttack: 5, atkTotal: 0,
    ready: false, down: p.hp <= 0, turnN: 0, animS: 0, animK: '', fwS: 0, fwN: 0, hurtNow: false };
}
function startCombat(keys, kind) {
  const seen = {};
  G.combat = {
    kind, enemies: keys.map((k, i) => { seen[k] = (seen[k] || 0) + 1; return makeEnemy(k, i, seen[k] - 1); }),
    S: G.P.map((p, i) => newSide(i)), turn: 0, over: false, busy: false, log: [], duel: null, finalToll: false
  };
  if (G.P.some((p, i) => hasR(i, 'bellshard'))) C().enemies.forEach(e => { e.vuln = 1; });
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
  s.turnN++;
  const first = s.turnN === 1, pi = s.pi;
  let keep = 0;
  if (!first && P(pi).hero === 'bulwark') keep = s.keepAll ? s.block : Math.floor(s.block / 2);
  s.block = keep + (first && hasR(pi, 'locket') ? 6 : 0) + (first && hasR(pi, 'lanternhelm') ? 8 : 0);
  s.energy = Math.max(0, 3 + (first && hasR(pi, 'quill') ? 1 : 0) - s.drain);
  if (s.drain) log(heroName(pi) + ' is Shackled: ' + s.energy + ' Energy.');
  s.drain = 0;
  s.hushNow = s.hush; s.hush = 0;
  const carry = s.keep ? Math.floor((s.flowEnd || 0) / 2) : 0;
  s.flow = s.composure + (first && hasR(pi, 'mask') ? 1 : 0) + carry;
  if (s.ragegain) addRage(s.ragegain);
  s.played = 0;
  s.switches = 0;
  s.ready = false;
  draw(5 + (first && hasR(pi, 'hourglass') ? 2 : 0));
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
  let d = Math.round(base * 1.15) + e.str;
  if (e.weak > 0) d = Math.floor(d * 0.75);
  if (T && T.vuln > 0) d = Math.floor(d * 1.5);
  if (T && T.stance === 'fury') d = Math.floor(d * 1.25);
  return Math.max(0, d);
}
function checkPhase(e) {
  const c = C();
  if (e.key === 'bell' && !c.finalToll && e.hp * 2 <= e.max) { c.finalToll = true; log('The Bellwarden rings the Final Toll.'); banner('Final Toll! Doom Bells now burn at end of turn.'); }
  if (e.key === 'cog' && !e.p2 && e.hp * 2 <= e.max) { e.p2 = true; e.block = 0; e.fragile = 1.25; log('King Cog’s gears shatter. He acts twice a turn now.'); banner('Gears shattered: King Cog acts twice, but takes 25% more damage.'); }
  if (e.key === 'spire' && !e.p2 && e.hp * 5 <= e.max * 2) { e.p2 = true; e.pi = 0; log('The Faceless Spire casts off its masks.'); banner('Unmasked! The Void grows stronger every turn.'); }
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
    let d = base + a.str + a.rage + (hasR(a.pi, 'whetstone') ? 1 : 0) + (a.rhythm || 0) * a.flow;
    if (a.weak > 0) d = Math.floor(d * 0.75);
    if (a.stance === 'fury') d = Math.floor(d * 1.5);
    if (a.stance === 'iron' && !a.ironplus) d = Math.floor(d * 0.75);
    if (t.vuln > 0) d = Math.floor(d * 1.5);
    if (t.isP && t.stance === 'fury') d = Math.floor(d * 1.25);
    if (t.rooted) d = Math.floor(d / 2);
    d = Math.max(0, Math.floor(d * (t.fragile || 1)));
    if (t.intangible) d = Math.min(d, 1);
    if (t.parry && d > 0) { t.parry = false; float(tagOf(t), 'Parried!', 'miss'); log(t.n + ' parries a hit.'); continue; }
    a.atkTotal += d;
    const ab = Math.min(t.block, d);
    t.block -= ab; t.hp -= d - ab;
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
  if (by != null && G.P[by]) G.P[by].kills++;
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
  s.energy -= d.c; s.hand.splice(i, 1); s.atkTotal = 0; s.played++;
  log(heroName(pi) + ' plays ' + d.n + (t ? ' on ' + nameOf(t) : '') + '.');
  if (d.t === 'attack') anim(s, 'lunge');
  const o = c.duel ? opp(s) : null;
  if (o) o.hurtNow = false;
  if (d.p) d.p(t);
  if (c.over) return render();
  if (d.t === 'attack') { if (P(pi).hero === 'duelist') s.flow++; if (s.atkTotal > 0) s.lastAttack = s.atkTotal; }
  if (d.t === 'skill' && !c.duel) aliveEnemies().filter(x => x.key === 'ogre').forEach(og => { og.str += 2; float(tagOf(og), '+2 Strength', 'buff'); log('The Ogre enrages: +2 Strength.'); });
  if (d.t !== 'power') (d.x ? s.exhaust : s.discard).push(card);
  if (!c.duel && !aliveEnemies().length) { c.busy = true; render(); setTimeout(win, REDUCE ? 100 : 650); return; }
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
    await wait(1000);
    if (G.combat !== c) return;
    fw.forEach(s => { A = s; gain(2 * s.flow); log('Footwork: ' + heroName(s.pi) + '’s ' + s.flow + ' Flow became ' + 2 * s.flow + ' Block.'); s.flow = 0; });
    render();
    await wait(400);
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
  await wait(300);
  const actors = aliveEnemies().slice();
  for (const e of actors) {
    if (e.dead) continue;
    e.block = 0; e.rooted = false; e.intangible = false; e.reflect = false; e.parry = false;
    if (e.ritual) { e.str += e.ritual; float(tagOf(e), '+' + e.ritual + ' Strength', 'buff'); }
    const acts = e.key === 'cog' && e.p2 ? 2 : 1;
    for (let k = 0; k < acts; k++) {
      if (e.dead) break;
      let T = c.S[e.tg];
      if (!T || T.down) { const al = aliveSides(); if (!al.length) break; T = pick(al); e.tg = T.pi; }
      e.acting = true; render();
      await wait(220);
      if (G.combat !== c) return;
      c.S.forEach(s => { s.hurtNow = false; });
      enemyAct(e, T);
      e.acting = false;
      if (c.over) return render();
      e.pi++;
      render();
      await wait(420);
      if (G.combat !== c) return;
    }
    if (e.weak > 0) e.weak--;
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
  c.S.forEach(s => { P(s.pi).hp = s.down ? Math.ceil(s.max * 0.25) : Math.max(1, s.hp); });
  G.P.forEach((p, pi) => { p.hp = Math.min(p.maxHp, p.hp + 2 + (hasR(pi, 'ember') ? 5 : 0)); });
  resetDone();
  const Act = G.act;
  if (c.kind === 'boss') {
    if (Act >= 3) {
      if (G.P.length > 1) { G.screen = 'duelintro'; return render(); }
      G.screen = 'victory'; clearSave(); return render();
    }
    G.P.forEach((p, pi) => {
      const relic = freeRelic(pi); gainRelic(pi, relic);
      const healed = Math.ceil((p.maxHp - p.hp) * 0.4); p.hp += healed;
      const gold = rnd(60, 80); p.gold += gold;
      p.actclear = { act: Act, relic, healed, gold, cards: cardChoices(pi, 3, 'boss'), taken: false };
    });
    G.screen = 'actclear';
    return render();
  }
  const elite = c.kind === 'elite';
  G.P.forEach((p, pi) => {
    const gold = (elite ? rnd(28, 36) : rnd(12, 20)) + (Act - 1) * 6;
    p.gold += gold;
    const relic = elite ? freeRelic(pi) : null;
    gainRelic(pi, relic);
    p.reward = { gold, relic, cards: cardChoices(pi, 3, elite ? 'elite' : 'fight'), taken: false };
  });
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
    case 'start':
      if (scr === 'lobby' && pi === 0 && G.P.length === 2 && G.P.every(q => q.hero) && G.P[1].conn) {
        G.P.forEach(q => equipHero(q, q.hero)); G.started = true; G.screen = 'map'; resetDone(); render();
      }
      break;
    case 'node': if (scr === 'map') { const [r, l] = String(x).split('-').map(Number); vote(pi, r, l); } break;
    case 'card': playCard(pi, Number(x), y == null ? null : Number(y)); break;
    case 'end': endTurnAction(pi); break;
    case 'reward': if (scr === 'reward' && p.reward && !p.reward.taken && p.reward.cards[x]) { p.deck.push(mk(p.reward.cards[x])); p.reward.taken = true; render(); } break;
    case 'bossreward': if (scr === 'actclear' && p.actclear && !p.actclear.taken && p.actclear.cards[x]) { p.deck.push(mk(p.actclear.cards[x])); p.actclear.taken = true; render(); } break;
    case 'done': if (['reward', 'treasure', 'shop', 'actclear', 'duelintro'].includes(scr)) { p.done = true; advanceIfDone(); } break;
    case 'restheal': if (scr === 'rest' && !p.done) { p.hp = Math.min(p.maxHp, p.hp + Math.ceil(p.maxHp * 0.25)); p.done = true; advanceIfDone(); } break;
    case 'remove': {
      const i = p.deck.findIndex(c => c.u === Number(x));
      if (i < 0 || p.deck.length <= 5) break;
      if (scr === 'rest' && !p.done && y === 'rest') { p.deck.splice(i, 1); p.done = true; advanceIfDone(); }
      else if (scr === 'shop' && y === 'shop' && p.shop && !p.shop.removed && p.gold >= 60) { p.deck.splice(i, 1); p.gold -= 60; p.shop.removed = true; render(); }
      break;
    }
    case 'buy': {
      if (scr !== 'shop' || !p.shop) break;
      const s = p.shop.cards[x];
      if (!s || s.sold) break;
      if (s.price > p.gold) { note(pi, 'Not enough gold.'); render(); break; }
      p.gold -= s.price; s.sold = true; p.deck.push(mk(s.id)); note(pi, CARDS[s.id].n + ' added to your deck.'); render();
      break;
    }
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
    if (it.weak) extra.push('Weak (deal 25% less)');
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
function enemyTotal(e) {
  const T = C().S[e.tg];
  let t = describeIntent(e, intentOf(e), T).tot;
  if (e.key === 'cog' && e.p2) t += describeIntent(e, intentOf(e, 1), T).tot;
  return t;
}
function sideView(s) {
  const hero = P(s.pi).hero;
  return {
    pi: s.pi, hp: s.hp, mx: s.max, block: s.block, energy: s.energy, flow: s.flow, rage: s.rage,
    st: [s.weak, s.vuln, s.frail, s.hushNow, s.drain, s.thorns, s.composure, s.rhythm, s.keep, s.rampart, s.keepAll, s.bloodpact, s.ragegain],
    sn: s.stance, sw: s.switches, sx: [s.mantra, s.serenity, s.ironplus],
    rdy: s.ready ? 1 : 0, dn: s.down ? 1 : 0, an: [s.animS, s.animK], fw: [s.fwS, s.fwN], hn: s.hand.length,
    kb: hero === 'bulwark' ? (s.keepAll ? s.block : Math.floor(s.block / 2)) : 0
  };
}
function buildView(me) {
  const p = G.P[me];
  const V = {
    me, n: G.P.length, mode: G.mode, code: G.code, scr: G.screen, act: G.act, floor: G.floor, tok: p ? p.tok : null, ack: p ? p.ack : 0,
    P: G.P.map(q => ({ h: q.hero, hp: q.hp, mx: q.maxHp, g: q.gold, rl: q.relics, dn: q.done ? 1 : 0, vt: q.vote, on: q.conn ? 1 : 0, k: q.kills })),
    deck: p ? p.deck.map(x => [x.u, x.id]) : [], fx: G.fx.slice(-12), started: G.started ? 1 : 0
  };
  const c = G.combat;
  if (G.screen === 'map') {
    V.map = G.map.rows.map(r => r.map(n => [n.type, n.next, n.done ? 1 : 0]));
    V.pos = G.pos; V.av = available().map(a => a.r + '-' + a.l);
  }
  if (c && G.screen === 'combat') {
    c.S.forEach(s => { V.P[s.pi].hp = s.hp; });
    const s = c.S[me];
    const en = c.enemies.filter(e => !e.dead || e.deadS > (G.fxSeq - 14)).map(e => {
      const T = c.S[e.tg];
      const it = e.dead ? null : describeIntent(e, intentOf(e), T);
      if (it && e.key === 'cog' && e.p2) { it.x += ' · then ' + intentOf(e, 1).l; it.tot = enemyTotal(e); }
      const nx = intentOf(e, e.key === 'cog' && e.p2 ? 2 : 1);
      return { idx: e.idx, key: e.key, n: e.n, variant: e.variant, hp: e.hp, max: e.max, block: e.block, split: e.split ? 1 : 0, p2: e.p2 ? 1 : 0, dead: e.dead ? 1 : 0,
        st: [e.str, e.ritual, e.weak, e.vuln, e.thorns, e.artifact, e.rooted ? 1 : 0, e.intangible ? 1 : 0, e.reflect ? 1 : 0, e.parry ? 1 : 0, Object.values(e.stolen).reduce((a, b) => a + b, 0)],
        it, tg: e.tg, nx: nx.hidden ? '???' : nx.l, hs: e.hitS, ds: e.deadS, ac: e.acting ? 1 : 0 };
    });
    let inc = 0;
    if (!c.duel) aliveEnemies().forEach(e => { if (e.tg === me) inc += enemyTotal(e); });
    const guard = s.block + (P(me).hero === 'duelist' ? 2 * s.flow : 0) + 3 * s.rampart + (s.stance === 'iron' ? 4 + s.ironplus : 0);
    V.cb = {
      k: c.kind, t: c.turn, busy: c.busy ? 1 : 0, logs: c.log.slice(0, 5), duel: c.duel ? { a: c.duel.active, r: c.duel.round } : null, toll: c.finalToll ? 1 : 0,
      en, S: c.S.map(sideView), hand: s.hand.map(x => [x.u, x.id]), piles: [s.draw.length, s.discard.length, s.exhaust.length], played: s.played,
      inc: { tot: inc, guard, extra: guard > s.block ? 1 : 0 }
    };
  }
  if (G.screen === 'reward') V.rw = p.reward;
  if (G.screen === 'shop') V.shop = p.shop;
  if (G.screen === 'treasure') V.tr = p.treasure;
  if (G.screen === 'actclear') V.ac = p.actclear;
  if (G.screen === 'duelend') V.win = G.duelWinner;
  return V;
}
const ENC = new TextEncoder();
const bytes = o => ENC.encode(JSON.stringify(o)).length;
const LIMIT = 3850;
function fitView(V) {
  if (bytes(V) > LIMIT && V.cb) V.cb.logs = V.cb.logs.slice(0, 1);
  if (bytes(V) > LIMIT) V.fx = V.fx.slice(-6);
  if (bytes(V) > LIMIT) { V.deck = []; V.deckCut = 1; }
  if (bytes(V) > LIMIT && V.cb) V.cb.en.forEach(e => { if (e.it) e.it.x = e.it.x.slice(0, 40); });
  if (bytes(V) > LIMIT) V.fx = [];
  return V;
}


return {
  get G() { return G; }, set G(v) { G = v; },
  get uidN() { return uidN; }, set uidN(v) { uidN = v; },
  doAction, buildView, newPlayer, baseG, equipHero, startCombat, startDuel, win,
  CARDS, RAR, RAR_NAME, HEROES, RELICS, EN, ACTS, BOSS_SIZE, STANCE, ROWS, LANES, PRICE
};
}
if (typeof module !== 'undefined' && module.exports) module.exports = { createEngine };
else root.createEngine = createEngine;
})(typeof self !== 'undefined' ? self : this);
