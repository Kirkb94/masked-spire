const assert = require('assert');
const A = require('../public/ascension.js');

// Level 0 changes nothing
assert.strictEqual(A.scaleEnemyHp(40, 'normal', 0), 40);
assert.strictEqual(A.scaleEnemyHp(80, 'elite', 0), 80);
assert.strictEqual(A.scaleEnemyHp(150, 'boss', 0), 150);
assert.strictEqual(A.enemyDamageBonus(0), 0);
assert.strictEqual(A.rewardChoices(3, 0), 3);
assert.strictEqual(A.scaleGold(100, 0), 100);
assert.strictEqual(A.startMaxHp(70, 0), 70);

// Higher levels scale and stack
assert.strictEqual(A.scaleEnemyHp(40, 'normal', 1), 44);
assert.strictEqual(A.scaleEnemyHp(40, 'normal', 7), 44);
assert.strictEqual(A.scaleEnemyHp(80, 'elite', 1), 80);
assert.strictEqual(A.scaleEnemyHp(80, 'elite', 2), 92);
assert.strictEqual(A.scaleEnemyHp(150, 'boss', 5), 150);
assert.strictEqual(A.scaleEnemyHp(150, 'boss', 6), 180);
assert.strictEqual(A.enemyDamageBonus(2), 0);
assert.strictEqual(A.enemyDamageBonus(3), 1);
assert.strictEqual(A.rewardChoices(3, 3), 3);
assert.strictEqual(A.rewardChoices(3, 4), 2);
assert.strictEqual(A.scaleGold(100, 5), 85);
assert.strictEqual(A.startMaxHp(70, 7), 60);

// Clamping and co-op forced to 0
assert.strictEqual(A.clampLevel(99, false), A.MAX);
assert.strictEqual(A.clampLevel(-3, false), 0);
assert.strictEqual(A.clampLevel('x', false), 0);
assert.strictEqual(A.clampLevel(5, true), 0);

// Unlock progress
const store = { d: {}, getItem(k) { return k in this.d ? this.d[k] : null; }, setItem(k, v) { this.d[k] = v; } };
assert.strictEqual(A.getUnlocked(store), 0);
A.unlockAfterWin(0, store);
assert.strictEqual(A.getUnlocked(store), 1);
A.unlockAfterWin(0, store);
assert.strictEqual(A.getUnlocked(store), 1);
A.unlockAfterWin(A.MAX, store);
assert.strictEqual(A.getUnlocked(store), A.MAX);

console.log('ascension tests passed');
