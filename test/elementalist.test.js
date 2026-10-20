const test = require('node:test');
const assert = require('node:assert');
const { createEngine } = require('../public/engine.js');
const E = createEngine();

const NEW_CARDS = ['estrike', 'eguard', 'emberlash', 'rimespiral', 'cinderbolt', 'scorch', 'frostward', 'gust', 'icelance', 'stormcrash', 'rimeshroud', 'tempest', 'stonemask'];

test('elementalist starting deck is 10 known cards', () => {
  const h = E.HEROES.elementalist;
  assert.ok(h);
  assert.strictEqual(h.starter.length, 10);
  h.starter.forEach(id => assert.ok(E.CARDS[id], 'missing card ' + id));
});

test('elementalist relic exists and is a starting relic', () => {
  const r = E.RELICS[E.HEROES.elementalist.relic];
  assert.ok(r);
  assert.strictEqual(r.start, 1);
});

test('every new card has a rarity entry and a CARDS definition', () => {
  NEW_CARDS.forEach(id => {
    assert.ok(E.CARDS[id], 'CARDS missing ' + id);
    assert.ok(['c', 'u', 'r'].includes(E.RAR[id]), 'RAR missing ' + id);
  });
});

test('pool cards exist, are not starters, and are rewardable', () => {
  const h = E.HEROES.elementalist;
  h.pool.forEach(id => {
    assert.ok(E.CARDS[id], 'pool card missing ' + id);
    assert.ok(E.RAR[id], 'pool card has no rarity ' + id);
    assert.ok(!h.starter.includes(id), 'pool duplicates starter ' + id);
  });
});
