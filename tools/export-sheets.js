/* Builds the Masked Spire design spreadsheet from the live engine data.
   Usage: npm run sheets  ->  docs/spreadsheet/masked-spire.xml (Excel / Google Sheets workbook) + one CSV per sheet. */
'use strict';
const fs = require('fs');
const path = require('path');
const { createEngine } = require('../public/engine.js');

const E = createEngine({});
const { CARDS, RAR, RAR_NAME, HEROES, RELICS, EN, ACTS, PRICE, DIFFS, STANCE } = E;
const DMG_SCALE = 1.15 * 1.5; // engine: 1.15 base * DIFF 1.5
const HP_SCALE = 1.15 * 1.5;

const sheets = {};
const add = (name, header, rows) => { sheets[name] = [header].concat(rows); };

/* ---------- Mechanics (hand-written from engine.js rules) ---------- */
const MECH = [
  ['Turn', 'Energy', 'Each turn you start with 3 Energy (Golden Quill: +1 on the first turn; Shackle: -1 next turn). Unspent Energy is lost.'],
  ['Turn', 'Drawing', 'Draw 5 cards at the start of your turn (Sand Hourglass +2 on first turn, Silk Ribbon +1 every turn). Hand cap 10. When the draw pile is empty the discard pile is shuffled in.'],
  ['Turn', 'Block reset', 'Block is set to 0 at the start of your turn. Bulwark keeps half (all with Bastion). First-turn Block relics: Quadrant Mask 5, Lantern Helm 8, Iron Locket 6, Warden\'s Seal 12.'],
  ['Turn', 'Order', 'In co-op both heroes play at the same time. When every living hero ends their turn, enemy phase runs: end-of-turn effects, then each enemy acts in order.'],
  ['Turn', 'End of turn', 'Flow-to-Block (Duelist), Rampart/Stonebound Mask Block, Iron stance Block, Burn (3 dmg each) and Doom Bell (5 dmg each after Final Toll) in hand, then the hand is discarded (Ethereal cards exhaust). Weak and Frail tick down by 1.'],
  ['Combat', 'Targeting', 'Each round every enemy picks a random living hero as its target; intents show who and how much. Single-target cards need a click on an enemy (auto if only one).'],
  ['Combat', 'Player damage', 'base + Strength + Rage + Whetstone(1) + Rhythm x Flow; then Weak x0.75, Fury x1.5, Iron x0.75 (no penalty with Unbreakable); then target: Vulnerable x1.5, Rooted /2, Fragile x1.25 (King Cog phase 2); Intangible caps at 1. Block absorbs first.'],
  ['Combat', 'Enemy damage', 'round(base x 1.15 x 1.5 x difficulty) + Strength; Weak x0.75; target Vulnerable x1.5; target in Fury x1.25. Block absorbs first, overflow hits HP.'],
  ['Combat', 'Block gain', 'Card Block is reduced by 25% (rounded down) while Frail. Elementalist passive Block ignores Frail.'],
  ['Combat', 'Exhaust / Power', 'Exhaust cards go to the exhaust pile until combat ends. Powers stay in play for the whole combat and are not discarded.'],
  ['Combat', 'Playing cards', 'A card needs enough Energy; Unplayable cards (Dazed, Burn, Fate, Void) cannot be played; Powers are blocked on a Hushed turn.'],
  ['Combat', 'Defeat', 'In co-op a downed hero returns after the fight at 25% max HP; if all heroes are down the run ends.'],
  ['Combat', 'Victory heal', 'After each fight everyone heals 2 HP (Ember Ring +5). Survivors keep HP; downed heroes revive at 25% max HP.'],
  ['Heroes', 'Duelist (Flow)', 'Each Attack gives 1 Flow. At end of turn each Flow becomes 2 Block. Flow-scaling cards spend or use it first. Cracked Mask: +1 Flow on the first turn.'],
  ['Heroes', 'Bulwark', 'Keeps half Block between turns. Shield Bash/Bulldoze convert Block to damage.'],
  ['Heroes', 'Brute (Stances)', 'Fury: Attacks +50%, you take +25%. Iron: +4 Block at end of turn, Attacks -25%. Calm: leaving it gives +2 Energy. Every stance switch draws a card. Rage adds flat damage to every hit.'],
  ['Heroes', 'Elementalist', 'Passive: each Attack gives 1 Block (not reduced by Frail). Quadrant Mask relic: 5 Block on first turn of each combat. The game records the last Attack element (fire/frost/storm/stone) in side.el; no effect yet.'],
  ['Map', 'Layout', '9 rows x 4 lanes per act. Row 1 is always a fight, row 5 a treasure, row 9 a rest site, then the act boss. Other rows pick randomly from fight (x5), shop, rest (rows 3+ except row 8), elite x2 (rows 4+). Paths: straight plus 45% chance each for a diagonal.'],
  ['Map', 'Encounters', 'Fights in rows 1-3 use the easy list, later rows the hard list. Elites and bosses are fixed per act (see Acts sheet).'],
  ['Map', 'Co-op voting', 'Both heroes must vote for the same node before the party moves.'],
  ['Rewards', 'Card rewards', '3 choices after each fight/elite; boss gives 3 with the first guaranteed Rare. Odds [Common, Uncommon, Rare]: fight 62/32/6, elite 40/45/15, shop 55/35/10, boss 0/50/50.'],
  ['Rewards', 'Gold', 'Fight 12-20, elite 28-36 (+6 per act after 1). Treasure 40-60 (+10 per act). Boss 60-80. Each player starts with 99 gold.'],
  ['Rewards', 'Relics', 'Elites and treasure rooms give a random non-starting relic; bosses give a boss relic.'],
  ['Shop', 'Prices', 'Cards: Common 45-55, Uncommon 68-82, Rare 130-150, +8 per act after 1. Card removal 60 gold, once per shop. 4 cards on offer.'],
  ['Rest', 'Options', 'Heal 25% of max HP, or remove a card (deck must stay above 5 cards). One choice per rest site.'],
  ['Run', 'Acts', '3 acts (Hollow Wood, Rust Bazaar, Faceless Crown). After each boss except the last you get a boss relic, heal 40% of missing HP, 60-80 gold and a boss card pick.'],
  ['Run', 'Difficulty', 'Easy x0.8, Normal x1, Hard x1.2 on enemy HP and damage. Co-op additionally multiplies enemy HP by 1.6. Host picks difficulty in the lobby.'],
  ['Duel', 'Co-op finale', 'After the Faceless Spire, the two players duel with their current decks. Random first player. Round > 8: sudden death, the player starting a turn loses 2 x (round-8) HP.'],
  ['Online', 'Rooms', '5-letter room codes; games live in server memory; a disconnected player rejoins automatically. Empty rooms are cleared after 30 min (2 min after game end).']
];
add('Mechanics', ['Area', 'Mechanic', 'How it works'], MECH);

