'use strict';

/**
 * config/balance.loader.js —— 平衡配置加载器（DB → engine 的唯一边界）
 * =============================================================================
 * 职责边界（课设答辩最常被问的一层）：
 *   MySQL 配置表  →  balance.loader（本文件）  →  engine 纯函数内核
 *   本文件只做三件事：① 查表 ② 字段改名 + 类型规范化（DB snake_case → 驼峰）
 *   ③ 一致性校验（概率和=1、引用完整性、卡池可均分）。
 *   **不做任何数值计算**，数值逻辑全在 engine/ 里，避免两处口径不一致。
 *
 * 加载的表（与设计说明书 §2.2 配置类一一对应）：
 *   trait            羁绊定义（1-6 种族 / 7-12 职业）
 *   trait_level      羁绊档位 effect_json（整数百分数，engine 解析时 /100）
 *   hero             英雄白板属性
 *   hero_trait       英雄-羁绊多对多
 *   card_pool_config 各费用卡池总量
 *   level_config     升级经验 / 人口上限 / 刷新费用
 *   shop_odds_config 各等级 5 档费用概率
 *   game_config      全局参数（经济 / 战斗 / 积分）
 *
 * 输出（BalanceSnapshot）：
 *   snapshot.engine.economyConfig  → economy.calcRoundIncome(...)
 *   snapshot.engine.statsConfig    → stats.applyStar(...)
 *   snapshot.engine.damageConfig   → damage.calcBattleDamage(...)
 *   snapshot.engine.scoreConfig    → damage.calcScoreDelta(...)
 *   snapshot.engine.traitLevels    → synergy.computeTraits(board, traitLevels, traitMeta)
 *   snapshot.engine.oddsByLevel    → probability.weightedPick(odds, cards, rng)
 *   snapshot.engine.heroes         → stats.resolveUnitStats(hero, effects, config)
 *   以及 createMatchCardPool(snapshot) 生成单局卡池 [{heroId, cost, remaining}]
 *
 * 用法（service 层）：
 *   const balance = await loadBalance();                 // 默认 60s 缓存
 *   const odds = balance.odds.byLevel[player.level];
 *   const cards = createMatchCardPool(balance);
 * =============================================================================
 */

const crypto = require('crypto');
const { validateOdds } = require('../engine/probability');

/** 需要读取的配置表及 SQL（顺序即依赖顺序） */
const BALANCE_QUERIES = {
  traits:
    'SELECT id, trait_key, name, type, description FROM trait ORDER BY id',
  traitLevels:
    'SELECT id, trait_id, required_count, effect_json FROM trait_level ORDER BY trait_id, required_count',
  heroes:
    'SELECT id, hero_key, name, cost, base_hp, base_attack, attack_speed, skill_desc, enabled FROM hero ORDER BY id',
  heroTraits:
    'SELECT hero_id, trait_id FROM hero_trait ORDER BY hero_id, trait_id',
  cardPool:
    'SELECT cost, pool_size FROM card_pool_config ORDER BY cost',
  levels:
    'SELECT level, exp_to_next, max_board_slots, refresh_cost FROM level_config ORDER BY level',
  shopOdds:
    'SELECT level, cost, probability FROM shop_odds_config ORDER BY level, cost',
  gameConfig:
    'SELECT config_key, config_value, group_name FROM game_config ORDER BY config_key',
};

/**
 * game_config 键 → 驼峰字段的映射表。
 * 因为 game_config 的 config_value 是字符串（没有 value_type 列），
 * 类型只能在这里声明；缺失 required 键会直接抛错，避免引擎拿到 undefined 静默算错。
 */
