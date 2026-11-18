'use strict';

/**
 * tests/unit/synergy.test.js —— 羁绊统计
 * 重点：同名英雄只计 1、档位取最高、多档配置、下一档提示、未配置羁绊的兜底。
 */

const { computeTraits, collectActiveEffects, collectTraitHeroes } = require('../../src/engine/synergy');
const { traitLevels, traitMeta, getHero } = require('./support/balance');

/**
 * 按「英雄 id + 星级」组装棋盘棋子。
 * @param {Array<number|[number, number]>} specs 形如 [1, [3, 2]]（数字默认 1 星）
 * @returns {Array} 棋盘棋子
 */
function boardOf(specs) {
  return specs.map((spec) => {
    const heroId = Array.isArray(spec) ? spec[0] : spec;
    const star = Array.isArray(spec) ? spec[1] : 1;
    const hero = getHero(heroId);
    return { ...hero, star };
  });
}

/**
 * 按 traitId 取统计结果。
 * @param {Array} list computeTraits 的 list
 * @param {number} traitId 羁绊 id
 * @returns {Object} 统计项
 */
function findTrait(list, traitId) {
  const found = list.find((item) => item.traitId === traitId);
  if (!found) throw new Error(`结果中缺少羁绊 ${traitId}`);
  return found;
}

describe('computeTraits 基本统计', () => {
  test('空棋盘：所有羁绊 0 人、未激活、下一档就是第一档', () => {
    const result = computeTraits([], traitLevels, traitMeta);
    expect(result.list).toHaveLength(10);
    expect(result.active).toEqual([]);
    expect(result.activeCount).toBe(0);
    const warrior = findTrait(result.list, 6);
    expect(warrior.heroCount).toBe(0);
    expect(warrior.activeLevel).toBe(0);
    expect(warrior.effect).toBeNull();
    expect(warrior.nextLevel).toBe(2);
    expect(warrior.need).toBe(2);
  });

  test('2 战士激活 2 档（+30 护甲），并提示距离 4 档还差 2 个', () => {
    const result = computeTraits(boardOf([1, 3]), traitLevels, traitMeta);
    const warrior = findTrait(result.list, 6);
    expect(warrior.heroCount).toBe(2);
    expect(warrior.activeLevel).toBe(2);
    expect(warrior.effect).toEqual({ armor: 30 });
    expect(warrior.nextLevel).toBe(4);
    expect(warrior.need).toBe(2);
    expect(warrior.name).toBe('战士');
    expect(warrior.heroIds.sort()).toEqual(['1', '3']);
  });

  test('4 战士吃满档（+70 护甲），满档时 nextLevel / need 为 null', () => {
    const result = computeTraits(boardOf([1, 3, 7, 9]), traitLevels, traitMeta);
    const warrior = findTrait(result.list, 6);
    expect(warrior.heroCount).toBe(4);
    expect(warrior.activeLevel).toBe(4); // 取最高档，不叠加 2 档
    expect(warrior.effect).toEqual({ armor: 70 });
    expect(warrior.nextLevel).toBeNull();
    expect(warrior.need).toBeNull();
  });

  test('★ 同名英雄只计 1 次（1 星 + 2 星同名棋子仍算 1 个不同英雄）', () => {
    const result = computeTraits(boardOf([[1, 1], [1, 2], [1, 3]]), traitLevels, traitMeta);
    const warrior = findTrait(result.list, 6);
    expect(warrior.heroCount).toBe(1);
    expect(warrior.activeLevel).toBe(0); // 1 < 2，未激活
    expect(warrior.need).toBe(1);
  });

  test('一个棋子可以同时贡献种族与职业两个羁绊', () => {
    const result = computeTraits(boardOf([1]), traitLevels, traitMeta);
    expect(findTrait(result.list, 1).heroCount).toBe(1); // 人类
    expect(findTrait(result.list, 6).heroCount).toBe(1); // 战士
    expect(result.activeCount).toBe(0);
  });

  test('3 龙族取 3 档档位（档位数不一定等距，取已满足的最高 required_count）', () => {
    const custom = [
      { traitId: 5, requiredCount: 2, effect: { skill_power: 30 } },
      { traitId: 5, requiredCount: 3, effect: { skill_power: 80 } },
    ];
    const twoDragons = computeTraits(boardOf([8, 9]), custom, traitMeta);
    expect(findTrait(twoDragons.list, 5).activeLevel).toBe(2);
    expect(findTrait(twoDragons.list, 5).need).toBe(1);

    const threeDragons = computeTraits(
      [...boardOf([8, 9]), { ...getHero(8), heroId: 88, star: 1 }],
      custom,
      traitMeta,
    );
    const dragon = findTrait(threeDragons.list, 5);
    expect(dragon.heroCount).toBe(3);
    expect(dragon.activeLevel).toBe(3);
    expect(dragon.effect).toEqual({ skill_power: 80 });
  });

  test('未达到任何档位时 effect 为 null（前端据此显示灰色）', () => {
    const result = computeTraits(boardOf([2]), traitLevels, traitMeta);
    const elf = findTrait(result.list, 2);
    expect(elf.heroCount).toBe(1);
    expect(elf.activeLevel).toBe(0);
    expect(elf.effect).toBeNull();
    expect(elf.nextLevel).toBe(2);
  });

  test('active 只包含已激活羁绊，activeCount 与长度一致', () => {
    // 1、3、7、9 都是战士（4 人 → 战士激活）；3、7 同时是野兽（2 人 → 野兽激活）
    const result = computeTraits(boardOf([1, 3, 7, 9, 2]), traitLevels, traitMeta);
    expect(result.activeCount).toBe(2);
    expect(result.active).toHaveLength(2);
    expect(result.active.map((item) => item.traitId).sort()).toEqual([3, 6]);
    expect(result.list.length).toBeGreaterThan(result.active.length);
  });

  test('排序：激活档位高优先，其次英雄数多优先', () => {
    const result = computeTraits(boardOf([1, 3, 7, 9, 2, 4]), traitLevels, traitMeta);
    expect(result.list[0].traitId).toBe(6); // 4 战士
    expect(result.list[0].activeLevel).toBe(4);
    // 其余未激活项中，2 人的应排在 1 人的前面
    const inactive = result.list.filter((item) => item.activeLevel === 0);
    for (let i = 1; i < inactive.length; i += 1) {
      expect(inactive[i - 1].heroCount).toBeGreaterThanOrEqual(inactive[i].heroCount);
    }
  });
});

