const test = require('node:test');
const assert = require('node:assert');
const { createEngine } = require('../public/engine.js');

const E = createEngine({ rng: () => 0.5 });
const { EN, ACTS } = E;

const NEW = [
  ['wisp', 'boar', 'spinner'],
  ['welder', 'hornet', 'golem'],
  ['wailer', 'stalker', 'tithe']
];

test('three new normal enemies per act are valid and in fight pools', () => {
  NEW.forEach((keys, a) => {
    const act = ACTS[a];
    const pooled = new Set([].concat(...act.easy, ...act.hard));
    keys.forEach(k => {
      const d = EN[k];
      assert.ok(d, k);
      assert.ok(d.n && d.bg && d.note, k);
      assert.ok(!d.elite && !d.boss, k);
      assert.ok(d.hp[0] > 0 && d.hp[1] >= d.hp[0], k);
      assert.ok(d.pat.length >= 2, k);
      d.pat.forEach(it => assert.ok(it.l && ['atk', 'block', 'debuff', 'buff', 'status'].includes(it.k), k));
      if (d.art) assert.ok(EN[d.art], k + ' art');
      assert.ok(pooled.has(k), k + ' in pool');
    });
  });
});

test('every pooled enemy key exists', () => {
  ACTS.forEach(act => [].concat(act.easy, act.hard, act.elites).forEach(f => f.forEach(k => assert.ok(EN[k], k))));
});
