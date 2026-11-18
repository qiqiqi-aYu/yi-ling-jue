'use strict';

/**
 * tests/unit/damage.test.js —— 扣血 / 淘汰 / 排名 / 积分
 * 重点：扣血公式（基础 + 存活星级权重）、平局对称扣血、血量不为负、
 *      名次分配（存活按血量、淘汰按回合）、积分下限保护。
 */

const {
  normalizeResult,
  calcSurvivorWeight,
  calcRoundDamage,
  calcBattleDamage,
  applyDamage,
  updateStreak,
  assignRanks,
  settleEliminations,
  isMatchOver,
  calcScoreDelta,
  settleMatch,
} = require('../../src/engine/damage');
const { damageConfig, scoreConfig } = require('./support/balance');

/** 构造存活棋子数组（只关心星级） */
function survivors(...stars) {
  return stars.map((star) => ({ star }));
}

describe('扣血计算', () => {
  test('基础扣血 3 + 每个存活棋子 1 点（1 星权重 1）', () => {
    expect(calcRoundDamage([], damageConfig).damage).toBe(3);
    expect(calcRoundDamage(survivors(1), damageConfig).damage).toBe(4);
    expect(calcRoundDamage(survivors(1, 1, 1), damageConfig).damage).toBe(6);
  });

  test('★ 存活棋子按星级加权：3 个 1 星 + 1 个 2 星 = 权重 5 → 扣 8', () => {
    const result = calcRoundDamage(survivors(1, 1, 2, 3), damageConfig);
    expect(result.survivorWeight).toBe(7); // 1+1+2+3
    expect(result.survivorCount).toBe(4);
    expect(result.damage).toBe(10); // 3 + 7
  });

  test('星级权重可由配置覆盖（后台调平衡用）', () => {
    const config = { ...damageConfig, starDamageWeight: { 1: 0, 2: 1, 3: 2 } };
    expect(calcRoundDamage(survivors(1, 1, 2), config).damage).toBe(4); // 3 + 1
    expect(calcSurvivorWeight(survivors(3), config).weight).toBe(2);
  });

  test('胜方零存活不产出额外伤害（理论上不会发生，仅作边界保护）', () => {
    expect(calcSurvivorWeight(undefined, damageConfig)).toEqual({ count: 0, weight: 0 });
    expect(() => calcSurvivorWeight('2', damageConfig)).toThrow(TypeError);
    expect(() => calcSurvivorWeight(survivors(0), damageConfig)).toThrow(RangeError);
  });
});

describe('calcBattleDamage 胜负扣血', () => {
  test('胜：对手扣血，我方不扣', () => {
    const result = calcBattleDamage(
      { result: 'win', humanSurvivors: survivors(1, 1), opponentSurvivors: [] },
      damageConfig,
    );
    expect(result.damageToHuman).toBe(0);
    expect(result.damageToOpponent).toBe(5); // 3 + 1×2
    expect(result.resultCode).toBe(1);
  });

  test('负：我方扣血，对手不扣', () => {
    const result = calcBattleDamage(
      { result: 'loss', humanSurvivors: [], opponentSurvivors: survivors(2, 2) },
      damageConfig,
    );
    expect(result.damageToHuman).toBe(7); // 3 + 2×2
    expect(result.damageToOpponent).toBe(0);
    expect(result.resultCode).toBe(2);
  });

  test('平：双方各扣基础伤害（不给存活追加）', () => {
    const result = calcBattleDamage(
      { result: 'draw', humanSurvivors: survivors(3, 3), opponentSurvivors: survivors(1) },
      damageConfig,
    );
    expect(result.damageToHuman).toBe(3);
    expect(result.damageToOpponent).toBe(3);
    expect(result.resultCode).toBe(3);
    expect(result.breakdown.human.survivorBonus).toBe(0);
  });

  test('结果码 1/2/3 与语义等价（数据库存 1=胜 2=负 3=平）', () => {
    expect(normalizeResult(1)).toBe('win');
    expect(normalizeResult(2)).toBe('loss');
    expect(normalizeResult(3)).toBe('draw');
    expect(normalizeResult('WIN')).toBe('win');
    expect(() => normalizeResult(4)).toThrow(TypeError);
    expect(() => normalizeResult('victory')).toThrow(TypeError);
  });

  test('入参非法抛错', () => {
    expect(() => calcBattleDamage(null, damageConfig)).toThrow(TypeError);
    expect(() => calcBattleDamage({ result: 'win' }, {})).toThrow(TypeError);
  });
});