const GAME_CONFIG_SPEC = {
  // ---- 经济（engine/economy.js）----
  base_income: { field: 'baseIncome', type: 'int', required: true, group: 'economy' },
  interest_gold_step: { field: 'interestGoldStep', type: 'int', required: true, group: 'economy' },
  interest_per_step: { field: 'interestPerStep', type: 'int', required: true, group: 'economy' },
  interest_cap: { field: 'interestCap', type: 'int', required: true, group: 'economy' },
  max_gold: { field: 'maxGold', type: 'int', required: true, group: 'economy' },
  streak_bonus_rules: { field: 'streakBonusRules', type: 'json', required: true, group: 'economy' },
  sell_refund_rule: { field: 'sellRefundRule', type: 'json', required: true, group: 'economy' },
  initial_hp: { field: 'initialHp', type: 'int', required: false, group: 'economy' },
  initial_gold: { field: 'initialGold', type: 'int', required: false, group: 'economy' },
  // ---- 战斗（engine/stats.js、engine/damage.js）----
  star_hp_multiplier: { field: 'starHpMultiplier', type: 'decimal', required: true, group: 'combat' },
  star_attack_multiplier: { field: 'starAttackMultiplier', type: 'decimal', required: true, group: 'combat' },
  max_star: { field: 'maxStar', type: 'int', required: true, group: 'combat' },
  base_round_damage: { field: 'baseRoundDamage', type: 'int', required: true, group: 'combat' },
  damage_per_survivor: { field: 'damagePerSurvivor', type: 'int', required: true, group: 'combat' },
  max_round: { field: 'maxRound', type: 'int', required: false, group: 'combat' },
  board_rows: { field: 'boardRows', type: 'int', required: false, group: 'combat' },
  board_cols: { field: 'boardCols', type: 'int', required: false, group: 'combat' },
  shop_size: { field: 'shopSize', type: 'int', required: false, group: 'combat' },
  bench_size: { field: 'benchSize', type: 'int', required: false, group: 'combat' },
  battle_max_seconds: { field: 'battleMaxSeconds', type: 'int', required: false, group: 'battle' },
  // ---- 积分（engine/damage.js）----
  rank_score_map: { field: 'rankScoreMap', type: 'json', required: true, group: 'rank' },
  score_floor: { field: 'scoreFloor', type: 'int', required: true, group: 'rank' },
  // ---- 系统 ----
  idempotency_ttl_seconds: { field: 'idempotencyTtlSeconds', type: 'int', required: false, group: 'system' },
};

/** 概率和校验容差：DECIMAL(6,4) 转浮点后求和允许的误差 */
const ODDS_EPSILON = 1e-6;

/**
 * 把可能为字符串的数值列转成数字（mysql2 对 DECIMAL/BIGINT 默认返回字符串）。
 * @param {*} value 原始值
 * @param {string} field 字段名（报错提示用）
 * @returns {number} 数值
 * @throws {TypeError} 无法转换
 */
function toNumber(value, field) {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError(`balance: ${field} 不是有限数值（${value}）`);
    return value;
  }
  if (typeof value === 'string' && value.trim() !== '') {
    const num = Number(value);
    if (!Number.isFinite(num)) throw new TypeError(`balance: ${field} 无法转为数值（${value}）`);
    return num;
  }
  throw new TypeError(`balance: ${field} 缺失或类型非法（${value}）`);
}

/**
 * 把数值列转成整数，并做范围校验。
 * @param {*} value 原始值
 * @param {string} field 字段名
 * @param {{min?:number, max?:number}} [range] 取值范围
 * @returns {number} 整数
 */
function toInt(value, field, range = {}) {
  const num = toNumber(value, field);
  if (!Number.isInteger(num)) throw new TypeError(`balance: ${field} 必须是整数（${value}）`);
  if (range.min !== undefined && num < range.min) {
    throw new RangeError(`balance: ${field} 不能小于 ${range.min}（${num}）`);
  }
  if (range.max !== undefined && num > range.max) {
    throw new RangeError(`balance: ${field} 不能大于 ${range.max}（${num}）`);
  }
  return num;
}

/**
 * 解析 JSON 列：mysql2 对 JSON 类型通常已返回对象，这里兼容返回字符串的情况。
 * @param {*} value 原始值
 * @param {string} field 字段名
 * @returns {Object} 解析结果
 */
