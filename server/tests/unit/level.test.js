'use strict';

/**
 * tests/unit/level.test.js —— 棋手等级与经验内核（engine/level.js）
 *
 * 覆盖点：
 *   - 经验表推进（1/2/4/8/16/24/32/40）
 *   - 单次经验溢出连续升级
 *   - 9 级封顶后经验不再累计
 *   - 购买经验的金币 / 等级校验（含判定顺序）
 *   - 经验条百分比与人口上限
 */

const {
  levelState, grantExp, canBuyExp, buyExpOnce, BUY_EXP_DENIED,
} = require('../../src/engine/level');

/** 与数据库 level_config 同口径的假配置：人口上限 = 等级 */
function makeLevelConfig(overrides = {}) {
  const expTable = { 1: 1, 2: 2, 3: 4, 4: 8, 5: 16, 6: 24, 7: 32, 8: 40, 9: 0 };
  const byLevel = new Map(
    Object.entries(expTable).map(([level, expToNext]) => [
      Number(level),
      { level: Number(level), expToNext, maxBoardSlots: Number(level), refreshCost: 2 },
    ]),
  );
  return {
    maxLevel: 9,
    expPerRound: 1,
    buyExpGold: 5,
    buyExpAmount: 4,
    byLevel,
    ...overrides,
  };
}

describe('engine/level · levelState', () => {
  const config = makeLevelConfig();

  test('1 级 0 经验：所需经验 1、人口上限 1、经验条 0%', () => {
    const view = levelState(1, 0, config);
    expect(view).toMatchObject({
      level: 1, exp: 0, nextExp: 1, maxUnit: 1, expPercent: 0, isMaxLevel: false,
    });
  });

  test('4 级 4/8 经验：经验条向下取整为 50%', () => {
    const view = levelState(4, 4, config);
    expect(view.nextExp).toBe(8);
    expect(view.maxUnit).toBe(4);
    expect(view.expPercent).toBe(50);
  });

  test('9 级封顶：nextExp 为 null、经验归零、经验条 100%', () => {
    const view = levelState(9, 35, config);
    expect(view.nextExp).toBeNull();
    expect(view.exp).toBe(0);
    expect(view.maxUnit).toBe(9);
    expect(view.expPercent).toBe(100);
    expect(view.isMaxLevel).toBe(true);
  });

  test('等级越界或经验为负时抛错，避免脏数据静默通过', () => {
    expect(() => levelState(0, 0, config)).toThrow(/level 必须在/);
    expect(() => levelState(10, 0, config)).toThrow(/level 必须在/);
    expect(() => levelState(1, -1, config)).toThrow(/exp 必须是非负整数/);
  });
});

describe('engine/level · grantExp', () => {
  const config = makeLevelConfig();

  test('1 级 +1 经验：正好升到 2 级，余 0 经验', () => {
    const next = grantExp({ level: 1, exp: 0 }, 1, config);
    expect(next).toMatchObject({ level: 2, exp: 0, leveled: 1, nextExp: 2, maxUnit: 2 });
  });

  test('单次 +4 经验从 1 级连升：1→2(耗 1) 2→3(耗 2) 后余 1', () => {
    const next = grantExp({ level: 1, exp: 0 }, 4, config);
    expect(next).toMatchObject({ level: 3, exp: 1, leveled: 2, nextExp: 4, maxUnit: 3 });
  });

  test('经验不足时只累计不升级', () => {
    // 3 级需要 4 点，2 + 1 = 3 仍不足，停留 3 级
    const next = grantExp({ level: 3, exp: 2 }, 1, config);
    expect(next).toMatchObject({ level: 3, exp: 3, leveled: 0 });
  });

  test('经验刚好达到阈值时立刻升级并清零', () => {
    const next = grantExp({ level: 3, exp: 3 }, 1, config);
    expect(next).toMatchObject({ level: 4, exp: 0, leveled: 1 });
  });

  test('接近满级时经验溢出被丢弃并封顶 9 级', () => {
    const next = grantExp({ level: 8, exp: 39 }, 10, config);
    expect(next).toMatchObject({ level: 9, exp: 0, leveled: 1, isMaxLevel: true, capped: true });
  });

  test('已是 9 级再获得经验：等级不变、经验保持 0', () => {
    const next = grantExp({ level: 9, exp: 0 }, 4, config);
    expect(next).toMatchObject({ level: 9, exp: 0, leveled: 0, capped: true });
  });

  test('每回合 +1 经验按表推进：连打 5 回合到 3 级', () => {
    let state = { level: 1, exp: 0 };
    for (let round = 0; round < 5; round += 1) {
      const next = grantExp(state, config.expPerRound, config);
      state = { level: next.level, exp: next.exp };
    }
    // 1→2 耗 1、2→3 耗 2，共 3 点，打 5 回合应到 3 级并余 2 点
    expect(state).toEqual({ level: 3, exp: 2 });
  });
});

describe('engine/level · canBuyExp', () => {
  const config = makeLevelConfig();

  test('金币足够且未满级时允许购买', () => {
    expect(canBuyExp({ level: 1, gold: 5 }, config)).toEqual({
      allowed: true, reason: null, message: '',
    });
  });

  test('金币低于 5 时拒绝购买', () => {
    const result = canBuyExp({ level: 3, gold: 4 }, config);
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe(BUY_EXP_DENIED.GOLD_NOT_ENOUGH);
    expect(result.message).toContain('5');
  });

  test('9 级时即使金币充足也拒绝，且优先返回满级原因', () => {
    const result = canBuyExp({ level: 9, gold: 99 }, config);
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe(BUY_EXP_DENIED.LEVEL_MAX);
    expect(result.message).toContain('9');
  });
});

describe('engine/level · buyExpOnce', () => {
  const config = makeLevelConfig();

  test('5 金换 4 经验：扣金、加经验、溢出自动升级', () => {
    const result = buyExpOnce({ level: 1, exp: 0, gold: 12 }, config);
    expect(result).toMatchObject({
      allowed: true,
      goldCost: 5,
      expGain: 4,
      goldAfter: 7,
      level: 3,
      exp: 1,
      leveled: 2,
      maxUnit: 3,
    });
  });

  test('金币不足时不产生任何消耗', () => {
    const result = buyExpOnce({ level: 2, exp: 0, gold: 4 }, config);
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe(BUY_EXP_DENIED.GOLD_NOT_ENOUGH);
    expect(result.expGain).toBe(0);
    expect(result.goldAfter).toBe(4);
  });

  test('9 级时不扣金币', () => {
    const result = buyExpOnce({ level: 9, exp: 0, gold: 50 }, config);
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe(BUY_EXP_DENIED.LEVEL_MAX);
    expect(result.goldAfter).toBe(50);
  });

  test('配置驱动：改 buyExpGold / buyExpAmount 后结果随之变化', () => {
    const custom = makeLevelConfig({ buyExpGold: 3, buyExpAmount: 2 });
    const result = buyExpOnce({ level: 1, exp: 0, gold: 10 }, custom);
    expect(result.goldAfter).toBe(7);
    expect(result.level).toBe(2);
    expect(result.exp).toBe(1);
  });
});