add('Statuses', ['Status', 'Applies to', 'Effect', 'Duration / notes'], [
  ['Strength', 'Anyone', '+1 damage per hit per stack.', 'Permanent for the fight. Negative from Disarm/Intimidate.'],
  ['Weak', 'Anyone', 'Damage dealt x0.75 (rounded down).', 'Ticks -1 at end of the holder\'s turn (enemies after they act).'],
  ['Vulnerable', 'Anyone', 'Damage taken x1.5.', 'Enemies tick after acting; heroes tick after the enemy phase.'],
  ['Frail', 'Heroes', 'Block from cards x0.75.', 'Ticks -1 at end of turn.'],
  ['Thorns', 'Anyone', 'Attackers take that much damage per hit.', 'Permanent for the fight.'],
  ['Artifact', 'Enemy', 'Negates the next debuff applied.', 'Gear Sentinel starts with 1.'],
  ['Rooted', 'Enemy', 'Takes half damage until its next turn.', 'From Burrow/Submerge/Brace/Bulwark.'],
  ['Intangible', 'Enemy', 'Every hit deals max 1.', 'Smog Wraith Fade, one turn.'],
  ['Reflect', 'Enemy', 'Half your Attack damage bounces back.', 'Mirror Saint, one turn.'],
  ['Parry', 'Enemy', 'Fully blocks your first hit.', 'Eclipse Duelist, one turn.'],
  ['Ritual', 'Enemy', 'Gains Strength every turn.', 'Ash Cultist +3.'],
  ['Shackle (Drain)', 'Hero', '-1 Energy next turn.', 'Chain Jailer.'],
  ['Hush', 'Hero', 'Cannot play Powers next turn.', 'Nullmask; its intent is hidden.'],
  ['Flow', 'Duelist', 'Resource gained by Attacks; scales cards; becomes Block at end of turn.', 'Reset each turn (Composure start; Unbroken Stance keeps half).'],
  ['Rage', 'Brute', '+1 damage to every hit per stack.', 'Lasts the fight.'],
  ['Stance', 'Brute', 'Fury / Iron / Calm modifiers.', Object.values(STANCE).map(s => s.n + ': ' + s.d).join(' ')]
]);

