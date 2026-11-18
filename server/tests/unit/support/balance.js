'use strict';

/**
 * tests/unit/support/balance.js —— 单测专用数值夹具
 * =============================================================================
 * 这些数字**只用于测试**，与 database/seed.sql 保持同一份口径，
 * 目的是让单测能断言「配置=多少，结果=多少」，而不是把数字硬编码进引擎。
 * 生产环境的配置来自 config/balance.loader.js（读 game_config 等表）。
 * =============================================================================
 */

/** 经济配置：对应 game_config 的 economy 组 */
const economyConfig = {
  baseIncome: 5,
  interestGoldStep: 10,
  interestPerStep: 1,
  interestCap: 5,
  maxGold: 999,
  streakBonusRules: [
    { minStreak: 2, bonus: 1 },
    { minStreak: 4, bonus: 2 },
    { minStreak: 6, bonus: 3 },
  ],
  sellRefundRule: { 1: 1, 2: 3, 3: 9 },
};

/** 战斗属性配置：对应 game_config 的 combat 组 */
const statsConfig = {
  starHpMultiplier: 1.8,
  starAttackMultiplier: 1.8,
  maxStar: 3,
};

/** 伤害配置：对应 game_config 的 combat 组 */
const damageConfig = {
  baseRoundDamage: 3,
  damagePerSurvivor: 1,
};

/** 积分配置：对应 game_config 的 rank 组 */
const scoreConfig = {
  rankScoreMap: { 1: 30, 2: 20, 3: 12, 4: 6, 5: -4, 6: -8, 7: -12, 8: -16 },
  scoreFloor: 0,
};

/** 商店刷新概率：对应 shop_odds_config 的 9 个等级 × 5 档 */
const oddsByLevel = {
  1: { 1: 1.0, 2: 0, 3: 0, 4: 0, 5: 0 },
  2: { 1: 1.0, 2: 0, 3: 0, 4: 0, 5: 0 },
  3: { 1: 0.75, 2: 0.25, 3: 0, 4: 0, 5: 0 },
  4: { 1: 0.55, 2: 0.3, 3: 0.15, 4: 0, 5: 0 },
  5: { 1: 0.45, 2: 0.3, 3: 0.2, 4: 0.05, 5: 0 },
  6: { 1: 0.3, 2: 0.3, 3: 0.25, 4: 0.15, 5: 0 },
  7: { 1: 0.19, 2: 0.3, 3: 0.28, 4: 0.2, 5: 0.03 },
  8: { 1: 0.15, 2: 0.2, 3: 0.28, 4: 0.28, 5: 0.09 },
  9: { 1: 0.1, 2: 0.15, 3: 0.25, 4: 0.3, 5: 0.2 },
};

/** 卡池容量：对应 card_pool_config.pool_size（每种英雄的单局张数） */
const poolSizeByCost = { 1: 29, 2: 22, 3: 18, 4: 12, 5: 10 };

/** 示例英雄：对应 seed.sql 的 10 个英雄（字段名已转为驼峰，附加 traitIds） */
const heroes = [
  {
    heroId: 1, heroKey: 'squire', name: '见习剑士', cost: 1,
    baseHp: 650, baseAttack: 45, attackSpeed: 0.7, armor: 30, magicResist: 20,
    attackRange: 1, skillPower: 100, skillMana: 100, traitIds: [1, 6],
  },
  {
    heroId: 2, heroKey: 'forest_archer', name: '森林射手', cost: 1,
    baseHp: 500, baseAttack: 55, attackSpeed: 0.75, armor: 15, magicResist: 20,
    attackRange: 3, skillPower: 90, skillMana: 100, traitIds: [2, 8],
  },
  {
    heroId: 3, heroKey: 'stone_guard', name: '磐石守卫', cost: 2,
    baseHp: 800, baseAttack: 50, attackSpeed: 0.6, armor: 40, magicResist: 25,
    attackRange: 1, skillPower: 150, skillMana: 100, traitIds: [3, 6],
  },
  {
    heroId: 4, heroKey: 'shadow_blade', name: '暗影刺客', cost: 2,
    baseHp: 550, baseAttack: 70, attackSpeed: 0.85, armor: 20, magicResist: 20,
    attackRange: 1, skillPower: 180, skillMana: 100, traitIds: [4, 9],
  },
  {
    heroId: 5, heroKey: 'element_mage', name: '元素法师', cost: 3,
    baseHp: 550, baseAttack: 55, attackSpeed: 0.65, armor: 15, magicResist: 30,
    attackRange: 3, skillPower: 250, skillMana: 100, traitIds: [2, 7],
  },
  {
    heroId: 6, heroKey: 'light_priest', name: '圣光牧师', cost: 3,
    baseHp: 600, baseAttack: 45, attackSpeed: 0.65, armor: 20, magicResist: 35,
    attackRange: 2, skillPower: 200, skillMana: 100, traitIds: [1, 10],
  },
  {
    heroId: 7, heroKey: 'berserker', name: '狂战士', cost: 4,
    baseHp: 900, baseAttack: 85, attackSpeed: 0.75, armor: 35, magicResist: 20,
    attackRange: 1, skillPower: 220, skillMana: 100, traitIds: [3, 6],
  },
  {
    heroId: 8, heroKey: 'dragon_mage', name: '龙裔术士', cost: 4,
    baseHp: 650, baseAttack: 70, attackSpeed: 0.7, armor: 20, magicResist: 40,
    attackRange: 3, skillPower: 160, skillMana: 100, traitIds: [5, 7],
  },
  {
    heroId: 9, heroKey: 'ancient_dragon', name: '远古巨龙', cost: 5,
    baseHp: 1200, baseAttack: 100, attackSpeed: 0.65, armor: 50, magicResist: 50,
    attackRange: 2, skillPower: 350, skillMana: 100, traitIds: [5, 6],
  },
  {
    heroId: 10, heroKey: 'death_lord', name: '死亡领主', cost: 5,
    baseHp: 1000, baseAttack: 95, attackSpeed: 0.7, armor: 40, magicResist: 45,
    attackRange: 2, skillPower: 400, skillMana: 100, traitIds: [4, 7],
  },
];

