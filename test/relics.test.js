const test = require('node:test');
const assert = require('node:assert');
const { createEngine } = require('../public/engine.js');

const E = createEngine({ rng: () => 0.5 });
const { RELICS } = E;

const NORMAL = ['tallowcandle', 'brasscompass', 'vigilbell', 'ravenfeather'];
const BOSS = ['obsidianeye', 'phoenixash'];

test('new relics exist with names and descriptions', () => {
  NORMAL.concat(BOSS).forEach(id => {
    const r = RELICS[id];
    assert.ok(r, 'missing ' + id);
    assert.ok(r.n && r.d, 'name/desc ' + id);
    assert.ok(!r.start, 'not a starting relic: ' + id);
  });
});

test('new relic tiers: 4 normal, 2 boss', () => {
  NORMAL.forEach(id => assert.ok(!RELICS[id].boss, id + ' should not be boss'));
  BOSS.forEach(id => assert.strictEqual(RELICS[id].boss, 1, id + ' should be boss'));
});
