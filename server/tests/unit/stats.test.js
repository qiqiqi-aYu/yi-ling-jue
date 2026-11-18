'use strict';

/**
 * tests/unit/stats.test.js —— 英雄最终战斗属性
 * 重点：星级指数成长、羁绊加成只作用于拥有该羁绊的棋子、加法/乘法通道、
 *      概率型加成夹取、亡灵光环作用于敌方、不修改入参。
 */

const {
  applyStar,
  parseEffect,
  resolveUnitStats,
  resolveTeamStats,
  applyEnemyAura,
  resolveBattleStats,
} = require('../../src/engine/stats');
const { computeTraits, collectActiveEffects } = require('../../src/engine/synergy');
const { statsConfig, traitLevels, traitMeta, getHero } = require('./support/balance');

/** 组装棋盘棋子 */
function boardOf(specs) {
  return specs.map((spec) => {
    const heroId = Array.isArray(spec) ? spec[0] : spec;
    const star = Array.isArray(spec) ? spec[1] : 1;
    return { ...getHero(heroId), star };
  });
}

/** 走「羁绊统计 → 生效加成」链路，拿到 stats 需要的 Map */
function effectsOf(specs, levels = traitLevels) {
  return collectActiveEffects(computeTraits(boardOf(specs), levels, traitMeta).list);
}

describe('applyStar 星级加成', () => {
  test('1.8 倍率下 1/2/3 星生命与攻击（向下取整）', () => {
    const hero = getHero(1); // 650 血 / 45 攻
    expect(applyStar(hero, 1, statsConfig)).toMatchObject({ hp: 650, attack: 45, star: 1 });
    expect(applyStar(hero, 2, statsConfig)).toMatchObject({ hp: 1170, attack: 81, star: 2 });
    // 650 × 1.8² = 2106；45 × 1.8² = 145.8 → 145
    expect(applyStar(hero, 3, statsConfig)).toMatchObject({ hp: 2106, attack: 145, star: 3 });
  });

  test('护甲 / 魔抗 / 攻速 / 射程不随星级变化（本项目规则）', () => {
    const hero = getHero(1);
    const threeStar = applyStar(hero, 3, statsConfig);
    expect(threeStar.armor).toBe(hero.armor);
    expect(threeStar.magicResist).toBe(hero.magicResist);
    expect(threeStar.attackSpeed).toBe(hero.attackSpeed);
    expect(threeStar.attackRange).toBe(hero.attackRange);
  });

  test('不修改入参（引擎全程不可变，避免快照被悄悄改掉）', () => {
    const hero = getHero(1);
    applyStar(hero, 3, statsConfig);
    expect(hero.star).toBeUndefined();
    expect(hero.baseHp).toBe(650);
  });

  test('星级越界 / 缺倍率配置抛错', () => {
    const hero = getHero(1);
    expect(() => applyStar(hero, 0, statsConfig)).toThrow(RangeError);
    expect(() => applyStar(hero, 4, statsConfig)).toThrow(RangeError); // maxStar = 3
    expect(() => applyStar(hero, 1, {})).toThrow(TypeError);
    expect(() => applyStar({ baseHp: 650 }, 1, statsConfig)).toThrow(TypeError);
  });
});

describe('parseEffect 加成解析', () => {
  test('加法通道与光环通道分类正确', () => {
    const parsed = parseEffect({ armor: 30, attack: 15, skill_power: 25, magic_resist: 10 });
    expect(parsed.flat).toEqual({ armor: 30, attack: 15, skillPower: 25, magicResist: 10 });
    expect(parsed.aura).toEqual({});

    const aura = parseEffect({ enemy_armor_reduce: 20 });
    expect(aura.aura).toEqual({ enemyArmorReduce: 20 });
    expect(aura.flat).toEqual({});
  });

  test('百分比通道与概率通道分类正确，snake_case / camelCase 都可累加', () => {
    const parsed = parseEffect({ attack_speed: 0.1, attackSpeed: 0.1, dodge: 0.15, crit_rate: 0.2 });
    expect(parsed.ratio.attackSpeed).toBeCloseTo(0.2, 10);
    expect(parsed.chance).toEqual({ dodge: 0.15, critRate: 0.2 });
  });

  test('★ 未知加成键直接抛错（防止后台敲错 key 导致加成静默失效）', () => {
    expect(() => parseEffect({ armour: 30 })).toThrow(RangeError);
    expect(() => parseEffect({ armor: '30' })).toThrow(TypeError);
  });
});