function parseJson(value, field) {
  if (value === null || value === undefined) {
    throw new TypeError(`balance: ${field} 不能为空`);
  }
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(String(value));
  } catch (err) {
    throw new TypeError(`balance: ${field} 不是合法 JSON（${value}）`);
  }
}

/**
 * 把 game_config 行按 GAME_CONFIG_SPEC 转成驼峰配置对象。
 * @param {Array<{config_key:string, config_value:string}>} rows game_config 行
 * @param {string[]} warnings 警告收集器
 * @returns {Object} 驼峰配置（含分组字段）
 */
function buildGameConfig(rows, warnings) {
  const raw = {};
  for (const row of rows || []) {
    raw[row.config_key] = row.config_value;
  }

  const config = {};
  const missing = [];

  for (const [key, spec] of Object.entries(GAME_CONFIG_SPEC)) {
    const value = raw[key];
    if (value === undefined || value === null || value === '') {
      if (spec.required) missing.push(key);
      continue;
    }
    if (spec.type === 'json') {
      config[spec.field] = parseJson(value, `game_config.${key}`);
    } else if (spec.type === 'decimal') {
      config[spec.field] = toNumber(value, `game_config.${key}`);
    } else {
      config[spec.field] = toInt(value, `game_config.${key}`);
    }
  }

  if (missing.length > 0) {
    throw new Error(
      `balance: game_config 缺少必需参数 ${missing.join(', ')}；` +
        '请执行 database/seed.sql 或到后台补齐后再启动',
    );
  }

  // 未在 SPEC 中登记的键仍然保留，方便后台新增参数而无需改代码
  const unknownKeys = Object.keys(raw).filter((key) => !GAME_CONFIG_SPEC[key]);
  if (unknownKeys.length > 0) {
    warnings.push(`game_config 存在未登记的键：${unknownKeys.join(', ')}（已保留原始值，未参与解析）`);
  }
  config.raw = raw;
  return config;
}

/**
 * 计算「每个英雄」的卡池张数。
 *
 * card_pool_config.pool_size 是**该费用卡池总量**，按该费用已启用英雄数均分；
 * 除不尽时余数按 heroId 升序逐个 +1（余数最多等于英雄数-1），
 * 并记入 warnings，提示后台把总量调成能整除的值。
 *
 * @param {Array} heroes 英雄列表（已含 cost / enabled）
 * @param {Array<{cost:number, poolSize:number}>} poolRows 卡池配置
 * @param {string[]} warnings 警告收集器
 * @returns {{byCost: Map<number, number>, perHero: Map<number, number>, total: number, unevenCosts:number[]}}
 */
function buildCardPool(heroes, poolRows, warnings) {
  const byCost = new Map();
  const perHero = new Map();
  const unevenCosts = [];
  let total = 0;

  for (const row of poolRows || []) {
    const cost = toInt(row.cost, 'card_pool_config.cost', { min: 1, max: 5 });
    const poolSize = toInt(row.pool_size, 'card_pool_config.pool_size', { min: 0 });
    byCost.set(cost, poolSize);
    total += poolSize;
  }

  for (const cost of [1, 2, 3, 4, 5]) {
    const poolSize = byCost.get(cost);
    if (poolSize === undefined) {
      warnings.push(`card_pool_config 缺少 ${cost} 费配置，该费用将无法抽卡`);
      continue;
    }
    const costHeroes = heroes
      .filter((hero) => hero.cost === cost && hero.enabled === 1)
      .sort((a, b) => a.heroId - b.heroId);
    if (costHeroes.length === 0) {
      warnings.push(`card_pool_config 中 ${cost} 费配置了 ${poolSize} 张，但没有任何启用英雄`);
      continue;
    }

    const base = Math.floor(poolSize / costHeroes.length);
    const remainder = poolSize % costHeroes.length;
    if (remainder !== 0) unevenCosts.push(cost);

    costHeroes.forEach((hero, index) => {
      perHero.set(hero.heroId, base + (index < remainder ? 1 : 0));
    });
  }

  if (unevenCosts.length > 0) {
    warnings.push(
      `card_pool_config 以下费用无法被英雄数整除，余数已按 heroId 升序分配：${unevenCosts.join(', ')}`,
    );
  }

  return { byCost, perHero, total, unevenCosts };
}