/* ---------- Heroes ---------- */
add('Heroes', ['Id', 'Name', 'Tagline', 'Max HP', 'Starting relic', 'Passive', 'Starter deck', 'Reward pool size', 'Playstyle'],
  Object.entries(HEROES).map(([id, h]) => {
    const cnt = {};
    h.starter.forEach(c => { cnt[c] = (cnt[c] || 0) + 1; });
    const deck = Object.entries(cnt).map(([c, n]) => n + 'x ' + CARDS[c].n).join(', ');
    return [id, h.n, h.tag, h.hp, RELICS[h.relic].n, h.passive, deck, h.pool.length, h.style];
  }));

/* ---------- Cards ---------- */
const owner = {};
Object.entries(HEROES).forEach(([id, h]) => { h.starter.concat(h.pool).forEach(c => { owner[c] = id; }); });
add('Cards', ['Id', 'Hero', 'Name', 'Cost', 'Type', 'Rarity', 'In starter deck', 'Exhaust', 'Targets', 'Text', 'Shop price range (act 1)'],
  Object.entries(CARDS).map(([id, c]) => {
    const h = owner[id] ? HEROES[owner[id]] : null;
    const isStarter = h ? h.starter.includes(id) : false;
    const rar = RAR[id] ? RAR_NAME[RAR[id]] : (c.t === 'status' ? 'Status/Curse' : 'Starter');
    const price = RAR[id] && PRICE[RAR[id]] ? PRICE[RAR[id]][0] + '-' + PRICE[RAR[id]][1] : '';
    const tg = c.t === 'status' ? 'n/a' : c.tg ? 'One enemy' : c.t === 'attack' ? 'All enemies' : 'Self';
    return [id, h ? h.n : 'Status', c.n, c.c < 0 ? 'Unplayable' : c.c, c.t, rar, isStarter ? 'yes' : '', c.x || c.eth ? 'yes' : '', tg, c.d, price];
  }));

/* ---------- Relics ---------- */
add('Relics', ['Id', 'Name', 'Effect', 'Kind'],
  Object.entries(RELICS).map(([id, r]) => [id, r.n, r.d, r.start ? 'Hero starting relic' : r.boss ? 'Boss relic' : 'Random relic']));

/* ---------- Enemies ---------- */
const where = {};
ACTS.forEach((a, i) => {
  const mark = (list, role) => (list || []).forEach(g => g.forEach(k => { (where[k] = where[k] || new Set()).add('Act ' + (i + 1) + ' ' + role); }));
  mark(a.easy, 'easy'); mark(a.hard, 'hard'); mark(a.elites, 'elite');
  (where[a.boss] = where[a.boss] || new Set()).add('Act ' + (i + 1) + ' boss');
});
const intentText = it => {
  const bits = [];
  Object.entries(it).forEach(([k, v]) => { if (k !== 'l' && k !== 'k') bits.push(k + '=' + v); });
  return it.l + ' [' + it.k + (bits.length ? ' ' + bits.join(' ') : '') + ']';
};
add('Enemies', ['Id', 'Name', 'Where', 'Role', 'Base HP', 'HP solo Normal', 'HP co-op Normal', 'Intent cycle', 'Special rule'],
  Object.entries(EN).map(([id, e]) => {
    const lo = e.hp[0], hi = e.hp[1];
    const fmt = m => { const a = Math.round(lo * m), b = Math.round(hi * m); return a === b ? a : a + '-' + b; };
    const pat = e.pat.map(intentText).join(' -> ') + (e.p2 ? '  | Phase 2: ' + e.p2.map(intentText).join(' -> ') : '');
    return [id, e.names ? e.names.join(' / ') : e.n, [...(where[id] || [])].join('; ') || 'Summoned', e.boss ? 'Boss' : e.elite ? 'Elite' : 'Normal',
      lo === hi ? lo : lo + '-' + hi, fmt(HP_SCALE), fmt(HP_SCALE * 1.6), pat, e.note || ''];
  }));