describe('resolveUnitStats 单体属性结算', () => {
  test('2 战士激活后，战士棋子 +30 护甲；非战士不吃该加成', () => {
    // 棋盘：见习剑士(1) + 磐石守卫(3) → 战士 2 人激活；森林射手(2) 是精灵/游侠
    const effects = effectsOf([[1, 2], 3, 2]);
    const squire = resolveUnitStats({ ...getHero(1), star: 2 }, effects, statsConfig);
    const archer = resolveUnitStats({ ...getHero(2), star: 1 }, effects, statsConfig);

    expect(squire.armor).toBe(60); // 30 + 30
    expect(squire.attack).toBe(81); // 2 星 45 × 1.8
    expect(squire.hp).toBe(1170);
    expect(squire.appliedTraitIds).toEqual([6]);

    expect(archer.armor).toBe(15); // 未获得战士加成
    expect(archer.appliedTraitIds).toEqual([]);
  });

  test('未激活的羁绊不产生加成（1 个战士吃不到 2 档加成）', () => {
    const effects = effectsOf([1, 2]); // 战士只有 1 人
    const squire = resolveUnitStats({ ...getHero(1), star: 1 }, effects, statsConfig);
    expect(squire.armor).toBe(30);
    expect(squire.appliedTraitIds).toEqual([]);
  });

  test('4 战士吃满档 +70 护甲', () => {
    const effects = effectsOf([1, 3, 7, 9]);
    const squire = resolveUnitStats({ ...getHero(1), star: 1 }, effects, statsConfig);
    expect(squire.armor).toBe(100); // 30 + 70
  });

  test('攻速走乘法通道：+20% 攻速 → ×1.2', () => {
    const custom = [{ traitId: 2, requiredCount: 2, effect: { dodge: 0.15, attack_speed: 0.2 } }];
    const effects = collectActiveEffects(
      computeTraits(boardOf([2, 5]), custom, traitMeta).list,
    );
    const archer = resolveUnitStats({ ...getHero(2), star: 1 }, effects, statsConfig);
    expect(archer.attackSpeed).toBeCloseTo(0.9, 6); // 0.75 × 1.2
    expect(archer.dodge).toBeCloseTo(0.15, 6);
  });

  test('概率型加成夹在 [0,1]', () => {
    const custom = [{ traitId: 2, requiredCount: 2, effect: { dodge: 1.2, crit_rate: 2 } }];
    const effects = collectActiveEffects(
      computeTraits(boardOf([2, 5]), custom, traitMeta).list,
    );
    const archer = resolveUnitStats({ ...getHero(2), star: 1 }, effects, statsConfig);
    expect(archer.dodge).toBe(1);
    expect(archer.critRate).toBe(1);
  });

  test('多个羁绊加成可叠加（战士护甲 + 人类法力回复）', () => {
    // 2 人类（1、6 圣光牧师）+ 2 战士（1、3）
    const effects = effectsOf([1, 6, 3]);
    const squire = resolveUnitStats({ ...getHero(1), star: 1 }, effects, statsConfig);
    expect(squire.armor).toBe(60); // 战士 2 档 +30
    expect(squire.manaPerAttack).toBe(5); // 人类 2 档 +5
    expect(squire.appliedTraitIds.sort()).toEqual([1, 6]);
  });

  test('不修改入参棋子', () => {
    const unit = { ...getHero(1), star: 1 };
    resolveUnitStats(unit, effectsOf([1, 3]), statsConfig);
    expect(unit.armor).toBe(30);
    expect(unit.star).toBe(1);
  });
});

describe('resolveTeamStats / 光环', () => {
  test('亡灵 2 档产生「敌方 -20 护甲」的光环', () => {
    const { aura, units } = resolveTeamStats(boardOf([4, 10]), effectsOf([4, 10]), statsConfig);
    expect(aura.enemyArmorReduce).toBe(20);
    expect(units).toHaveLength(2);
    // 光环不作用于自己人
    expect(units.find((unit) => unit.heroId === 4).armor).toBe(20);
  });

  test('applyEnemyAura 把护甲减到 0 为止，不出现负数', () => {
    const units = [{ heroId: 2, armor: 15 }, { heroId: 1, armor: 30 }];
    const after = applyEnemyAura(units, { enemyArmorReduce: 20 });
    expect(after[0].armor).toBe(0); // 15 - 20 → 0
    expect(after[1].armor).toBe(10);
    expect(units[0].armor).toBe(15); // 未修改入参
  });

  test('★ 双方光环互相作用：我方亡灵减对手护甲，对手光环减我方护甲', () => {
    const humanUnits = boardOf([4, 10]); // 亡灵 2 → -20 护甲
    const opponentUnits = boardOf([1, 2]); // 无亡灵光环

    const result = resolveBattleStats({
      humanUnits,
      opponentUnits,
      humanEffects: effectsOf([4, 10]),
      opponentEffects: effectsOf([1, 2]),
      config: statsConfig,
    });

    expect(result.humanAura.enemyArmorReduce).toBe(20);
    expect(result.opponentAura.enemyArmorReduce).toBe(0);
    // 对手见习剑士 30 护甲被削到 10
    expect(result.opponent.find((unit) => unit.heroId === 1).armor).toBe(10);
    // 我方棋子不受自己光环影响
    expect(result.human.find((unit) => unit.heroId === 4).armor).toBe(20);
  });

  test('入参非法抛错', () => {
    expect(() => resolveTeamStats('units', new Map(), statsConfig)).toThrow(TypeError);
    expect(() => applyEnemyAura('units', {})).toThrow(TypeError);
    expect(() => resolveBattleStats(null)).toThrow(TypeError);
  });
});

