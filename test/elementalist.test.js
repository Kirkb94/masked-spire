const test = require('node:test');
const assert = require('node:assert');
const { createEngine } = require('../public/engine.js');

const E = createEngine({ rng: () => 0.5 });
const { HEROES, CARDS, RAR, RELICS } = E;

const NEW_CARDS = ['sparkjolt', 'estrike', 'eguard', 'emberlash', 'rimespiral', 'cinderbolt', 'scorch', 'frostward', 'gust', 'icelance', 'stormcrash', 'rimeshroud', 'tempest', 'stonemask', 'kindle', 'staticedge', 'shardfall', 'thermalshock', 'chainbolt', 'prismsurge', 'smolder', 'hoarfrost', 'arcflash', 'tectonic', 'resonant', 'eternalflame', 'flamewheel', 'coldsnap', 'superconduct', 'overload', 'glaciercrush', 'wildfire', 'blizzard', 'convergence'];
const isRar = v => ['c', 'u', 'r'].includes(v);

test('elementalist hero entry is complete', () => {
  const h = HEROES.elementalist;
  assert.ok(h, 'HEROES.elementalist missing');
  assert.ok(Number.isFinite(h.hp) && h.hp > 0, 'hp');
  ['n', 'tag', 'passive', 'style', 'relic'].forEach(k => assert.ok(typeof h[k] === 'string' && h[k].length, 'missing ' + k));
  assert.ok(Array.isArray(h.starter) && Array.isArray(h.pool), 'starter/pool arrays');
});

test('elementalist starting deck is 10 known cards', () => {
  const h = HEROES.elementalist;
  assert.strictEqual(h.starter.length, 10);
  h.starter.forEach(id => {
    assert.ok(CARDS[id], 'missing card ' + id);
    assert.ok(CARDS[id].c >= 0, 'starter card unplayable ' + id);
  });
});

test('newPlayer builds an elementalist with the starter deck and relic', () => {
  const p = E.newPlayer('elementalist', 'tok');
  const h = HEROES.elementalist;
  assert.strictEqual(p.hero, 'elementalist');
  assert.deepStrictEqual(p.deck.map(c => c.id), h.starter);
  assert.deepStrictEqual(p.relics, [h.relic]);
  assert.strictEqual(p.hp, h.hp);
  assert.strictEqual(p.maxHp, h.hp);
});

test('elementalist starter deck has exactly one attack of each element', () => {
  const h = HEROES.elementalist;
  ['emberlash', 'rimespiral', 'sparkjolt', 'estrike'].forEach(id => assert.strictEqual(h.starter.filter(x => x === id).length, 1, id));
});

test('elementalist relic exists and is a starting relic', () => {
  const key = HEROES.elementalist.relic;
  const r = RELICS[key];
  assert.ok(r, 'RELICS missing ' + key);
  assert.strictEqual(r.start, 1, 'start:1 keeps it out of freeRelic');
  assert.ok(typeof r.n === 'string' && r.n.length, 'relic name');
  assert.ok(typeof r.d === 'string' && r.d.length, 'relic description');
});

test('every new card has a CARDS definition and an exact rarity', () => {
  NEW_CARDS.forEach(id => {
    assert.ok(CARDS[id], 'CARDS missing ' + id);
    assert.ok(isRar(RAR[id]), 'RAR missing or invalid for ' + id + ': ' + RAR[id]);
  });
});

test('every starter and pool card is covered by NEW_CARDS (update the list when adding cards)', () => {
  const h = HEROES.elementalist;
  [...h.starter, ...h.pool].forEach(id => assert.ok(NEW_CARDS.includes(id), id + ' not listed in NEW_CARDS'));
});

test('pool cards exist, are unique, are not starters, and have rarities', () => {
  const h = HEROES.elementalist;
  assert.strictEqual(new Set(h.pool).size, h.pool.length, 'duplicate in pool');
  h.pool.forEach(id => {
    assert.ok(CARDS[id], 'pool card missing ' + id);
    assert.ok(isRar(RAR[id]), 'pool card has no rarity ' + id);
    assert.ok(!h.starter.includes(id), 'pool duplicates starter ' + id);
  });
});

test('elementalist pool has cards in every rarity tier (reward rolls)', () => {
  const pool = HEROES.elementalist.pool;
  ['c', 'u', 'r'].forEach(t => assert.ok(pool.some(id => RAR[id] === t), 'no ' + t + ' card in pool'));
});

test('every hero card has a rarity, and RAR has no dangling ids', () => {
  Object.keys(HEROES).forEach(k => {
    [...HEROES[k].starter, ...HEROES[k].pool].forEach(id => {
      assert.ok(CARDS[id], k + ': CARDS missing ' + id);
      assert.ok(isRar(RAR[id]), k + ': RAR missing or invalid for ' + id);
    });
  });
  Object.keys(RAR).forEach(id => assert.ok(CARDS[id], 'RAR has unknown card ' + id));
});
