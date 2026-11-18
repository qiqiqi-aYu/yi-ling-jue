'use strict';

/**
 * engine/probability.js —— 加权抽卡（纯函数 + 可注入随机源）
 * =============================================================================
 * 对应数据库：
 *   shop_odds_config(level, cost, probability)  —— 每级 5 档费用概率，合计 1.0000
 *   match_card_pool(match_id, hero_id, remaining) —— 本局每种英雄的剩余张数
 *
 * 抽卡分两段（顺序固定，顺序本身也是数值结果的一部分）：
 *   ① 抽费用档：按 shop_odds_config 的概率抽 1~5 费；
 *      若某档位的卡池已抽空（该费用所有英雄 remaining 都为 0），
 *      则把该档位从候选中**剔除并重新归一化**其余档位，而不是"抽空后重抽"
 *      —— 重抽会改变消耗的随机数个数，导致同 seed 不可复算。
 *   ② 抽具体英雄：在该费用内按「剩余张数」加权，余量多的英雄更容易出现，
 *      这与 match_card_pool 的设计意图一致（卖掉的棋子会回到池子，从而更容易再抽到）。
 *
 * ★ 本模块不产生随机性，随机源必须由调用方注入（rng.js 的实例），
 *   保证「同 seed + 同卡池 = 同结果」，可写进 battle_log / 单测复算。
 * =============================================================================
 */

/** 概率和校验的默认容差：DECIMAL(5,4) 转浮点后求和可能出现 1e-16 级误差 */
const DEFAULT_EPSILON = 1e-6;

/**
 * @typedef {Object} OddsOption 费用档概率（一条 shop_odds_config 记录）
 * @property {number} cost 费用 1~5
 * @property {number} probability 概率 0~1
 */

/**
 * @typedef {Object} CardEntry 卡池中的一种英雄（一条 match_card_pool 记录）
 * @property {number|string} heroId 英雄 id
 * @property {number} cost 费用 1~5
 * @property {number} remaining 剩余张数
 */

/**
 * 把多种写法的概率配置统一成 Map<cost, probability>。
 * 支持：{ 1: 0.45, 2: 0.3 } / [{cost, probability}] / Map。
 * @param {Object|Array|Map} odds 概率配置
 * @returns {Map<number, number>} 费用 → 概率（按费用升序插入）
 * @throws {TypeError} 结构无法识别
 */
function normalizeOdds(odds) {
  const result = new Map();

  if (odds instanceof Map) {
    for (const [cost, probability] of odds.entries()) {
      result.set(Number(cost), Number(probability));
    }
  } else if (Array.isArray(odds)) {
    for (const entry of odds) {
      if (!entry || typeof entry !== 'object') {
        throw new TypeError('probability: odds 数组元素必须是 {cost, probability} 对象');
      }
      result.set(Number(entry.cost), Number(entry.probability));
    }
  } else if (odds && typeof odds === 'object') {
    for (const key of Object.keys(odds)) {
      result.set(Number(key), Number(odds[key]));
    }
  } else {
    throw new TypeError('probability: odds 必须是对象 / 数组 / Map');
  }

  // 按费用升序重排，保证遍历顺序稳定（顺序影响抽卡消耗的随机数序列）
  const sorted = new Map();
  [...result.keys()].sort((a, b) => a - b).forEach((cost) => {
    sorted.set(cost, result.get(cost));
  });
  return sorted;
}

/**
 * 校验概率配置：每档在 [0,1] 内，且合计必须等于 1（容差 epsilon）。
 * 对应数据库约束「同级 5 档概率之和 = 1.0000」。
 *
 * @param {Object|Array|Map} odds 概率配置
 * @param {{epsilon?: number}} [options] 容差配置
 * @returns {{valid:boolean, sum:number, total:number, diff:number, epsilon:number, errors:string[]}}
 *          sum 为浮点求和，total 为四舍五入到 6 位后的展示值
 */
function validateOdds(odds, options = {}) {
  const epsilon = typeof options.epsilon === 'number' ? options.epsilon : DEFAULT_EPSILON;
  const errors = [];
  let sum = 0;

  let normalized;
  try {
    normalized = normalizeOdds(odds);
  } catch (err) {
    return { valid: false, sum: 0, total: 0, diff: -1, epsilon, errors: [err.message] };
  }

  if (normalized.size === 0) {
    errors.push('概率配置为空');
  }

  for (const [cost, probability] of normalized.entries()) {
    if (!Number.isInteger(cost) || cost < 1) {
      errors.push(`费用档 ${cost} 非法（应为 >=1 的整数）`);
    }
    if (typeof probability !== 'number' || Number.isNaN(probability)) {
      errors.push(`费用 ${cost} 的概率不是数值`);
      continue;
    }
    if (probability < 0 || probability > 1) {
      errors.push(`费用 ${cost} 的概率 ${probability} 超出 [0,1]`);
    }
    sum += probability;
  }

  const diff = sum - 1;
  if (Math.abs(diff) > epsilon) {
    errors.push(`概率合计 ${round6(sum)} 不等于 1（差值 ${round6(diff)}）`);
  }

  return {
    valid: errors.length === 0,
    sum,
    total: round6(sum),
    diff,
    epsilon,
    errors,
  };
}