/** 羁绊定义：对应 trait 表 */
const traitMeta = {
  1: { traitId: 1, name: '人类', type: 1, sortNo: 1 },
  2: { traitId: 2, name: '精灵', type: 1, sortNo: 2 },
  3: { traitId: 3, name: '野兽', type: 1, sortNo: 3 },
  4: { traitId: 4, name: '亡灵', type: 1, sortNo: 4 },
  5: { traitId: 5, name: '龙族', type: 1, sortNo: 5 },
  6: { traitId: 6, name: '战士', type: 2, sortNo: 6 },
  7: { traitId: 7, name: '法师', type: 2, sortNo: 7 },
  8: { traitId: 8, name: '游侠', type: 2, sortNo: 8 },
  9: { traitId: 9, name: '刺客', type: 2, sortNo: 9 },
  10: { traitId: 10, name: '牧师', type: 2, sortNo: 10 },
};

/** 羁绊档位：对应 trait_level 表（requiredCount + effect） */
const traitLevels = [
  { traitId: 1, requiredCount: 2, effect: { mana_per_attack: 5 } },
  { traitId: 1, requiredCount: 4, effect: { mana_per_attack: 10 } },
  { traitId: 2, requiredCount: 2, effect: { dodge: 0.15 } },
  { traitId: 2, requiredCount: 4, effect: { dodge: 0.15, attack_speed: 0.2 } },
  { traitId: 3, requiredCount: 2, effect: { attack: 15 } },
  { traitId: 3, requiredCount: 4, effect: { attack: 40 } },
  { traitId: 4, requiredCount: 2, effect: { enemy_armor_reduce: 20 } },
  { traitId: 4, requiredCount: 4, effect: { enemy_armor_reduce: 50 } },
  { traitId: 5, requiredCount: 2, effect: { skill_power: 30 } },
  { traitId: 5, requiredCount: 3, effect: { skill_power: 80 } },
  { traitId: 6, requiredCount: 2, effect: { armor: 30 } },
  { traitId: 6, requiredCount: 4, effect: { armor: 70 } },
  { traitId: 7, requiredCount: 2, effect: { skill_power: 25 } },
  { traitId: 7, requiredCount: 4, effect: { skill_power: 70 } },
  { traitId: 8, requiredCount: 2, effect: { attack_speed: 0.15 } },
  { traitId: 8, requiredCount: 4, effect: { attack_speed: 0.4 } },
  { traitId: 9, requiredCount: 2, effect: { crit_rate: 0.2 } },
  { traitId: 9, requiredCount: 4, effect: { crit_rate: 0.45 } },
  { traitId: 10, requiredCount: 2, effect: { heal: 40 } },
  { traitId: 10, requiredCount: 4, effect: { heal: 100 } },
];

/**
 * 生成一份「满池」卡池（未发生任何购买）的副本，避免用例之间互相污染。
 * @returns {Array<{heroId:number, cost:number, remaining:number}>} 卡池
 */
function createFullPool() {
  return heroes.map((hero) => ({
    heroId: hero.heroId,
    cost: hero.cost,
    remaining: poolSizeByCost[hero.cost],
  }));
}

/**
 * 按 heroId 取英雄白板数据（测试里高频使用）。
 * @param {number} heroId 英雄 id
 * @returns {Object} 英雄定义
 */
function getHero(heroId) {
  const hero = heroes.find((item) => item.heroId === heroId);
  if (!hero) throw new Error(`测试夹具中不存在英雄 ${heroId}`);
  return { ...hero };
}

module.exports = {
  economyConfig,
  statsConfig,
  damageConfig,
  scoreConfig,
  oddsByLevel,
  poolSizeByCost,
  heroes,
  traitMeta,
  traitLevels,
  createFullPool,
  getHero,
};