/**
 * 把 shop_odds_config 行拼成「等级 → {费用: 概率}」。
 * @param {Array} rows shop_odds_config 行
 * @returns {Object<number, Object<number, number>>} 等级 → 费用概率表
 */
function buildOdds(rows) {
  const byLevel = {};
  for (const row of rows || []) {
    const level = toInt(row.level, 'shop_odds_config.level', { min: 1, max: 9 });
    const cost = toInt(row.cost, 'shop_odds_config.cost', { min: 1, max: 5 });
    const probability = toNumber(row.probability, 'shop_odds_config.probability');
    if (!byLevel[level]) byLevel[level] = {};
    byLevel[level][cost] = probability;
  }
  return byLevel;
}

/**
 * 校验整个配置快照，任何一处不合法都直接抛错（宁可不启动，也不要带病运行）。
 * @param {Object} snapshot 配置快照
 * @returns {void}
 * @throws {Error} 校验失败
 */
function validateBalance(snapshot) {
  const errors = [];
  const { traits, traitLevels, heroes, heroTraits, cardPool, odds, levels } = snapshot;

  // 1) 概率和必须严格为 1（对应后台保存配置的拦截点）
  for (const level of Object.keys(odds.byLevel)) {
    const result = validateOdds(odds.byLevel[level], { epsilon: ODDS_EPSILON });
    if (!result.valid) {
      errors.push(`shop_odds_config 等级 ${level} 概率非法：${result.errors.join('；')}`);
    }
  }
  for (const level of levels.list) {
    if (!odds.byLevel[level.level]) {
      errors.push(`shop_odds_config 缺少等级 ${level.level} 的概率配置`);
    }
  }

  // 2) 羁绊定义：类型只能是 1/2，且必须配置档位
  const traitIds = new Set(traits.list.map((trait) => trait.traitId));
  for (const trait of traits.list) {
    if (trait.type !== 1 && trait.type !== 2) {
      errors.push(`trait ${trait.traitKey} 的 type=${trait.type} 非法（只能是 1 种族 / 2 职业）`);
    }
    if (!traitLevels.byTraitId.has(trait.traitId)) {
      errors.push(`trait ${trait.traitKey} 没有任何档位配置（trait_level 缺失）`);
    }
  }

  // 3) 档位：requiredCount 递增且不重复（SQL 有唯一键，这里再兜一层）
  for (const [traitId, tiers] of traitLevels.byTraitId.entries()) {
    if (!traitIds.has(traitId)) {
      errors.push(`trait_level 引用了不存在的羁绊 ${traitId}`);
      continue;
    }
    const seen = new Set();
    for (const tier of tiers) {
      if (seen.has(tier.requiredCount)) {
        errors.push(`羁绊 ${traitId} 存在重复档位 ${tier.requiredCount}`);
      }
      seen.add(tier.requiredCount);
    }
  }

  // 4) 英雄：费用、属性、羁绊引用
  for (const hero of heroes.list) {
    if (hero.cost < 1 || hero.cost > 5) {
      errors.push(`英雄 ${hero.name}(${hero.heroId}) 的 cost=${hero.cost} 超出 1~5`);
    }
    if (hero.baseHp <= 0 || hero.baseAttack <= 0 || hero.attackSpeed <= 0) {
      errors.push(`英雄 ${hero.name}(${hero.heroId}) 基础属性必须为正数`);
    }
    const traitIdsOfHero = heroTraits.get(hero.heroId) || [];
    if (hero.enabled === 1 && traitIdsOfHero.length === 0) {
      errors.push(`英雄 ${hero.name}(${hero.heroId}) 已启用但未绑定任何羁绊`);
    }
    for (const traitId of traitIdsOfHero) {
      if (!traitIds.has(traitId)) {
        errors.push(`英雄 ${hero.name}(${hero.heroId}) 绑定了不存在的羁绊 ${traitId}`);
      }
    }
  }

  // 5) 卡池：每个费用都要有配置，且总量为正
  for (const cost of [1, 2, 3, 4, 5]) {
    if (!cardPool.byCost.has(cost)) errors.push(`card_pool_config 缺少 ${cost} 费配置`);
    else if (cardPool.byCost.get(cost) <= 0) errors.push(`card_pool_config 的 ${cost} 费总量必须为正`);
  }

  // 6) 等级配置必须从 1 连续到 9
  const levelNumbers = levels.list.map((item) => item.level);
  if (levelNumbers.length !== 9) {
    errors.push(`level_config 应有 9 条，实际 ${levelNumbers.length} 条`);
  }
  for (let level = 1; level <= levelNumbers.length; level += 1) {
    if (!levelNumbers.includes(level)) errors.push(`level_config 缺少等级 ${level}`);
  }

  if (errors.length > 0) {
    throw new Error(`balance: 配置校验未通过（${errors.length} 项）\n- ${errors.join('\n- ')}`);
  }
}

