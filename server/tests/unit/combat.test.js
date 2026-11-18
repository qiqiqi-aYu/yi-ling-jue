'use strict';

/**
 * tests/unit/combat.test.js —— 战斗模拟器
 * 重点：同 seed 逐帧可复现、强弱判定、超时按血量比例、闪避/暴击/复生/秘技四个随机分支、
 *      时间轴结构与上限压缩、非法入参防御。
 */

const { simulateBattle, mitigate, chooseTarget, DEFAULT_COMBAT } = require('../../src/engine/combat');
const { createRng } = require('../../src/engine/rng');

/**
 * 构造一个棋子运行态（默认值够用，测试只覆盖关心的字段）。
 * @param {number|string} uid 唯一 id
 * @param {Object} [overrides] 覆盖字段
 * @returns {Object} 棋子
 */
function unit(uid, overrides = {}) {
  return {
    uid,
    heroId: overrides.heroId || 1,
    star: 1,
    hp: 1000,
    maxHp: 1000,
    attack: 100,
    attackSpeed: 1,
    ...overrides,
  };
}

/** 固定模型参数，避免测试受默认值变化影响 */
const model = {
  battleMaxSeconds: 30,
  tickSeconds: 0.1,
  skillEveryAttacks: 4,
  skillPowerRatio: 1.5,
  armorK: 100,
  critBaseMultiplier: 1.5,
  maxTimelineEntries: 600,
  healRatio: 0.5,
  defaultReviveHpPercent: 0.3,
};

describe('入参与边界', () => {
  test('空阵容直接判负，不消耗模拟时长', () => {
    const result = simulateBattle({ teamA: [], teamB: [unit(1)], rng: createRng(1), config: model });
    expect(result.result).toBe('lose');
    expect(result.winner).toBe('B');
    expect(result.durationSeconds).toBe(0);
    expect(result.timeline).toHaveLength(0);
  });

  test('双方都空 → 平局', () => {
    const result = simulateBattle({ teamA: [], teamB: [], rng: createRng(1), config: model });
    expect(result.result).toBe('draw');
    expect(result.winner).toBeNull();
  });

  test('缺少随机源 / 入参不是数组 / uid 冲突 → 抛错', () => {
    expect(() => simulateBattle({ teamA: [unit(1)], teamB: [unit(2)] })).toThrow(TypeError);
    expect(() => simulateBattle({ teamA: 'x', teamB: [], rng: createRng(1) })).toThrow(TypeError);
    expect(() =>
      simulateBattle({ teamA: [unit(1)], teamB: [unit(1)], rng: createRng(1), config: model }),
    ).toThrow(RangeError);
  });

  test('血量非正数 / 攻击为负 → 抛错，不静默算 0', () => {
    expect(() =>
      simulateBattle({ teamA: [unit(1, { hp: 0, maxHp: 0 })], teamB: [unit(2)], rng: createRng(1) }),
    ).toThrow(TypeError);
    expect(() =>
      simulateBattle({ teamA: [unit(1, { attack: -5 })], teamB: [unit(2)], rng: createRng(1) }),
    ).toThrow(TypeError);
  });
});

describe('可复现性', () => {
  test('★ 同 seed + 同阵容 → 战报逐帧完全一致', () => {
    const build = () => ({
      teamA: [unit(1, { attack: 120, hp: 900 }), unit(2, { attack: 80, hp: 700 })],
      teamB: [unit(9, { attack: 110, hp: 850 }), unit(10, { attack: 70, hp: 950 })],
    });
    const first = simulateBattle({ ...build(), rng: createRng(20261118), config: model });
    const second = simulateBattle({ ...build(), rng: createRng(20261118), config: model });

    expect(second.result).toBe(first.result);
    expect(second.durationSeconds).toBe(first.durationSeconds);
    expect(second.timeline).toEqual(first.timeline);
  });

  test('换 seed 后战报不再相同（随机分支确实吃种子）', () => {
    const build = () => ({
      teamA: [unit(1, { attack: 100, critRate: 0.5, dodge: 0.2, hp: 800 })],
      teamB: [unit(9, { attack: 100, critRate: 0.5, dodge: 0.2, hp: 800 })],
    });
    const a = simulateBattle({ ...build(), rng: createRng(1), config: model });
    const b = simulateBattle({ ...build(), rng: createRng(999), config: model });
    expect(JSON.stringify(a.timeline)).not.toBe(JSON.stringify(b.timeline));
  });
});

