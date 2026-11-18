'use strict';

/**
 * tests/unit/rng.test.js —— 可复现随机数发生器
 * 重点：同 seed 同序列、不同 seed 可区分、派生流与状态还原不失真。
 */

const { createRng, restoreRng, normalizeSeed, deriveSeed } = require('../../src/engine/rng');

/** 取前 n 个随机数，便于比较两条流是否一致 */
function take(rng, n) {
  const list = [];
  for (let i = 0; i < n; i += 1) list.push(rng.next());
  return list;
}

describe('rng 种子规范化', () => {
  test('数字 / 数字字符串 / bigint 三种写法的种子等价（数据库 BIGINT 常以字符串返回）', () => {
    const fromNumber = normalizeSeed(881337212);
    const fromString = normalizeSeed('881337212');
    const fromBigInt = normalizeSeed(881337212n);
    expect(fromString).toBe(fromNumber);
    expect(fromBigInt).toBe(fromNumber);
  });

  test('超出 32 位的 BIGINT 种子会被折叠且仍然稳定', () => {
    const big = 9223372036854775n; // 超过 Number.MAX_SAFE_INTEGER，必须用 bigint 传
    expect(normalizeSeed(big)).toBe(normalizeSeed(big));
    expect(Number.isInteger(normalizeSeed(big))).toBe(true);
    // 高 32 位参与折叠：只改高位应当得到不同种子
    expect(normalizeSeed(1n)).not.toBe(normalizeSeed(1n + (1n << 32n)));
  });

  test('字符串标签与数字种子可区分', () => {
    expect(normalizeSeed('battle')).not.toBe(normalizeSeed('shop'));
    expect(normalizeSeed('battle')).toBe(normalizeSeed('battle'));
  });

  test('seed 为 0 合法（不能被当成 falsy 丢掉）', () => {
    expect(() => createRng(0)).not.toThrow();
    expect(createRng(0).next()).toBeGreaterThanOrEqual(0);
  });

  test('空种子 / 非法类型直接抛错，避免「随机退化」静默发生', () => {
    expect(() => normalizeSeed(undefined)).toThrow(TypeError);
    expect(() => normalizeSeed(null)).toThrow(TypeError);
    expect(() => normalizeSeed('')).toThrow(TypeError);
    expect(() => normalizeSeed({})).toThrow(TypeError);
    expect(() => normalizeSeed(NaN)).toThrow(TypeError);
    expect(() => normalizeSeed(Infinity)).toThrow(TypeError);
  });
});