/**
 * 弈灵诀主词表（设计说明书 §7.3）：
 * 百分比一律用「整数百分数」落库（12 = 12%），由本模块统一 /100，
 * 这条约定必须有单测锁死，否则最容易出现「12 倍」事故。
 */
describe('弈灵诀词表：整数百分数换算', () => {
  test('atkPercent / hpPercent / critRate / critDmgPercent 全部 /100', () => {
    const parsed = parseEffect({ atkPercent: 12, hpPercent: 50, critRate: 40, critDmgPercent: 20 });
    expect(parsed.ratio.attackPercent).toBeCloseTo(0.12, 10);
    expect(parsed.ratio.hpPercent).toBeCloseTo(0.5, 10);
    expect(parsed.chance.critRate).toBeCloseTo(0.4, 10);
    expect(parsed.ratio.critDamagePercent).toBeCloseTo(0.2, 10);
  });

  test('★ 12 表示 12%，不是 12 倍：2 星英雄攻击只放大 1.12 倍', () => {
    const effects = new Map([[1, { effect: { atkPercent: 12 } }]]);
    const unit = resolveUnitStats({ ...getHero(1), star: 2, traitIds: [1] }, effects, statsConfig);
    // FLOOR(45 × 1.8) = 81 → ×1.12 = 90.72 → 90
    expect(unit.attack).toBe(90);
    expect(unit.hp).toBe(1170); // 未受 hpPercent 影响
  });

  test('hpPercent 走乘法通道；critRate 夹在 [0,1]', () => {
    const effects = new Map([[2, { effect: { hpPercent: 30, critRate: 200 } }]]);
    const unit = resolveUnitStats({ ...getHero(1), star: 1, traitIds: [2] }, effects, statsConfig);
    expect(unit.hp).toBe(845); // FLOOR(650 × 1.3)
    expect(unit.critRate).toBe(1); // 200% 被夹到 100%
  });

  test('条件触发类（魔族）与阵亡触发类（冥灵）落到 dynamic 字段', () => {
    const effects = new Map([
      [3, { effect: { lowHpDmgPercent: 22, hpThreshold: 0.5 } }],
      [6, { effect: { reviveChance: 0.3, reviveHpPercent: 25 } }],
    ]);
    const unit = resolveUnitStats({ ...getHero(1), star: 1, traitIds: [3, 6] }, effects, statsConfig);
    expect(unit.dynamic).toEqual({
      lowHpDamagePercent: 0.22,
      hpThreshold: 0.5,
      reviveChance: 0.3,
      reviveHpPercent: 0.25,
    });
  });

  test('冷却缩减 / 治疗提升 / 法术吸血 / 技能增伤 / 召唤物强化 均换算为小数', () => {
    const effects = new Map([
      [
        8,
        {
          effect: {
            cdReduce: 25,
            healPercent: 35,
            spellLifesteal: 18,
            skillDmgPercent: 26,
            summonAtkPercent: 32,
            summonHpPercent: 30,
          },
        },
      ],
    ]);
    const unit = resolveUnitStats({ ...getHero(1), star: 1, traitIds: [8] }, effects, statsConfig);
    expect(unit.cdReduce).toBeCloseTo(0.25, 10);
    expect(unit.healPercent).toBeCloseTo(0.35, 10);
    expect(unit.spellLifesteal).toBeCloseTo(0.18, 10);
    expect(unit.skillDmgPercent).toBeCloseTo(0.26, 10);
    expect(unit.summonAttackPercent).toBeCloseTo(0.32, 10);
    expect(unit.summonHpPercent).toBeCloseTo(0.3, 10);
  });

  test('乐伶 allyAsPercent：本方全体攻速提升（不是只给自己）', () => {
    const units = [
      { ...getHero(1), star: 1, traitIds: [] },
      { ...getHero(2), star: 1, traitIds: [] },
    ];
    const effects = new Map([[12, { effect: { allyAsPercent: 22 } }]]);
    const result = resolveTeamStats(units, effects, statsConfig);
    expect(result.teamBuff.allyAttackSpeedPercent).toBeCloseTo(0.22, 10);
    expect(result.units[0].attackSpeed).toBeCloseTo(0.7 * 1.22, 4);
    expect(result.units[1].attackSpeed).toBeCloseTo(0.75 * 1.22, 4);
  });

  test('阵法师 enemyAsSlowPercent：降低对手攻速，且不会降成负数', () => {
    const humanUnits = [{ ...getHero(1), star: 1, traitIds: [] }];
    const result = resolveBattleStats({
      humanUnits,
      opponentUnits: [],
      humanEffects: new Map(),
      opponentEffects: new Map([[11, { effect: { enemyAsSlowPercent: 35 } }]]),
      config: statsConfig,
    });
    expect(result.human[0].attackSpeed).toBeCloseTo(0.7 * 0.65, 4);

    // 减速 200% 也只减到 0
    const clamped = resolveBattleStats({
      humanUnits,
      opponentUnits: [],
      humanEffects: new Map(),
      opponentEffects: new Map([[11, { effect: { enemyAsSlowPercent: 200 } }]]),
      config: statsConfig,
    });
    expect(clamped.human[0].attackSpeed).toBe(0);
  });
});
