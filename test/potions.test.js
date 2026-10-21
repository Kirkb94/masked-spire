const test = require('node:test');
const assert = require('node:assert');
const { createEngine } = require('../public/engine.js');

const E = createEngine({ rng: () => 0.5 });
const { POTIONS, POT_MAX } = E;

test('six status potions, three per hero', () => {
  const ids = Object.keys(POTIONS);
  assert.strictEqual(ids.length, 6);
  assert.strictEqual(ids.filter(k => POTIONS[k].h === 'elementalist').length, 3);
  assert.strictEqual(ids.filter(k => POTIONS[k].h === 'duelist').length, 3);
  ids.forEach(k => { assert.ok(POTIONS[k].n && POTIONS[k].d && POTIONS[k].v > 0, k); });
});

test('new players start with an empty belt and the cap is 3', () => {
  assert.deepStrictEqual(E.newPlayer('duelist', 't').pot, []);
  assert.strictEqual(POT_MAX, 3);
});
