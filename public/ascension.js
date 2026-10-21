(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Ascension = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // Each level stacks on all previous levels. Numbers are balance choices: tune freely.
  var LEVELS = [
    { level: 0, name: 'Base', desc: 'Standard run.' },
    { level: 1, name: 'Tougher foes', desc: 'Normal enemies have +10% HP.' },
    { level: 2, name: 'Hardened elites', desc: 'Elites have +15% HP.' },
    { level: 3, name: 'Sharper claws', desc: 'Enemies deal +1 damage.' },
    { level: 4, name: 'Slim pickings', desc: 'Card rewards offer 2 choices.' },
    { level: 5, name: 'Lean purses', desc: 'Gold rewards are 15% lower.' },
    { level: 6, name: 'Titan bosses', desc: 'Bosses have +20% HP.' },
    { level: 7, name: 'Frail start', desc: 'Start with 10 less max HP.' }
  ];
  var MAX = LEVELS.length - 1;
  var KEY = 'ms_ascension_max';

  function clampLevel(level, coop) {
    if (coop) return 0;
    var n = Math.floor(Number(level));
    if (!isFinite(n) || n < 0) return 0;
    return Math.min(n, MAX);
  }

  // kind: 'normal' | 'elite' | 'boss'
  function scaleEnemyHp(hp, kind, level) {
    var l = clampLevel(level, false), mult = 1;
    if (kind === 'normal' && l >= 1) mult = 1.1;
    if (kind === 'elite' && l >= 2) mult = 1.15;
    if (kind === 'boss' && l >= 6) mult = 1.2;
    return mult === 1 ? hp : Math.ceil(hp * mult);
  }
  function enemyDamageBonus(level) {
    return clampLevel(level, false) >= 3 ? 1 : 0;
  }
  function rewardChoices(base, level) {
    return clampLevel(level, false) >= 4 ? Math.min(base, 2) : base;
  }
  function scaleGold(gold, level) {
    return clampLevel(level, false) >= 5 ? Math.floor(gold * 0.85) : gold;
  }
  function startMaxHp(hp, level) {
    return clampLevel(level, false) >= 7 ? Math.max(1, hp - 10) : hp;
  }
  function describe(level) {
    var out = [];
    for (var i = 1; i <= clampLevel(level, false); i++) out.push(LEVELS[i].desc);
    return out;
  }

  // Unlock progress (browser only). Winning at level N unlocks N+1.
  function getUnlocked(storage) {
    try {
      var s = storage || (typeof localStorage !== 'undefined' ? localStorage : null);
      if (!s) return 0;
      return clampLevel(parseInt(s.getItem(KEY), 10) || 0, false);
    } catch (e) { return 0; }
  }
  function unlockAfterWin(wonLevel, storage) {
    try {
      var s = storage || (typeof localStorage !== 'undefined' ? localStorage : null);
      if (!s) return 0;
      var next = clampLevel(wonLevel + 1, false);
      if (next > getUnlocked(s)) s.setItem(KEY, String(next));
      return getUnlocked(s);
    } catch (e) { return 0; }
  }

  return {
    LEVELS: LEVELS, MAX: MAX, KEY: KEY,
    clampLevel: clampLevel, scaleEnemyHp: scaleEnemyHp, enemyDamageBonus: enemyDamageBonus,
    rewardChoices: rewardChoices, scaleGold: scaleGold, startMaxHp: startMaxHp,
    describe: describe, getUnlocked: getUnlocked, unlockAfterWin: unlockAfterWin
  };
});
