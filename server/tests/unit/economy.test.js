'use strict';

/**
 * tests/unit/economy.test.js —— 金币与利息
 * 重点：利息公式 MIN(FLOOR(gold/step)*perStep, cap)、利息只看 gold_before、
 *      连胜/连败分档取最大档、出售退款倍率、金币上限截断。
 */

const {
  calcInterest,
  calcInterestSteps,
  calcStreakBonus,
  calcRoundIncome,
  calcGoldAfter,
  applyGoldCap,
  calcSellRefund,
  estimateIncome,
} = require('../../src/engine/economy');
const { economyConfig } = require('./support/balance');

describe('calcInterest 利息计算', () => {
  test('每 10 金 1 利息，且向下取整', () => {
    expect(calcInterest(0, economyConfig)).toBe(0);
    expect(calcInterest(4, economyConfig)).toBe(0);
    expect(calcInterest(9, economyConfig)).toBe(0); // 差 1 金不给利息
    expect(calcInterest(10, economyConfig)).toBe(1);
    expect(calcInterest(19, economyConfig)).toBe(1);
    expect(calcInterest(20, economyConfig)).toBe(2);
    expect(calcInterest(49, economyConfig)).toBe(4);
  });

  test('利息上限为 5 金（边界：50 金封顶，99/100 金不再增加）', () => {
    expect(calcInterest(50, economyConfig)).toBe(5);
    expect(calcInterest(51, economyConfig)).toBe(5);
    expect(calcInterest(99, economyConfig)).toBe(5);
    expect(calcInterest(100, economyConfig)).toBe(5);
    expect(calcInterest(999, economyConfig)).toBe(5);
  });

  test('与公式 MIN(FLOOR(gold/10),5) 完全一致（0~200 金逐点校验）', () => {
    for (let gold = 0; gold <= 200; gold += 1) {
      expect(calcInterest(gold, economyConfig)).toBe(Math.min(Math.floor(gold / 10), 5));
    }
  });

  test('利息参数全部来自配置，改配置即刻生效（不写死 10/1/5）', () => {
    const custom = {
      ...economyConfig,
      interestGoldStep: 20,
      interestPerStep: 2,
      interestCap: 6,
    };
    expect(calcInterest(19, custom)).toBe(0);
    expect(calcInterest(20, custom)).toBe(2);
    expect(calcInterest(40, custom)).toBe(4);
    expect(calcInterest(60, custom)).toBe(6); // 3 档 × 2 = 6，刚好不被截断
    expect(calcInterest(100, custom)).toBe(6); // 10 金利息被 cap 截断到 6
  });

  test('利息档位用于 UI 提示（未截断的档数）', () => {
    expect(calcInterestSteps(0, economyConfig)).toBe(0);
    expect(calcInterestSteps(48, economyConfig)).toBe(4);
    expect(calcInterestSteps(123, economyConfig)).toBe(12); // 档位本身不截断
  });

  test('非法入参与缺配置直接抛错', () => {
    expect(() => calcInterest(-1, economyConfig)).toThrow(RangeError);
    expect(() => calcInterest('10', economyConfig)).toThrow(TypeError);
    expect(() => calcInterest(10, {})).toThrow(TypeError);
    expect(() => calcInterest(10, { ...economyConfig, interestGoldStep: 0 })).toThrow(RangeError);
  });
});

describe('calcStreakBonus 连胜/连败奖励', () => {
  test('未达 2 连不给奖励，逐档提升', () => {
    expect(calcStreakBonus({ winStreak: 0 }, economyConfig).bonus).toBe(0);
    expect(calcStreakBonus({ winStreak: 1 }, economyConfig).bonus).toBe(0);
    expect(calcStreakBonus({ winStreak: 2 }, economyConfig).bonus).toBe(1);
    expect(calcStreakBonus({ winStreak: 3 }, economyConfig).bonus).toBe(1);
    expect(calcStreakBonus({ winStreak: 4 }, economyConfig).bonus).toBe(2);
    expect(calcStreakBonus({ winStreak: 6 }, economyConfig).bonus).toBe(3);
  });

  test('取满足的最大档，不叠加多档（7 连仍是 3 金封顶）', () => {
    expect(calcStreakBonus({ winStreak: 7 }, economyConfig).bonus).toBe(3);
    expect(calcStreakBonus({ winStreak: 30 }, economyConfig).bonus).toBe(3);
    expect(calcStreakBonus({ winStreak: 30 }, economyConfig).matchedRule).toEqual({
      minStreak: 6,
      bonus: 3,
    });
  });

  test('连败与连胜使用同一套分档', () => {
    expect(calcStreakBonus({ loseStreak: 5 }, economyConfig)).toEqual({
      streak: 5,
      bonus: 2,
      matchedRule: { minStreak: 4, bonus: 2 },
    });
  });

  test('连胜与连败同时存在时取较大者（正常流程不会同时非零）', () => {
    expect(calcStreakBonus({ winStreak: 2, loseStreak: 5 }, economyConfig).streak).toBe(5);
  });

  test('分档配置非法（重复档位 / 空数组）抛错', () => {
    expect(() => calcStreakBonus({ winStreak: 2 }, { streakBonusRules: [] })).toThrow(TypeError);
    expect(() =>
      calcStreakBonus(
        { winStreak: 2 },
        { streakBonusRules: [{ minStreak: 2, bonus: 1 }, { minStreak: 2, bonus: 3 }] },
      ),
    ).toThrow(RangeError);
    expect(() =>
      calcStreakBonus({ winStreak: 2 }, { streakBonusRules: [{ minStreak: 0, bonus: 1 }] }),
    ).toThrow(TypeError);
  });
});