describe('applyDamage 血量扣减', () => {
  test('正常扣血', () => {
    expect(applyDamage(100, 16)).toEqual({
      hpBefore: 100,
      damage: 16,
      hpAfter: 84,
      overkill: 0,
      eliminated: false,
    });
  });

  test('★ 血量最低到 0（不出现负数），并标记淘汰与溢出伤害', () => {
    const result = applyDamage(5, 30);
    expect(result.hpAfter).toBe(0);
    expect(result.overkill).toBe(25);
    expect(result.eliminated).toBe(true);
  });

  test('恰好打到 0 也算淘汰', () => {
    expect(applyDamage(16, 16).eliminated).toBe(true);
    expect(applyDamage(16, 15).eliminated).toBe(false);
  });

  test('入参非法抛错', () => {
    expect(() => applyDamage(-1, 3)).toThrow(RangeError);
    expect(() => applyDamage(10, -3)).toThrow(RangeError);
    expect(() => applyDamage(10, 3.5)).toThrow(RangeError);
  });
});

describe('updateStreak 连胜连败', () => {
  test('胜 +1 且清空连败', () => {
    expect(updateStreak({ winStreak: 2, loseStreak: 0 }, 'win')).toEqual({ winStreak: 3, loseStreak: 0 });
    expect(updateStreak({ winStreak: 0, loseStreak: 4 }, 'win')).toEqual({ winStreak: 1, loseStreak: 0 });
  });

  test('负 +1 且清空连胜', () => {
    expect(updateStreak({ winStreak: 5, loseStreak: 0 }, 'loss')).toEqual({ winStreak: 0, loseStreak: 1 });
  });

  test('平局双方清零（连败奖励不因平局继续累积）', () => {
    expect(updateStreak({ winStreak: 3, loseStreak: 0 }, 'draw')).toEqual({ winStreak: 0, loseStreak: 0 });
    expect(updateStreak({ winStreak: 0, loseStreak: 6 }, 3)).toEqual({ winStreak: 0, loseStreak: 0 });
  });

  test('缺字段时按 0 处理', () => {
    expect(updateStreak({}, 'win')).toEqual({ winStreak: 1, loseStreak: 0 });
  });
});

describe('assignRanks 名次分配', () => {
  /** 8 人局：5 存活 + 3 已淘汰 */
  function eightPlayers() {
    return [
      { id: 1, seatNo: 1, hp: 78 },
      { id: 2, seatNo: 2, hp: 60 },
      { id: 3, seatNo: 3, hp: 45 },
      { id: 4, seatNo: 4, hp: 12 },
      { id: 5, seatNo: 5, hp: 9 },
      { id: 6, seatNo: 6, hp: 0, isAlive: false, eliminatedRound: 2 },
      { id: 7, seatNo: 7, hp: 0, isAlive: false, eliminatedRound: 4 },
      { id: 8, seatNo: 8, hp: 0, isAlive: false, eliminatedRound: 4 },
    ];
  }

  test('存活者按血量降序占 1~5 名', () => {
    const ranked = assignRanks(eightPlayers());
    expect(ranked.slice(0, 5).map((player) => player.id)).toEqual([1, 2, 3, 4, 5]);
    expect(ranked.slice(0, 5).map((player) => player.finalRank)).toEqual([1, 2, 3, 4, 5]);
  });

  test('★ 淘汰者按淘汰回合逆序（越晚死名次越高），同回合按座位号兜底', () => {
    const ranked = assignRanks(eightPlayers());
    expect(ranked.find((player) => player.id === 7).finalRank).toBe(6);
    expect(ranked.find((player) => player.id === 8).finalRank).toBe(7);
    expect(ranked.find((player) => player.id === 6).finalRank).toBe(8);
  });

  test('血量相同时用座位号保证名次唯一且可复现', () => {
    const ranked = assignRanks([
      { id: 20, seatNo: 2, hp: 50 },
      { id: 10, seatNo: 1, hp: 50 },
    ]);
    expect(ranked.map((player) => player.id)).toEqual([10, 20]);
  });

  test('全员淘汰时仍能排出完整名次（不会漏人）', () => {
    const ranked = assignRanks([
      { id: 1, seatNo: 1, hp: 0, isAlive: false, eliminatedRound: 3 },
      { id: 2, seatNo: 2, hp: 0, isAlive: false, eliminatedRound: 5 },
    ]);
    expect(ranked.map((player) => player.finalRank)).toEqual([1, 2]);
    expect(ranked[0].id).toBe(2);
  });

  test('入参非法抛错（空数组 / 缺 id / id 重复）', () => {
    expect(() => assignRanks([])).toThrow(TypeError);
    expect(() => assignRanks([{ hp: 10 }])).toThrow(TypeError);
    expect(() => assignRanks([{ id: 1, hp: 10 }, { id: 1, hp: 5 }])).toThrow(RangeError);
  });
});