/**
 * 概率校验的断言版本：配置非法直接抛错，供「后台保存配置」「抽卡入口」使用。
 * @param {Object|Array|Map} odds 概率配置
 * @param {{epsilon?: number}} [options] 容差配置
 * @returns {Map<number, number>} 规范化后的概率表
 * @throws {RangeError} 校验失败
 */
function assertOdds(odds, options = {}) {
  const result = validateOdds(odds, options);
  if (!result.valid) {
    throw new RangeError(`probability: 概率配置非法 —— ${result.errors.join('；')}`);
  }
  return normalizeOdds(odds);
}

/**
 * 保留 6 位小数，仅用于错误信息展示。
 * @param {number} value 原值
 * @returns {number} 四舍五入后的值
 */
function round6(value) {
  return Math.round(value * 1e6) / 1e6;
}

/**
 * 校验卡池条目并做浅拷贝（本模块全程不修改入参）。
 * @param {CardEntry[]} cards 卡池
 * @returns {CardEntry[]} 拷贝后的卡池（已按 heroId 升序排序）
 */
function normalizeCards(cards) {
  if (!Array.isArray(cards)) {
    throw new TypeError('probability: cards 必须是数组');
  }
  return cards
    .map((card) => {
      if (!card || typeof card !== 'object') {
        throw new TypeError('probability: cards 元素必须是对象');
      }
      if (typeof card.cost !== 'number' || !Number.isInteger(card.cost)) {
        throw new TypeError(`probability: card.cost 必须是整数，收到 ${card.cost}`);
      }
      if (typeof card.remaining !== 'number' || !Number.isInteger(card.remaining) || card.remaining < 0) {
        throw new RangeError(`probability: card.remaining 必须是非负整数，收到 ${card.remaining}`);
      }
      return { ...card };
    })
    // 排序保证「同 seed + 同内容 = 同结果」，避免上游 SQL 顺序变化影响数值
    .sort((a, b) => (a.heroId > b.heroId ? 1 : a.heroId < b.heroId ? -1 : 0));
}

/**
 * 汇总每个费用档的剩余总量，并剔除已抽空的档位。
 * @param {CardEntry[]} cards 已规范化的卡池
 * @returns {Map<number, {remainingSum:number, cards:CardEntry[]}>} 费用 → 汇总
 */
function aggregateByCost(cards) {
  const buckets = new Map();
  for (const card of cards) {
    if (card.remaining <= 0) continue;
    const bucket = buckets.get(card.cost) || { remainingSum: 0, cards: [] };
    bucket.remainingSum += card.remaining;
    bucket.cards.push(card);
    buckets.set(card.cost, bucket);
  }
  return buckets;
}

/**
 * 校验随机源：只要求提供 next()，方便单测注入假随机源做确定性断言。
 * @param {Object} rng 随机源
 * @returns {Object} 原随机源
 */
function requireRng(rng) {
  if (!rng || typeof rng.next !== 'function') {
    throw new TypeError('probability: rng 必须提供 next() 方法（见 engine/rng.js）');
  }
  return rng;
}

/**
 * 加权抽取单个棋子。
 *
 * @param {Object|Array|Map} odds 费用档概率（shop_odds_config 当前等级那一行）
 * @param {CardEntry[]} cards 卡池余量（match_card_pool）
 * @param {Object} rng 随机源（engine/rng.js 的实例）
 * @param {{epsilon?: number}} [options] 概率校验容差
 * @returns {{
 *   heroId: number|string,
 *   cost: number,
 *   index: number,
 *   remainingBefore: number,
 *   costOdds: number,
 *   effectiveProbability: number,
 *   costWeights: Array<{cost:number, weight:number}>,
 *   rolls: {cost:number, hero:number}
 * }|null} 抽中结果；卡池全空或概率总和为 0 时返回 null
 */