const intents = [];
Object.entries(EN).forEach(([id, e]) => {
  e.pat.concat(e.p2 || []).forEach((it, i) => {
    const isP2 = i >= e.pat.length;
    const step = isP2 ? 'P2 ' + (i - e.pat.length + 1) : i + 1;
    const dmg = it.dmg ? DIFFS.map(d => Math.round(it.dmg * DMG_SCALE * d.m)).join(' / ') : (it.mimic ? 'copies your last Attack' : '');
    const effects = [];
    ['weak', 'vuln', 'frail', 'heal', 'steal', 'block', 'v', 'str', 'thorns', 'ally', 'ritual', 'drain', 'hush', 'erase', 'addCard', 'selfStr', 'card', 'count'].forEach(k => { if (it[k] != null) effects.push(k + ' ' + it[k]); });
    if (it.root) effects.push('Rooted'); if (it.reflect) effects.push('Reflect'); if (it.parry) effects.push('Parry'); if (it.intangible) effects.push('Intangible');
    intents.push([e.names ? e.names[0] : e.n, step, it.l, it.k, it.hits || (it.dmg ? 1 : ''), it.dmg || '', dmg, effects.join(', ')]);
  });
});
add('Enemy Intents', ['Enemy', 'Step', 'Move', 'Kind', 'Hits', 'Base dmg', 'Dmg per hit (Easy / Normal / Hard, before Strength)', 'Other effects'], intents);

/* ---------- Acts ---------- */
const names = l => (l || []).map(g => g.map(k => EN[k].n).join(' + ')).join(' | ');
add('Acts', ['Act', 'Name', 'Easy fights (rows 1-3)', 'Hard fights', 'Elites', 'Boss'],
  ACTS.map((a, i) => [i + 1, a.n, names(a.easy), names(a.hard), names(a.elites), EN[a.boss].n]));

add('Run Flow', ['Step', 'What happens'], [
  [1, 'Pick hero (and difficulty / co-op room). Start with 99 gold, hero starter deck, hero starting relic.'],
  [2, 'Walk a 9-row map: fight, shop, rest, elite, treasure; row 9 is always a rest site.'],
  [3, 'Beat the act boss, take a boss relic, heal 40% of missing HP, gold and a card.'],
  [4, 'Repeat for 3 acts. Solo: beating the Faceless Spire wins the run.'],
  [5, 'Co-op: after the Spire the two heroes duel; last standing wins.']
]);

/* ---------- Output ---------- */
const outDir = path.join(__dirname, '..', 'docs', 'spreadsheet');
fs.mkdirSync(outDir, { recursive: true });
const csvCell = v => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
const xmlEsc = v => String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
let xml = '<?xml version="1.0"?>\n<?mso-application progid="Excel.Sheet"?>\n<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">\n<Styles><Style ss:ID="h"><Font ss:Bold="1"/><Interior ss:Color="#DDDDEE" ss:Pattern="Solid"/></Style><Style ss:ID="w"><Alignment ss:WrapText="1" ss:Vertical="Top"/></Style></Styles>\n';
Object.entries(sheets).forEach(([name, rows]) => {
  fs.writeFileSync(path.join(outDir, name.toLowerCase().replace(/[^a-z0-9]+/g, '-') + '.csv'), '\ufeff' + rows.map(r => r.map(csvCell).join(',')).join('\n') + '\n');
  xml += '<Worksheet ss:Name="' + xmlEsc(name) + '"><Table>\n';
  rows.forEach((r, i) => {
    xml += '<Row>' + r.map(v => {
      const num = typeof v === 'number' || (v !== '' && v != null && /^-?\d+(\.\d+)?$/.test(String(v)));
      return '<Cell ss:StyleID="' + (i === 0 ? 'h' : 'w') + '"><Data ss:Type="' + (num ? 'Number' : 'String') + '">' + xmlEsc(v) + '</Data></Cell>';
    }).join('') + '</Row>\n';
  });
  xml += '</Table></Worksheet>\n';
});
xml += '</Workbook>\n';
fs.writeFileSync(path.join(outDir, 'masked-spire.xml'), xml);
console.log('Wrote ' + Object.keys(sheets).length + ' sheets to ' + outDir);