/**
 * 组装 engine 可直接消费的配置包（service 层拿这一份就够）。
 * @param {Object} snapshot 配置快照
 * @returns {Object} engine 入参包
 */
function toEngineConfig(snapshot) {
  const cfg = snapshot.gameConfig;
  return {
    // engine/economy.js
    economyConfig: {
      baseIncome: cfg.baseIncome,
      interestGoldStep: cfg.interestGoldStep,
      interestPerStep: cfg.interestPerStep,
      interestCap: cfg.interestCap,
      maxGold: cfg.maxGold,
      streakBonusRules: cfg.streakBonusRules,
      sellRefundRule: cfg.sellRefundRule,
    },
    // engine/stats.js
    statsConfig: {
      starHpMultiplier: cfg.starHpMultiplier,
      starAttackMultiplier: cfg.starAttackMultiplier,
      maxStar: cfg.maxStar,
    },
    // engine/damage.js
    damageConfig: {
      baseRoundDamage: cfg.baseRoundDamage,
      damagePerSurvivor: cfg.damagePerSurvivor,
    },
    // engine/combat.js（其余为模型参数，默认值写在 combat.js 的 DEFAULT_COMBAT）
    combatConfig: {
      battleMaxSeconds: cfg.battleMaxSeconds,
    },
    scoreConfig: {
      rankScoreMap: cfg.rankScoreMap,
      scoreFloor: cfg.scoreFloor,
    },
    // engine/synergy.js
    traitLevels: snapshot.traitLevels.list,
    traitMeta: snapshot.traits.list.reduce((acc, trait) => {
      acc[trait.traitId] = {
        traitId: trait.traitId,
        traitKey: trait.traitKey,
        name: trait.name,
        type: trait.type,
        sortNo: trait.traitId,
      };
      return acc;
    }, {}),
    // engine/probability.js
    oddsByLevel: snapshot.odds.byLevel,
    // engine/stats.js（每个英雄带上 traitIds）
    heroes: snapshot.heroes.list.map((hero) => ({
      ...hero,
      traitIds: snapshot.heroTraits.get(hero.heroId) || [],
    })),
  };
}

/**
 * 把数据库行组装成配置快照（纯函数，便于用假数据做单测）。
 * @param {Object} tableRows 各表数据行 { traits, traitLevels, heroes, heroTraits, cardPool, levels, shopOdds, gameConfig }
 * @param {{now?: () => number}} [options] 可选时钟，便于测试版本时间
 * @returns {Object} BalanceSnapshot
 */