describe('computeTraits 配置兜底与校验', () => {
  test('棋子身上有但配置表缺失的羁绊也会列出（configured=false）', () => {
    const board = [{ heroId: 1, star: 1, traitIds: [99] }];
    const result = computeTraits(board, traitLevels, traitMeta);
    const unknown = findTrait(result.list, 99);
    expect(unknown.configured).toBe(false);
    expect(unknown.heroCount).toBe(1);
    expect(unknown.activeLevel).toBe(0);
    expect(unknown.nextLevel).toBeNull();
    expect(unknown.need).toBeNull();
  });

  test('没有任何羁绊的棋子被单独收集，便于后台发现配置漏填', () => {
    const result = computeTraits([{ heroId: 77, star: 1, traitIds: [] }], traitLevels, traitMeta);
    expect(result.heroesWithoutTrait).toHaveLength(1);
    expect(result.activeCount).toBe(0);
  });

  test('同一个英雄重复写同一个羁绊 id 不会重复计数', () => {
    const board = [{ heroId: 1, star: 1, traitIds: [6, 6] }];
    expect(computeTraits(board, traitLevels, traitMeta).byTraitId[6].heroCount).toBe(1);
  });

  test('byTraitId 可直接 O(1) 查表', () => {
    const result = computeTraits(boardOf([1, 3]), traitLevels, traitMeta);
    expect(result.byTraitId[6].activeLevel).toBe(2);
    expect(result.byTraitId[6].effect).toEqual({ armor: 30 });
  });

  test('重复档位配置（违反 uk_trait_required）抛错', () => {
    const bad = [
      { traitId: 6, requiredCount: 2, effect: { armor: 30 } },
      { traitId: 6, requiredCount: 2, effect: { armor: 999 } },
    ];
    expect(() => computeTraits(boardOf([1]), bad, traitMeta)).toThrow(RangeError);
  });

  test('入参结构非法时抛错（缺 heroId / traitIds 非数组 / board 非数组）', () => {
    expect(() => computeTraits('board', traitLevels)).toThrow(TypeError);
    expect(() => computeTraits([{ star: 1, traitIds: [1] }], traitLevels)).toThrow(TypeError);
    expect(() => computeTraits([{ heroId: 1, traitIds: 6 }], traitLevels)).toThrow(TypeError);
    expect(() => computeTraits([], [{ traitId: 6, requiredCount: 0 }])).toThrow(RangeError);
  });
});

describe('collectActiveEffects / collectTraitHeroes', () => {
  test('只收集已激活羁绊的生效加成，供 stats.js 结算属性', () => {
    const result = computeTraits(boardOf([1, 3, 2]), traitLevels, traitMeta);
    const effects = collectActiveEffects(result.list);
    expect(effects.has(6)).toBe(true);
    expect(effects.get(6)).toEqual({ traitId: 6, activeLevel: 2, effect: { armor: 30 } });
    expect(effects.has(2)).toBe(false); // 精灵只有 1 人，未激活
  });

  test('collectTraitHeroes 对同名英雄去重', () => {
    const { traitHeroes } = collectTraitHeroes(boardOf([[1, 1], [1, 2], [3, 1]]));
    expect(traitHeroes.get(6).size).toBe(2); // 英雄 1 与英雄 3
    expect([...traitHeroes.get(6)]).toEqual(['1', '3']);
  });
});
