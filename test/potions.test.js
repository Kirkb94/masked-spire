const test = require('node:test');
const assert = require('node:assert');
const { createEngine } = require('../public/engine.js');

const E = createEngine({ rng: () => 0.5 });
const { POTIONS, POT_MAX } = E;

test('every hero has potions and each entry is well formed', () => {
  const ids = Object.keys(POTIONS);
  ['duelist', 'bulwark', 'brute', 'elementalist'].forEach(h => {
    assert.ok(ids.filter(k => POTIONS[k].h === h).length >= 3, h);
  });
  ids.forEach(k => {
    const d = POTIONS[k];
    assert.ok(d.n && d.d && Array.isArray(d.p) && d.p.length === 2 && d.p[0] <= d.p[1], k);
    assert.ok(d.fx ? d.fx.length > 0 : d.v > 0, k);
  });
});

test('Bulwark and Brute have exactly three new potions each', () => {
  const ids = Object.keys(POTIONS);
  assert.strictEqual(ids.filter(k => POTIONS[k].h === 'bulwark').length, 3);
  assert.strictEqual(ids.filter(k => POTIONS[k].h === 'brute').length, 3);
});

test('Bulwark and Brute potions use supported effect kinds', () => {
  const ok = { bulwark: ['block', 'thorns'], brute: ['rage', 'stance'] };
  Object.keys(POTIONS).filter(k => ok[POTIONS[k].h]).forEach(k => {
    POTIONS[k].fx.forEach(f => assert.ok(ok[POTIONS[k].h].includes(f[0]), k + ':' + f[0]));
  });
  Object.keys(POTIONS).filter(k => POTIONS[k].h === 'brute').forEach(k => {
    POTIONS[k].fx.filter(f => f[0] === 'stance').forEach(f => assert.ok(['fury', 'iron', 'calm'].includes(f[1]), k));
  });
});

test('new players start with an empty belt and the cap is 3', () => {
  assert.deepStrictEqual(E.newPlayer('duelist', 't').pot, []);
  assert.strictEqual(POT_MAX, 3);
});
