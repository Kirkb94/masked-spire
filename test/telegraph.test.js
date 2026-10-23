const test = require('node:test');
const assert = require('node:assert');
const { createEngine } = require('../public/engine.js');

const sleep = ms => new Promise(r => setTimeout(r, ms));

function fresh() {
  const E = createEngine({ rng: () => 0.5, reduce: true, pace: 'fast' });
  const G = E.baseG('solo');
  G.P = [E.newPlayer('duelist', 'tok', G.mods)];
  E.G = G;
  return E;
}

test('Gloam Toad pattern uses 4 then 9', () => {
  const { EN } = fresh();
  assert.strictEqual(EN.toad.pat[0].l, 'Sticky Tongue');
  assert.strictEqual(EN.toad.pat[0].dmg, 4);
  assert.strictEqual(EN.toad.pat[1].l, 'Gulp');
  assert.strictEqual(EN.toad.pat[1].dmg, 9);
});

const keys = Object.keys(createEngine({ rng: () => 0.5 }).EN).filter(k => {
  const it = createEngine({ rng: () => 0.5 }).EN[k].pat[0];
  return it && it.k === 'atk' && !it.mimic && !it.tax && !it.hidden;
});

keys.forEach(key => {
  test('telegraphed damage equals logged damage: ' + key, async () => {
    const E = fresh();
    E.startCombat([key], 'normal');
    const V = E.buildView(0);
    const en = V.cb.en[0];
    const it = en.it;
    const label = E.EN[key].pat[0].l;
    const telegraphed = it.tot;
    assert.ok(telegraphed > 0, key + ' telegraphs damage');
    E.doAction(0, 'end');
    let line = null;
    for (let i = 0; i < 60 && !line; i++) {
      await sleep(50);
      const logs = E.buildView(0).cb.logs || [];
      line = logs.find(l => String(l).includes(' uses ' + label + ' on '));
    }
    assert.ok(line, key + ' acted and logged');
    const m = /for (\d+)\./.exec(String(line));
    assert.ok(m, 'log has damage: ' + line);
    assert.strictEqual(Number(m[1]), telegraphed, key + ': ' + line);
  });
});