describe('胜负判定', () => {
  test('★ 数值碾压方必胜（10 个不同 seed 全部 win）', () => {
    const teamA = [unit(1, { attack: 300, hp: 2000 }), unit(2, { attack: 300, hp: 2000 })];
    const teamB = [unit(9, { attack: 30, hp: 300 })];
    for (let seed = 1; seed <= 10; seed += 1) {
      const result = simulateBattle({ teamA, teamB, rng: createRng(seed), config: model });
      expect(result.result).toBe('win');
      expect(result.winner).toBe('A');
      expect(result.survivors.A).toBeGreaterThanOrEqual(1);
      expect(result.survivors.B).toBe(0);
    }
  });

  test('★ 超时按剩余血量比例判定：A 满血 / B 半血 → A 胜', () => {
    const result = simulateBattle({
      teamA: [unit(1, { attack: 0, hp: 1000, maxHp: 1000 })],
      teamB: [unit(9, { attack: 0, hp: 500, maxHp: 1000 })],
      rng: createRng(7),
      config: model,
    });
    expect(result.timedOut).toBe(true);
    expect(result.durationSeconds).toBe(30);
    expect(result.result).toBe('win');
  });

  test('超时且血量比例相同 → 平局', () => {
    const result = simulateBattle({
      teamA: [unit(1, { attack: 0 })],
      teamB: [unit(9, { attack: 0 })],
      rng: createRng(7),
      config: model,
    });
    expect(result.timedOut).toBe(true);
    expect(result.result).toBe('draw');
    expect(result.winner).toBeNull();
  });
});

describe('随机分支', () => {
  test('闪避 = 100% 时普攻全部落空，打不出击杀', () => {
    const result = simulateBattle({
      teamA: [unit(1, { attack: 500 })],
      teamB: [unit(9, { attack: 0, dodge: 1, hp: 100000, maxHp: 100000 })],
      rng: createRng(3),
      config: model,
    });
    const types = result.timeline.map((frame) => frame.type);
    expect(types).toContain('dodge');
    expect(types).not.toContain('kill');
    expect(result.timedOut).toBe(true);
  });

  test('暴击率 = 100% 时出现 crit 帧，且伤害高于普攻', () => {
    const result = simulateBattle({
      teamA: [unit(1, { attack: 100, critRate: 1 })],
      teamB: [unit(9, { attack: 0, hp: 5000, maxHp: 5000 })],
      rng: createRng(5),
      config: model,
    });
    const critFrames = result.timeline.filter((frame) => frame.type === 'crit');
    const attackFrames = result.timeline.filter((frame) => frame.type === 'attack');
    expect(critFrames.length).toBeGreaterThan(0);
    expect(attackFrames).toHaveLength(0);
    // 1.5 倍暴击：100 × 1.5 = 150
    expect(critFrames[0].value).toBe(150);
  });

  test('★ 复生只触发一次：reviveChance=1 时恰好 1 帧 revive', () => {
    const result = simulateBattle({
      teamA: [unit(1, { attack: 500, hp: 2000 })],
      teamB: [unit(9, { attack: 0, hp: 400, maxHp: 400, dynamic: { reviveChance: 1, reviveHpPercent: 0.3 } })],
      rng: createRng(11),
      config: model,
    });
    const reviveFrames = result.timeline.filter((frame) => frame.type === 'revive');
    expect(reviveFrames).toHaveLength(1);
    expect(reviveFrames[0].targetHp).toBe(120); // 400 × 30%
    expect(result.result).toBe('win');
  });

  test('冷却缩减让秘技更频繁', () => {
    const make = (cdReduce) =>
      simulateBattle({
        teamA: [unit(1, { attack: 100, attackSpeed: 2, cdReduce })],
        teamB: [unit(9, { attack: 0, hp: 100000, maxHp: 100000 })],
        rng: createRng(21),
        config: model,
      });
    const normal = make(0);
    const reduced = make(0.5);
    const countSkill = (report) => report.timeline.filter((frame) => frame.type === 'skill').length;
    expect(countSkill(reduced)).toBeGreaterThan(countSkill(normal));
  });

  test('秘技吸血会回血，且不超过上限', () => {
    const result = simulateBattle({
      teamA: [unit(1, { attack: 100, attackSpeed: 2, spellLifesteal: 0.5, hp: 600, maxHp: 1000 })],
      teamB: [unit(9, { attack: 0, hp: 100000, maxHp: 100000 })],
      rng: createRng(31),
      config: model,
    });
    const healFrames = result.timeline.filter((frame) => frame.type === 'heal');
    expect(healFrames.length).toBeGreaterThan(0);
    healFrames.forEach((frame) => {
      expect(frame.targetHp).toBeLessThanOrEqual(1000);
    });
  });
});