function buildBalance(tableRows, options = {}) {
  const rows = tableRows || {};
  const warnings = [];
  const now = typeof options.now === 'function' ? options.now : Date.now;

  // ---- 羁绊 ----
  const traitList = (rows.traits || []).map((row) => ({
    traitId: toInt(row.id, 'trait.id'),
    traitKey: row.trait_key,
    name: row.name,
    type: toInt(row.type, 'trait.type'),
    description: row.description || null,
  }));
  const traitById = new Map(traitList.map((trait) => [trait.traitId, trait]));

  // ---- 羁绊档位 ----
  const tierList = (rows.traitLevels || []).map((row) => ({
    traitId: toInt(row.trait_id, 'trait_level.trait_id'),
    requiredCount: toInt(row.required_count, 'trait_level.required_count', { min: 1 }),
    effect: parseJson(row.effect_json, 'trait_level.effect_json'),
  }));
  const tiersByTrait = new Map();
  for (const tier of tierList) {
    const list = tiersByTrait.get(tier.traitId) || [];
    list.push(tier);
    tiersByTrait.set(tier.traitId, list);
  }
  for (const list of tiersByTrait.values()) {
    list.sort((a, b) => a.requiredCount - b.requiredCount);
  }

  // ---- 英雄 ----
  const heroList = (rows.heroes || []).map((row) => ({
    heroId: toInt(row.id, 'hero.id'),
    heroKey: row.hero_key,
    name: row.name,
    cost: toInt(row.cost, 'hero.cost'),
    baseHp: toInt(row.base_hp, 'hero.base_hp'),
    baseAttack: toInt(row.base_attack, 'hero.base_attack'),
    attackSpeed: toNumber(row.attack_speed, 'hero.attack_speed'),
    skillDesc: row.skill_desc || null,
    enabled: row.enabled === undefined ? 1 : toInt(row.enabled, 'hero.enabled'),
  }));

  // ---- 英雄-羁绊 ----
  const heroTraits = new Map();
  for (const row of rows.heroTraits || []) {
    const heroId = toInt(row.hero_id, 'hero_trait.hero_id');
    const traitId = toInt(row.trait_id, 'hero_trait.trait_id');
    const list = heroTraits.get(heroId) || [];
    if (!list.includes(traitId)) list.push(traitId);
    heroTraits.set(heroId, list);
  }
  for (const list of heroTraits.values()) list.sort((a, b) => a - b);

  // ---- 卡池 / 概率 / 等级 ----
  const cardPool = buildCardPool(heroList, rows.cardPool, warnings);
  const oddsByLevel = buildOdds(rows.shopOdds);
  const levelList = (rows.levels || []).map((row) => ({
    level: toInt(row.level, 'level_config.level', { min: 1, max: 9 }),
    expToNext: toInt(row.exp_to_next, 'level_config.exp_to_next', { min: 0 }),
    maxBoardSlots: toInt(row.max_board_slots, 'level_config.max_board_slots', { min: 1 }),
    refreshCost: toInt(row.refresh_cost, 'level_config.refresh_cost', { min: 0 }),
  }));

  // ---- 全局参数 ----
  const gameConfig = buildGameConfig(rows.gameConfig, warnings);

  // ---- 可打性提示：某档位所需人数超过该羁绊绑定英雄数 → 永远无法激活该档 ----
  const traitHeroCount = new Map();
  for (const traitIds of heroTraits.values()) {
    for (const traitId of traitIds) {
      traitHeroCount.set(traitId, (traitHeroCount.get(traitId) || 0) + 1);
    }
  }
  for (const [traitId, tiers] of tiersByTrait.entries()) {
    const maxHeroes = traitHeroCount.get(traitId) || 0;
    const unreachable = tiers.filter((tier) => tier.requiredCount > maxHeroes);
    if (unreachable.length > 0) {
      const trait = traitById.get(traitId);
      warnings.push(
        `羁绊「${trait ? trait.name : traitId}」绑定英雄仅 ${maxHeroes} 个，档位 ` +
          `${unreachable.map((tier) => tier.requiredCount).join('/')} 永远无法激活（如需可补英雄或降档）`,
      );
    }
  }

  const snapshot = {
    loadedAt: new Date(now()).toISOString(),
    warnings,
    traits: {
      list: traitList,
      byId: traitById,
      races: traitList.filter((trait) => trait.type === 1),
      classes: traitList.filter((trait) => trait.type === 2),
    },
    traitLevels: { list: tierList, byTraitId: tiersByTrait },
    heroes: {
      list: heroList,
      byId: new Map(heroList.map((hero) => [hero.heroId, hero])),
      byCost: heroList.reduce((acc, hero) => {
        const list = acc.get(hero.cost) || [];
        list.push(hero);
        acc.set(hero.cost, list);
        return acc;
      }, new Map()),
    },
    heroTraits,
    cardPool,
    odds: { byLevel: oddsByLevel },
    levels: {
      list: levelList,
      byLevel: new Map(levelList.map((item) => [item.level, item])),
    },
    gameConfig,
  };

  snapshot.engine = toEngineConfig(snapshot);

  // 配置指纹：内容变了版本就变，写进战报 / 存档便于复盘"这局用的是哪版数值"
  const fingerprint = {
    traits: traitList,
    traitLevels: tierList,
    heroes: heroList,
    heroTraits: [...heroTraits.entries()],
    cardPool: [...cardPool.byCost.entries()],
    odds: oddsByLevel,
    levels: levelList,
    gameConfig: gameConfig.raw,
  };
  snapshot.version = crypto
    .createHash('sha1')
    .update(JSON.stringify(fingerprint))
    .digest('hex')
    .slice(0, 12);

  return snapshot;
}