describe('calcRoundIncome 回合收入', () => {
  test('文档示例：8 金、无连胜 → 基础 5 + 利息 0 = 5，结算后 13 金', () => {
    const income = calcRoundIncome({ goldBefore: 8, winStreak: 0, loseStreak: 0 }, economyConfig);
    expect(income).toEqual({
      goldBefore: 8,
      base: 5,
      interest: 0,
      interestSteps: 0,
      streak: 0,
      streakBonus: 0,
      total: 5,
    });
    expect(calcGoldAfter({ goldBefore: 8, incomeTotal: income.total }, economyConfig).goldAfter).toBe(13);
  });

  test('收入 = 基础 + 利息 + 连胜奖励', () => {
    const income = calcRoundIncome({ goldBefore: 50, winStreak: 3 }, economyConfig);
    expect(income.base).toBe(5);
    expect(income.interest).toBe(5);
    expect(income.streakBonus).toBe(1);
    expect(income.total).toBe(11);
  });

  test('★ 利息只按 gold_before 计算，不含本回合基础收入（防循环依赖）', () => {
    // 9 金：若先加 5 金基础收入再算利息会变成 1 金利息；正确口径是 0
    expect(calcRoundIncome({ goldBefore: 9 }, economyConfig).interest).toBe(0);
    // 45 金：正确利息 4，错误口径（45+5=50）会算成 5
    expect(calcRoundIncome({ goldBefore: 45 }, economyConfig).interest).toBe(4);
  });

  test('goldBefore 为 0 时只有基础收入', () => {
    expect(calcRoundIncome({ goldBefore: 0 }, economyConfig).total).toBe(5);
  });

  test('estimateIncome 与 calcRoundIncome 语义一致', () => {
    expect(estimateIncome({ goldBefore: 23, loseStreak: 4 }, economyConfig)).toEqual(
      calcRoundIncome({ goldBefore: 23, loseStreak: 4 }, economyConfig),
    );
  });

  test('入参缺失时抛错', () => {
    expect(() => calcRoundIncome(null, economyConfig)).toThrow(TypeError);
    expect(() => calcRoundIncome({}, economyConfig)).toThrow(TypeError);
  });
});

describe('calcGoldAfter / applyGoldCap 金币上限', () => {
  test('正常结算：原有 + 收入 - 支出', () => {
    const result = calcGoldAfter({ goldBefore: 30, incomeTotal: 8, spend: 5 }, economyConfig);
    expect(result.goldAfter).toBe(33);
    expect(result.capped).toBe(false);
  });

  test('超过 max_gold 时截断并标记 capped', () => {
    const result = calcGoldAfter({ goldBefore: 995, incomeTotal: 10 }, economyConfig);
    expect(result.goldAfter).toBe(999);
    expect(result.capped).toBe(true);
  });

  test('支出超过可用金币时抛错（说明漏做了余额校验）', () => {
    expect(() => calcGoldAfter({ goldBefore: 3, incomeTotal: 5, spend: 9 }, economyConfig)).toThrow(
      RangeError,
    );
  });

  test('applyGoldCap 用于零散加币场景', () => {
    expect(applyGoldCap(120, economyConfig)).toBe(120);
    expect(applyGoldCap(1200, economyConfig)).toBe(999);
  });
});

describe('calcSellRefund 出售退款', () => {
  test('退款 = 费用 × 星级系数 × 退款比例（默认比例 1.00，不折损）', () => {
    expect(calcSellRefund({ cost: 1, star: 1 }, economyConfig).refund).toBe(1);
    expect(calcSellRefund({ cost: 2, star: 2 }, economyConfig).refund).toBe(6); // 2×3
    expect(calcSellRefund({ cost: 3, star: 3 }, economyConfig).refund).toBe(27); // 3×9
    expect(calcSellRefund({ cost: 5, star: 1 }, economyConfig).refund).toBe(5);
  });

  test('带退款比例时向下取整，不产生小数金币', () => {
    const result = calcSellRefund({ cost: 3, star: 1, refundRatio: 0.5 }, economyConfig);
    expect(result.refund).toBe(1); // FLOOR(3×1×0.5) = 1
    expect(result.refundRatio).toBe(0.5);
  });

  test('星级系数缺失 / 星级非法时抛错', () => {
    expect(() => calcSellRefund({ cost: 2, star: 4 }, economyConfig)).toThrow(RangeError);
    expect(() => calcSellRefund({ cost: 2, star: 0 }, economyConfig)).toThrow(RangeError);
    expect(() => calcSellRefund({ cost: 2, star: 1 }, {})).toThrow(TypeError);
  });

  test('0 费棋子退款为 0（边界，不出现负数）', () => {
    expect(calcSellRefund({ cost: 0, star: 3 }, economyConfig).refund).toBe(0);
  });
});