describe('时间轴结构', () => {
  test('t 单调不减，字段齐全，血量不为负', () => {
    const result = simulateBattle({
      teamA: [unit(1, { attack: 150, critRate: 0.3 }), unit(2, { attack: 60 })],
      teamB: [unit(9, { attack: 90, dodge: 0.1, dynamic: { reviveChance: 0.5 } })],
      rng: createRng(42),
      config: model,
    });
    expect(result.timeline.length).toBeGreaterThan(5);
    let last = 0;
    for (const frame of result.timeline) {
      expect(typeof frame.t).toBe('number');
      expect(frame.t).toBeGreaterThanOrEqual(last);
      last = frame.t;
      expect(frame).toHaveProperty('actor');
      expect(frame).toHaveProperty('target');
      expect(typeof frame.type).toBe('string');
      expect(frame.value).toBeGreaterThanOrEqual(0);
      expect(frame.targetHp).toBeGreaterThanOrEqual(0);
    }
  });

  test('帧数超过上限时压缩普通攻击，但保留关键帧', () => {
    const result = simulateBattle({
      teamA: [unit(1, { attack: 1, attackSpeed: 5 })],
      teamB: [unit(9, { attack: 0, hp: 100000, maxHp: 100000 })],
      rng: createRng(8),
      config: { ...model, maxTimelineEntries: 10 },
    });
    expect(result.timelineTruncated).toBe(true);
    const skills = result.timeline.filter((frame) => frame.type === 'skill');
    expect(skills.length).toBeGreaterThan(0);
  });
});

describe('工具函数', () => {
  test('护甲减伤：armor=100 时伤害减半，0 伤害仍为 0', () => {
    expect(mitigate(100, 0, 100)).toBe(100);
    expect(mitigate(100, 100, 100)).toBe(50);
    expect(mitigate(0, 100, 100)).toBe(0);
  });

  test('选目标：最近优先，同距离取血量更低者', () => {
    const attacker = unit(1, { row: 0, col: 0 });
    const far = unit(9, { row: 3, col: 6, hp: 100 });
    const nearHealthy = unit(10, { row: 1, col: 1, hp: 900 });
    const nearHurt = unit(11, { row: 1, col: 0, hp: 200 });
    expect(chooseTarget(attacker, [far, nearHealthy, nearHurt]).uid).toBe(11);
    expect(chooseTarget(attacker, [])).toBeUndefined();
  });

  test('默认模型参数可被 config 覆盖', () => {
    expect(DEFAULT_COMBAT.battleMaxSeconds).toBe(30);
    const result = simulateBattle({
      teamA: [unit(1, { attack: 0 })],
      teamB: [unit(9, { attack: 0 })],
      rng: createRng(2),
      config: { battleMaxSeconds: 5, tickSeconds: 0.1 },
    });
    expect(result.durationSeconds).toBe(5);
  });
});