/**
 * 生成单局卡池（每局独立，对应 match_player.pool_json）。
 *
 * @param {Object} snapshot 配置快照
 * @returns {Array<{heroId:number, cost:number, remaining:number}>} 可直接传给 probability.weightedPick
 */
function createMatchCardPool(snapshot) {
  if (!snapshot || !snapshot.heroes || !snapshot.cardPool) {
    throw new TypeError('balance: createMatchCardPool 需要传入 loadBalance() 的返回值');
  }
  const pool = [];
  for (const hero of snapshot.heroes.list) {
    if (hero.enabled !== 1) continue;
    const remaining = snapshot.cardPool.perHero.get(hero.heroId);
    if (remaining === undefined) continue;
    pool.push({ heroId: hero.heroId, cost: hero.cost, remaining });
  }
  return pool;
}

/**
 * 取某个英雄某星级的棋子数据（拼接 traitIds，直接喂给 stats.resolveUnitStats）。
 * @param {Object} snapshot 配置快照
 * @param {number} heroId 英雄 id
 * @param {number} [star] 星级，默认 1
 * @returns {Object} 含 star / traitIds 的棋子数据
 * @throws {RangeError} 英雄不存在或未启用
 */
function buildUnitSnapshot(snapshot, heroId, star = 1) {
  const hero = snapshot && snapshot.heroes ? snapshot.heroes.byId.get(heroId) : undefined;
  if (!hero) throw new RangeError(`balance: 英雄 ${heroId} 不存在`);
  if (hero.enabled !== 1) throw new RangeError(`balance: 英雄 ${hero.heroId}(${hero.name}) 已停用`);
  return {
    ...hero,
    star,
    traitIds: snapshot.heroTraits.get(hero.heroId) || [],
  };
}

/**
 * 创建带缓存的配置加载器。
 *
 * @param {{
 *   query: (sql:string, params?:Array) => Promise<Array<Object>>,
 *   ttlMs?: number,
 *   now?: () => number,
 *   validate?: boolean,
 *   logger?: {warn: Function}
 * }} options 入参
 * @returns {{get: Function, reload: Function, peek: Function, invalidate: Function, stats: Function}} 加载器
 */