describe('rng 可复现性', () => {
  test('同 seed 产生完全相同的序列', () => {
    const a = take(createRng(20261116), 64);
    const b = take(createRng(20261116), 64);
    expect(b).toEqual(a);
  });

  test('不同 seed 产生不同序列', () => {
    const a = take(createRng(1), 32);
    const b = take(createRng(2), 32);
    expect(b).not.toEqual(a);
  });

  test('next() 恒落在 [0,1)', () => {
    const rng = createRng('battle-flow');
    for (let i = 0; i < 1000; i += 1) {
      const value = rng.next();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });

  test('draws 记录随机流消耗次数', () => {
    const rng = createRng(7);
    expect(rng.draws).toBe(0);
    rng.next();
    rng.nextInt(1, 6);
    expect(rng.draws).toBe(2);
  });
});

describe('rng 派生流与状态还原', () => {
  test('fork 同标签结果一致，不同标签结果不同', () => {
    const parent = createRng(99);
    const battleA = take(parent.fork('battle'), 16);
    const battleB = take(parent.fork('battle'), 16);
    const shop = take(parent.fork('shop'), 16);
    expect(battleB).toEqual(battleA);
    expect(shop).not.toEqual(battleA);
  });

  test('fork 不消耗父流（战斗与商店互不干扰）', () => {
    const parent = createRng(99);
    const before = parent.draws;
    parent.fork('battle');
    parent.fork('shop');
    expect(parent.draws).toBe(before);
  });

  test('restoreRng 还原后继续推进的序列与不中断时一致', () => {
    const original = createRng('snapshot-seed');
    take(original, 5);
    const snapshot = original.state;
    const expected = take(original, 8);

    const restored = restoreRng('snapshot-seed', snapshot);
    expect(take(restored, 8)).toEqual(expected);
  });

  test('setState 校验非法状态', () => {
    const rng = createRng(1);
    expect(() => rng.setState(-1)).toThrow(RangeError);
    expect(() => rng.setState(1.5)).toThrow(RangeError);
    expect(() => rng.setState(2 ** 32)).toThrow(RangeError);
  });

  test('deriveSeed 稳定且能用于把「对局种子 + 用途」写进日志', () => {
    expect(deriveSeed(123, 'battle-1-3')).toBe(deriveSeed(123, 'battle-1-3'));
    expect(deriveSeed(123, 'battle-1-3')).not.toBe(deriveSeed(123, 'battle-1-4'));
  });
});

describe('rng 取值工具', () => {
  test('nextInt 闭区间且有边界校验', () => {
    const rng = createRng('dice');
    for (let i = 0; i < 500; i += 1) {
      const value = rng.nextInt(1, 6);
      expect(Number.isInteger(value)).toBe(true);
      expect(value).toBeGreaterThanOrEqual(1);
      expect(value).toBeLessThanOrEqual(6);
    }
    expect(() => rng.nextInt(6, 1)).toThrow(RangeError);
    expect(() => rng.nextInt(1.5, 3)).toThrow(TypeError);
  });

  test('nextInt 能覆盖到区间每个整数（不漏边界）', () => {
    const rng = createRng('coverage');
    const seen = new Set();
    for (let i = 0; i < 600; i += 1) seen.add(rng.nextInt(1, 6));
    expect([...seen].sort()).toEqual([1, 2, 3, 4, 5, 6]);
  });

  test('chance(0) 恒 false、chance(1) 恒 true 且不消耗随机数', () => {
    const rng = createRng('chance');
    expect(rng.chance(0)).toBe(false);
    expect(rng.draws).toBe(0);
    expect(rng.chance(1)).toBe(true);
    expect(rng.draws).toBe(0);

    let hits = 0;
    for (let i = 0; i < 4000; i += 1) if (rng.chance(0.25)) hits += 1;
    // 4000 次、p=0.25，期望 1000，允许 ±10% 波动
    expect(hits).toBeGreaterThan(850);
    expect(hits).toBeLessThan(1150);
  });

  test('pick 空数组返回 undefined，非空数组取到合法元素', () => {
    const rng = createRng('pick');
    expect(rng.pick([])).toBeUndefined();
    const list = ['a', 'b', 'c'];
    for (let i = 0; i < 100; i += 1) expect(list).toContain(rng.pick(list));
    expect(() => rng.pick('abc')).toThrow(TypeError);
  });

  test('weightedIndex 按权重命中且忽略 0 权重项', () => {
    const rng = createRng('weighted');
    const counts = [0, 0, 0];
    for (let i = 0; i < 4000; i += 1) counts[rng.weightedIndex([1, 0, 3])] += 1;
    expect(counts[1]).toBe(0);
    // 1:3 权重 → 约 25% : 75%
    expect(counts[0]).toBeGreaterThan(800);
    expect(counts[0]).toBeLessThan(1200);
    expect(counts[2]).toBeGreaterThan(2800);
  });

  test('weightedIndex 无有效权重返回 -1，非法权重抛错', () => {
    const rng = createRng('weighted-edge');
    expect(rng.weightedIndex([0, 0, 0])).toBe(-1);
    expect(() => rng.weightedIndex([1, -1])).toThrow(RangeError);
    expect(() => rng.weightedIndex([1, NaN])).toThrow(RangeError);
  });

  test('shuffle 是合法排列、不修改入参、且可复现', () => {
    const rng = createRng('shuffle');
    const source = [1, 2, 3, 4, 5, 6, 7, 8];
    const shuffled = rng.shuffle(source);
    expect(source).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect([...shuffled].sort((a, b) => a - b)).toEqual(source);
    expect(createRng('shuffle').shuffle(source)).toEqual(shuffled);
  });
});