describe('settleEliminations / isMatchOver 淘汰判定', () => {
  test('血量归零的存活者被标记淘汰并记录淘汰回合', () => {
    const players = [
      { id: 1, hp: 42, isAlive: true },
      { id: 2, hp: 0, isAlive: true },
      { id: 3, hp: 0, isAlive: false, eliminatedRound: 3 },
    ];
    const result = settleEliminations(players, 6);
    expect(result.eliminated.map((player) => player.id)).toEqual([2]);
    expect(result.players.find((player) => player.id === 2)).toMatchObject({
      hp: 0,
      isAlive: false,
      eliminatedRound: 6,
    });
    // 已淘汰的不会被重复记录，淘汰回合保持首次
    expect(result.players.find((player) => player.id === 3).eliminatedRound).toBe(3);
    expect(result.aliveCount).toBe(1);
    expect(result.matchOver).toBe(true);
  });

  test('还有 2 人存活时对局继续', () => {
    const result = settleEliminations(
      [
        { id: 1, hp: 10, isAlive: true },
        { id: 2, hp: 5, isAlive: true },
      ],
      7,
    );
    expect(result.matchOver).toBe(false);
    expect(isMatchOver(result.players)).toBe(false);
  });

  test('入参非法抛错', () => {
    expect(() => settleEliminations('players', 1)).toThrow(TypeError);
    expect(() => settleEliminations([], 0)).toThrow(RangeError);
  });
});

describe('积分变化', () => {
  test('名次 → 积分变化（第 1 名 +30，第 8 名 -16）', () => {
    expect(calcScoreDelta({ rank: 1, currentScore: 1000 }, scoreConfig)).toMatchObject({
      delta: 30,
      scoreAfter: 1030,
      floored: false,
    });
    expect(calcScoreDelta({ rank: 8, currentScore: 1000 }, scoreConfig)).toMatchObject({
      rawDelta: -16,
      delta: -16,
      scoreAfter: 984,
    });
  });

  test('★ 积分下限保护：扣到 floor 就停，delta 记录实际变化量', () => {
    const config = { ...scoreConfig, scoreFloor: 1000 };
    const result = calcScoreDelta({ rank: 8, currentScore: 1005 }, config);
    expect(result.scoreAfter).toBe(1000);
    expect(result.delta).toBe(-5); // 只扣了 5 分
    expect(result.rawDelta).toBe(-16); // 原始规则仍是 -16
    expect(result.floored).toBe(true);
  });

  test('名次没有积分配置时抛错（防止配置缺档悄悄给 0 分）', () => {
    expect(() => calcScoreDelta({ rank: 9, currentScore: 1000 }, scoreConfig)).toThrow(RangeError);
    expect(() => calcScoreDelta({ rank: 0, currentScore: 1000 }, scoreConfig)).toThrow(RangeError);
    expect(() => calcScoreDelta({ rank: 1, currentScore: 1000 }, {})).toThrow(TypeError);
  });
});

describe('settleMatch 对局结算', () => {
  test('真人血量最高 → 第 1 名，积分 +30', () => {
    const players = [
      { id: 100, seatNo: 1, hp: 88, isAlive: true },
      { id: 101, seatNo: 2, hp: 20, isAlive: true },
      { id: 102, seatNo: 3, hp: 0, isAlive: false, eliminatedRound: 5 },
    ];
    const result = settleMatch(
      { players, humanPlayerId: 100, currentScore: 1200 },
      scoreConfig,
    );
    expect(result.humanRank).toBe(1);
    expect(result.scoreDelta).toBe(30);
    expect(result.scoreAfter).toBe(1230);
    expect(result.matchOver).toBe(false); // 还剩 2 人
    expect(result.players.map((player) => player.finalRank)).toEqual([1, 2, 3]);
  });

  test('找不到真人参与者时抛错', () => {
    expect(() =>
      settleMatch({ players: [{ id: 1, hp: 10 }], humanPlayerId: 999, currentScore: 1000 }, scoreConfig),
    ).toThrow(RangeError);
  });
});