function createBalanceLoader(options = {}) {
  const { query, ttlMs = 60000, now = () => Date.now(), validate = true, logger } = options;
  if (typeof query !== 'function') {
    throw new TypeError('balance.createBalanceLoader: 必须传入 query(sql) 函数（依赖注入，便于单测）');
  }

  let cached = null;
  let cachedAt = 0;
  let inflight = null;
  let loadCount = 0;

  /** 依次查询所有配置表（顺序固定，便于出错时定位） */
  const fetchRows = async () => {
    const result = {};
    for (const [key, sql] of Object.entries(BALANCE_QUERIES)) {
      result[key] = await query(sql);
    }
    return result;
  };

  /**
   * 取配置（命中缓存直接返回；并发调用合并为一次查询）。
   * @param {{force?: boolean, silent?: boolean}} [opts] force=忽略缓存，silent=不打印告警
   * @returns {Promise<Object>} 配置快照
   */
  const get = async (opts = {}) => {
    const isFresh = cached && now() - cachedAt < ttlMs;
    if (isFresh && !opts.force) return cached;
    if (inflight) return inflight;

    inflight = (async () => {
      const rows = await fetchRows();
      const snapshot = buildBalance(rows, { now });
      if (validate) validateBalance(snapshot);
      if (logger && !opts.silent && snapshot.warnings.length > 0) {
        // 启动日志只打印前 3 条，完整清单用 npm run config:check 查看，避免刷屏
        const head = snapshot.warnings
          .slice(0, 3)
          .map((warning) => `\n- ${warning}`)
          .join('');
        const rest =
          snapshot.warnings.length > 3
            ? `\n- 其余 ${snapshot.warnings.length - 3} 条请执行 npm run config:check 查看`
            : '';
        logger.warn(`[balance] 配置告警 ${snapshot.warnings.length} 条${head}${rest}`);
      }
      cached = snapshot;
      cachedAt = now();
      loadCount += 1;
      return snapshot;
    })();

    try {
      return await inflight;
    } finally {
      inflight = null;
    }
  };

  return {
    get,
    reload: () => get({ force: true }),
    peek: () => cached,
    invalidate: () => {
      cached = null;
      cachedAt = 0;
    },
    stats: () => ({ loadCount, cachedAt: cachedAt ? new Date(cachedAt).toISOString() : null }),
  };
}

/** 默认加载器（使用 config/db.js 的连接池，惰性创建） */
let defaultLoader = null;

/**
 * 获取默认加载器单例。
 * @returns {Object} 加载器
 */
function getBalanceLoader() {
  if (!defaultLoader) {
    // 惰性 require：engine 单测不会触碰 mysql2
    // eslint-disable-next-line global-require
    const db = require('./db');
    defaultLoader = createBalanceLoader({
      query: (sql, params) => db.query(sql, params),
      ttlMs: Number(process.env.BALANCE_CACHE_TTL_MS || 60000),
      logger: console,
    });
  }
  return defaultLoader;
}

/**
 * 加载配置（service 层入口）。
 * @param {{force?: boolean, silent?: boolean}} [options] force=true 强制刷新，silent=true 不打印告警
 * @returns {Promise<Object>} 配置快照
 */
async function loadBalance(options = {}) {
  return getBalanceLoader().get(options);
}

/**
 * 强制刷新配置（后台改完数值后调用，或定时任务调用）。
 * @returns {Promise<Object>} 新配置快照
 */
async function refreshBalance() {
  return getBalanceLoader().reload();
}

module.exports = {
  BALANCE_QUERIES,
  GAME_CONFIG_SPEC,
  buildBalance,
  validateBalance,
  toEngineConfig,
  createMatchCardPool,
  buildUnitSnapshot,
  createBalanceLoader,
  getBalanceLoader,
  loadBalance,
  refreshBalance,
};
