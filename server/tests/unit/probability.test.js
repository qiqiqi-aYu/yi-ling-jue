'use strict';

/**
 * tests/unit/probability.test.js —— 加权抽卡
 * 重点：概率和校验、卡池抽空后的重归一化、两段式抽取的分布、seed 可复现。
 */

const {
  validateOdds,
  assertOdds,
  normalizeOdds,
  weightedPick,
  drawShop,
  adjustPool,
} = require('../../src/engine/probability');
const { createRng } = require('../../src/engine/rng');
const { oddsByLevel, createFullPool } = require('./support/balance');

/** 统计 n 次抽卡里各费用的出现比例 */
function sampleCosts(odds, cards, seed, times) {
  const rng = createRng(seed);
  const counter = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  let valid = 0;
  for (let i = 0; i < times; i += 1) {
    const pick = weightedPick(odds, cards, rng);
    if (!pick) continue;
    counter[pick.cost] += 1;
    valid += 1;
  }
  return { counter, valid };
}

describe('validateOdds 概率和校验', () => {
  test('seed.sql 中 9 个等级的概率配置全部合规（同级合计 = 1）', () => {
    for (const level of Object.keys(oddsByLevel)) {
      const result = validateOdds(oddsByLevel[level]);
      expect(result.valid).toBe(true);
      expect(result.total).toBe(1);
      expect(result.errors).toEqual([]);
    }
  });

  test('概率和不为 1 时判定非法（后台保存配置的拦截点）', () => {
    const result = validateOdds({ 1: 0.5, 2: 0.4 });
    expect(result.valid).toBe(false);
    expect(result.errors.join()).toContain('不等于 1');
  });

  test('单个概率超出 [0,1] 时判定非法', () => {
    expect(validateOdds({ 1: 1.2, 2: -0.2 }).valid).toBe(false);
    expect(validateOdds({ 1: 2, 2: -1 }).errors.length).toBeGreaterThan(1);
  });

  test('允许 1e-6 级浮点误差（DECIMAL 转浮点求和不会误杀合法配置）', () => {
    // 0.55 + 0.30 + 0.15 在浮点下是 0.9999999999999999
    expect(validateOdds({ 1: 0.55, 2: 0.3, 3: 0.15 }).valid).toBe(true);
    // 但 0.9999 这种真实缺口必须被拦住
    expect(validateOdds({ 1: 0.55, 2: 0.3, 3: 0.1499 }).valid).toBe(false);
  });

  test('支持对象 / 数组 / Map 三种写法，并统一成 Map<cost, probability>', () => {
    const fromArray = normalizeOdds([
      { cost: 1, probability: 0.75 },
      { cost: 2, probability: 0.25 },
    ]);
    const fromMap = normalizeOdds(new Map([[2, 0.25], [1, 0.75]]));
    expect([...fromArray.entries()]).toEqual([[1, 0.75], [2, 0.25]]);
    expect([...fromMap.entries()]).toEqual([[1, 0.75], [2, 0.25]]);
    expect(validateOdds([{ cost: 1, probability: 0.75 }, { cost: 2, probability: 0.25 }]).valid).toBe(
      true,
    );
  });

  test('空配置 / 非法结构判定非法', () => {
    expect(validateOdds({}).valid).toBe(false);
    expect(validateOdds(null).valid).toBe(false);
    expect(validateOdds('1').valid).toBe(false);
  });

  test('assertOdds 失败时抛错并带上可读原因', () => {
    expect(() => assertOdds({ 1: 0.5, 2: 0.4 })).toThrow(/概率合计/);
    expect(() => assertOdds(oddsByLevel[9])).not.toThrow();
  });
});