function weightedPick(odds, cards, rng, options = {}) {
  requireRng(rng);
  const oddsMap = assertOdds(odds, options);
  const pool = normalizeCards(cards);
  const buckets = aggregateByCost(pool);

  // ① 计算候选费用档：概率 > 0 且该档位仍有余量
  const candidates = [];
  for (const [cost, probability] of oddsMap.entries()) {
    const bucket = buckets.get(cost);
    if (probability > 0 && bucket && bucket.remainingSum > 0) {
      candidates.push({ cost, weight: probability, bucket });
    }
  }
  if (candidates.length === 0) return null;

  // 重归一化：抽空档位的概率被剔除，剩余档位按原比例放大，合计仍为 1
  const totalWeight = candidates.reduce((sum, item) => sum + item.weight, 0);
  if (totalWeight <= 0) return null;

  const costRoll = rng.next() * totalWeight;
  let cursor = costRoll;
  let picked = candidates[candidates.length - 1];
  for (const candidate of candidates) {
    cursor -= candidate.weight;
    if (cursor < 0) {
      picked = candidate;
      break;
    }
  }

  // ② 在该费用内按剩余张数加权
  const heroRoll = rng.next() * picked.bucket.remainingSum;
  let heroCursor = heroRoll;
  let hero = picked.bucket.cards[picked.bucket.cards.length - 1];
  for (const card of picked.bucket.cards) {
    heroCursor -= card.remaining;
    if (heroCursor < 0) {
      hero = card;
      break;
    }
  }

  return {
    heroId: hero.heroId,
    cost: picked.cost,
    index: pool.indexOf(hero),
    remainingBefore: hero.remaining,
    costOdds: oddsMap.get(picked.cost),
    // 实际概率 = P(该费用档 | 剔除抽空档) × P(该英雄 | 该费用内余量)
    effectiveProbability:
      (picked.weight / totalWeight) * (hero.remaining / picked.bucket.remainingSum),
    costWeights: candidates.map((item) => ({ cost: item.cost, weight: item.weight })),
    rolls: { cost: costRoll, hero: heroRoll },
  };
}

/**
 * 抽取商店整排格子（刷新商店用）。
 *
 * 逐格抽取且**实时扣减本地卡池**：同一次刷新不会抽到超过剩余张数的棋子
 * （例如某英雄只剩 1 张，这一排不会出现 2 个）。
 * 注意：这里只更新返回的 pool 副本，真正的数据库扣减仍由 service 在事务里做。
 *
 * @param {{odds:Object|Array|Map, cards:CardEntry[], rng:Object, count:number}} input 入参
 * @param {{epsilon?: number}} [options] 概率校验容差
 * @returns {{picks:Array, pool:CardEntry[], drawnCount:number, exhausted:boolean}}
 *          picks 长度可能小于 count（卡池整体不足），exhausted 表示卡池已空
 */
function drawShop(input, options = {}) {
  if (!input || typeof input !== 'object') {
    throw new TypeError('probability.drawShop: 入参必须是对象');
  }
  const { odds, cards, rng, count } = input;
  requireRng(rng);
  if (!Number.isInteger(count) || count < 0) {
    throw new RangeError(`probability: count 必须是非负整数，收到 ${count}`);
  }

  const pool = normalizeCards(cards);
  const picks = [];

  for (let i = 0; i < count; i += 1) {
    const pick = weightedPick(odds, pool, rng, options);
    if (!pick) break;
    picks.push(pick);
    // 扣减本地余量（不修改入参 cards，保持纯函数）
    const target = pool[pick.index];
    pool[pick.index] = { ...target, remaining: target.remaining - 1 };
  }

  const exhausted = pool.every((card) => card.remaining <= 0);
  return { picks, pool, drawnCount: picks.length, exhausted };
}

/**
 * 调整某个英雄的卡池余量（购买 -1 / 出售或淘汰归还 +1）。
 * @param {CardEntry[]} cards 卡池
 * @param {number|string} heroId 英雄 id
 * @param {number} delta 变化量（负数扣减）
 * @returns {CardEntry[]} 新卡池（不修改入参）
 * @throws {RangeError} 扣减后为负（说明卡池已空还继续购买）
 */
function adjustPool(cards, heroId, delta) {
  if (!Number.isInteger(delta)) {
    throw new TypeError(`probability: delta 必须是整数，收到 ${delta}`);
  }
  const pool = normalizeCards(cards);
  const index = pool.findIndex((card) => String(card.heroId) === String(heroId));
  if (index === -1) {
    throw new RangeError(`probability: 卡池中不存在英雄 ${heroId}`);
  }
  const next = pool[index].remaining + delta;
  if (next < 0) {
    throw new RangeError(`probability: 英雄 ${heroId} 卡池余量为 ${pool[index].remaining}，无法扣减 ${-delta}`);
  }
  pool[index] = { ...pool[index], remaining: next };
  return pool;
}

module.exports = {
  validateOdds,
  assertOdds,
  normalizeOdds,
  weightedPick,
  drawShop,
  adjustPool,
};