describe('weightedPick 两段式抽卡', () => {
  test('按费用档概率分布抽取（9 级 20000 次抽样误差 < 1.5%）', () => {
    const odds = oddsByLevel[9];
    const { counter, valid } = sampleCosts(odds, createFullPool(), 'dist-9', 20000);
    expect(valid).toBe(20000);
    for (const cost of [1, 2, 3, 4, 5]) {
      const actual = counter[cost] / valid;
      expect(Math.abs(actual - odds[cost])).toBeLessThan(0.015);
    }
  });

  test('卡池抽空的费用档被剔除，剩余档位重新归一化（不会抽到空档位）', () => {
    const cards = [
      { heroId: 1, cost: 1, remaining: 5 },
      { heroId: 2, cost: 2, remaining: 0 },
      { heroId: 5, cost: 3, remaining: 0 },
      { heroId: 7, cost: 4, remaining: 0 },
      { heroId: 9, cost: 5, remaining: 0 },
    ];
    const { counter, valid } = sampleCosts(oddsByLevel[9], cards, 'exhaust', 3000);
    expect(valid).toBe(3000);
    expect(counter[1]).toBe(3000);
    expect(counter[2] + counter[3] + counter[4] + counter[5]).toBe(0);

    // 剩余权重表只有 1 费一档，实际概率被放大到 1
    const pick = weightedPick(oddsByLevel[9], cards, createRng('exhaust-2'));
    expect(pick.costWeights).toEqual([{ cost: 1, weight: 0.1 }]);
    expect(pick.effectiveProbability).toBeCloseTo(1, 10);
  });

  test('多档剩余时按原比例重归一化（1 费:3 费 = 0.1:0.25）', () => {
    const cards = [
      { heroId: 1, cost: 1, remaining: 5 },
      { heroId: 5, cost: 3, remaining: 5 },
    ];
    const { counter, valid } = sampleCosts(oddsByLevel[9], cards, 'renorm', 4000);
    const expected = 0.1 / (0.1 + 0.25); // ≈ 0.2857
    expect(counter[1] / valid).toBeCloseTo(expected, 1);
  });

  test('同一费用内按剩余张数加权（3:1 余量 → 约 3:1 命中）', () => {
    const odds = { 1: 1, 2: 0, 3: 0, 4: 0, 5: 0 };
    const cards = [
      { heroId: 1, cost: 1, remaining: 30 },
      { heroId: 2, cost: 1, remaining: 10 },
    ];
    const rng = createRng('within-cost');
    let first = 0;
    const times = 4000;
    for (let i = 0; i < times; i += 1) {
      if (weightedPick(odds, cards, rng).heroId === 1) first += 1;
    }
    expect(first / times).toBeGreaterThan(0.70);
    expect(first / times).toBeLessThan(0.80);
  });

  test('卡池全空返回 null（调用方据此提示"卡池已空"）', () => {
    const cards = createFullPool().map((card) => ({ ...card, remaining: 0 }));
    expect(weightedPick(oddsByLevel[9], cards, createRng('empty'))).toBeNull();
    expect(weightedPick(oddsByLevel[9], [], createRng('empty-2'))).toBeNull();
  });

  test('★ 同 seed 同卡池 → 完全相同的抽卡结果（战报可复算）', () => {
    const run = (seed) => {
      const rng = createRng(seed);
      const picks = [];
      for (let i = 0; i < 20; i += 1) picks.push(weightedPick(oddsByLevel[8], createFullPool(), rng));
      return picks;
    };
    expect(run(881337212)).toEqual(run(881337212));
    expect(run(881337212)).not.toEqual(run(881337213));
  });

  test('返回的 rolls / remainingBefore 可用于战报与排错', () => {
    const pick = weightedPick(oddsByLevel[7], createFullPool(), createRng('trace'));
    expect(pick.remainingBefore).toBeGreaterThan(0);
    expect(pick.rolls.cost).toBeGreaterThanOrEqual(0);
    expect(pick.rolls.hero).toBeGreaterThanOrEqual(0);
    expect(pick.costOdds).toBe(oddsByLevel[7][pick.cost]);
    expect(pick.effectiveProbability).toBeGreaterThan(0);
    expect(pick.effectiveProbability).toBeLessThanOrEqual(1);
  });

  test('入参非法抛错（缺 rng、卡池字段错）', () => {
    expect(() => weightedPick(oddsByLevel[1], createFullPool(), null)).toThrow(TypeError);
    expect(() => weightedPick(oddsByLevel[1], 'pool', createRng(1))).toThrow(TypeError);
    expect(() =>
      weightedPick(oddsByLevel[1], [{ heroId: 1, cost: 1, remaining: -1 }], createRng(1)),
    ).toThrow(RangeError);
  });
});

describe('drawShop 整排抽取', () => {
  test('抽 5 格且不重复超发（按卡池余量实时扣减）', () => {
    const cards = createFullPool();
    const result = drawShop({ odds: oddsByLevel[9], cards, rng: createRng('shop-5'), count: 5 });
    expect(result.drawnCount).toBe(5);
    expect(result.picks).toHaveLength(5);
    expect(result.exhausted).toBe(false);
  });

  test('卡池只剩 2 张时只抽到 2 格并标记 exhausted', () => {
    const cards = [
      { heroId: 1, cost: 1, remaining: 1 },
      { heroId: 2, cost: 1, remaining: 1 },
    ];
    const result = drawShop({ odds: oddsByLevel[1], cards, rng: createRng('shop-2'), count: 5 });
    expect(result.drawnCount).toBe(2);
    expect(result.exhausted).toBe(true);
    expect(result.picks.map((pick) => pick.heroId).sort()).toEqual([1, 2]);
  });

  test('同一英雄剩余 1 张时，一排里不会出现两次', () => {
    const cards = [
      { heroId: 1, cost: 1, remaining: 1 },
      { heroId: 2, cost: 1, remaining: 20 },
    ];
    const result = drawShop({ odds: oddsByLevel[1], cards, rng: createRng('shop-dup'), count: 5 });
    const hero1Count = result.picks.filter((pick) => pick.heroId === 1).length;
    expect(hero1Count).toBeLessThanOrEqual(1);
    expect(result.drawnCount).toBe(5);
  });

  test('不修改入参卡池（保持纯函数语义）', () => {
    const cards = createFullPool();
    const snapshot = JSON.parse(JSON.stringify(cards));
    drawShop({ odds: oddsByLevel[9], cards, rng: createRng('pure'), count: 5 });
    expect(cards).toEqual(snapshot);
  });

  test('同 seed 刷新出的商店完全一致', () => {
    const draw = (seed) =>
      drawShop({ odds: oddsByLevel[6], cards: createFullPool(), rng: createRng(seed), count: 5 }).picks;
    expect(draw('shop-seed')).toEqual(draw('shop-seed'));
  });

  test('count 非法抛错', () => {
    expect(() =>
      drawShop({ odds: oddsByLevel[1], cards: createFullPool(), rng: createRng(1), count: -1 }),
    ).toThrow(RangeError);
  });
});

describe('adjustPool 卡池增减', () => {
  test('购买扣减、出售归还', () => {
    const cards = createFullPool();
    const afterBuy = adjustPool(cards, 1, -1);
    expect(afterBuy.find((card) => card.heroId === 1).remaining).toBe(28);
    const afterSell = adjustPool(afterBuy, 1, 1);
    expect(afterSell.find((card) => card.heroId === 1).remaining).toBe(29);
    // 入参未被修改
    expect(cards.find((card) => card.heroId === 1).remaining).toBe(29);
  });

  test('扣减为负 / 英雄不存在时抛错', () => {
    const cards = [{ heroId: 1, cost: 1, remaining: 0 }];
    expect(() => adjustPool(cards, 1, -1)).toThrow(RangeError);
    expect(() => adjustPool(cards, 999, -1)).toThrow(RangeError);
  });
});
