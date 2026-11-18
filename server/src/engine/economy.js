'use strict';

/**
 * engine/economy.js —— 金币与经济结算（纯函数）
 * =============================================================================
 * 本模块是整个项目「数值正确」的核心之一，对应以下数据库字段：
 *   match_round.gold_before / income_base / income_interest / income_streak
 *   match_round.income_total / gold_after
 *
 * 结算口径（与 docs/01-数据库设计.md §4.4 一致，禁止改动）：
 *   income_interest = MIN( FLOOR(gold_before / interest_gold_step) * interest_per_step, interest_cap )
 *   income_total    = income_base + income_interest + income_streak
 *   gold_after      = MIN( gold_before + income_total - 本回合支出, max_gold )
 *
 * ★ 关键口径：利息只看 **回合结算开始时刻** 的金币（gold_before），
 *   不含本回合的基础收入，也不含本回合的连胜奖励。
 *   若改成「先加基础收入再算利息」，就会产生循环依赖（收入影响利息、利息影响收入），
 *   不同实现算出的结果会不一致，因此这里写死顺序并配单测锁死。
 *
 * ★ 本模块不含任何数值常量：所有阈值都从 EconomyConfig 读取（配置是唯一真值）。
 * =============================================================================
 */

/**
 * @typedef {Object} EconomyConfig
 * 由 config/balance.loader.js 把 game_config 的键值行（snake_case）解析为驼峰对象后注入。
 * @property {number} baseIncome          base_income         每回合基础收入
 * @property {number} interestGoldStep    interest_gold_step  每持有多少金币产生一档利息
 * @property {number} interestPerStep     interest_per_step   每档利息金币数
 * @property {number} interestCap         interest_cap        利息上限
 * @property {number} maxGold             max_gold            金币上限（溢出截断）
 * @property {Array<{minStreak:number, bonus:number}>} streakBonusRules  streak_bonus_rules 连胜/连败奖励分档
 * @property {Object<string, number>} sellRefundRule  sell_refund_rule  星级 → 退款系数（如 {"1":1,"2":3,"3":9}）
 */

/**
 * 校验「整数配置项」存在且合法，避免配置缺项时被 undefined 悄悄算成 NaN。
 * @param {Object} config 配置对象
 * @param {string} key 键名
 * @param {{min?: number, max?: number}} [range] 取值范围
 * @returns {number} 配置值
 */
function requireInt(config, key, range = {}) {
  const value = config ? config[key] : undefined;
  if (!Number.isInteger(value)) {
    throw new TypeError(`economy: 配置项 ${key} 必须是整数，收到 ${value}`);
  }
  if (range.min !== undefined && value < range.min) {
    throw new RangeError(`economy: 配置项 ${key} 不能小于 ${range.min}，收到 ${value}`);
  }
  if (range.max !== undefined && value > range.max) {
    throw new RangeError(`economy: 配置项 ${key} 不能大于 ${range.max}，收到 ${value}`);
  }
  return value;
}

/**
 * 校验金币入参：必须是非负有限数（金币在数据库里是 SMALLINT UNSIGNED）。
 * @param {number} value 待校验值
 * @param {string} name 参数名
 * @returns {number} 原值
 */
function requireGold(value, name) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new TypeError(`economy: ${name} 必须是有限数值，收到 ${value}`);
  }
  if (value < 0) {
    throw new RangeError(`economy: ${name} 不能为负，收到 ${value}`);
  }
  return value;
}

/**
 * 校验连胜/连败奖励分档配置：每档 minStreak 唯一、bonus 非负整数。
 * @param {Array<{minStreak:number, bonus:number}>} rules 分档数组
 * @returns {Array<{minStreak:number, bonus:number}>} 按 minStreak 升序的新数组
 */
function normalizeStreakRules(rules) {
  if (!Array.isArray(rules) || rules.length === 0) {
    throw new TypeError('economy: streakBonusRules 必须是非空数组');
  }
  const seen = new Set();
  const normalized = rules.map((rule) => {
    if (!rule || !Number.isInteger(rule.minStreak) || rule.minStreak < 1) {
      throw new TypeError(`economy: streakBonusRules.minStreak 必须是 >=1 的整数，收到 ${rule && rule.minStreak}`);
    }
    if (!Number.isInteger(rule.bonus) || rule.bonus < 0) {
      throw new TypeError(`economy: streakBonusRules.bonus 必须是非负整数，收到 ${rule && rule.bonus}`);
    }
    if (seen.has(rule.minStreak)) {
      throw new RangeError(`economy: streakBonusRules 存在重复档位 ${rule.minStreak}`);
    }
    seen.add(rule.minStreak);
    return { minStreak: rule.minStreak, bonus: rule.bonus };
  });
  return normalized.sort((a, b) => a.minStreak - b.minStreak);
}

/**
 * 计算一回合的利息。
 *
 * 公式：MIN( FLOOR(goldBefore / interestGoldStep) * interestPerStep, interestCap )
 * 举例（默认配置 step=10 / perStep=1 / cap=5）：
 *   9 金 → 0，10 金 → 1，49 金 → 4，50 金 → 5，99 金 → 5（被上限截断）
 *
 * @param {number} goldBefore 回合结算开始时刻的金币（不含本回合收入）
 * @param {EconomyConfig} config 经济配置
 * @returns {number} 利息金币（非负整数）
 */
function calcInterest(goldBefore, config) {
  requireGold(goldBefore, 'goldBefore');
  const step = requireInt(config, 'interestGoldStep', { min: 1 });
  const perStep = requireInt(config, 'interestPerStep', { min: 0 });
  const cap = requireInt(config, 'interestCap', { min: 0 });

  const steps = Math.floor(goldBefore / step);
  return Math.min(steps * perStep, cap);
}

/**
 * 计算利息档位（几档），供「每 10 金 1 利息」这类 UI 提示复用。
 * @param {number} goldBefore 回合结算开始时刻的金币
 * @param {EconomyConfig} config 经济配置
 * @returns {number} 档位（未截断前的 FLOOR 结果）
 */
function calcInterestSteps(goldBefore, config) {
  requireGold(goldBefore, 'goldBefore');
  const step = requireInt(config, 'interestGoldStep', { min: 1 });
  return Math.floor(goldBefore / step);
}

/**
 * 计算连胜 / 连败奖励。
 *
 * 规则：取当前 streak 满足的**最大档位**（streak 越大档位越高，不叠加多档）。
 * 举例（默认配置 2→1、4→2、6→3）：streak 1 → 0，3 → 1，5 → 2，8 → 3。
 *
 * @param {{winStreak?: number, loseStreak?: number}} streaks 连胜 / 连败场次
 * @param {EconomyConfig} config 经济配置
 * @returns {{streak: number, bonus: number, matchedRule: {minStreak:number,bonus:number}|null}} 结算结果
 */
function calcStreakBonus(streaks, config) {
  const winStreak = streaks && streaks.winStreak ? streaks.winStreak : 0;
  const loseStreak = streaks && streaks.loseStreak ? streaks.loseStreak : 0;
  if (!Number.isInteger(winStreak) || winStreak < 0) {
    throw new RangeError(`economy: winStreak 必须是非负整数，收到 ${winStreak}`);
  }
  if (!Number.isInteger(loseStreak) || loseStreak < 0) {
    throw new RangeError(`economy: loseStreak 必须是非负整数，收到 ${loseStreak}`);
  }
  // 连胜与连败互斥，取较大者作为当前 streak（平局时两者都归零，见 damage.updateStreaks）
  const streak = Math.max(winStreak, loseStreak);

  const rules = normalizeStreakRules(config && config.streakBonusRules);
  let matchedRule = null;
  for (const rule of rules) {
    if (streak >= rule.minStreak) matchedRule = rule;
  }
  return {
    streak,
    bonus: matchedRule ? matchedRule.bonus : 0,
    matchedRule,
  };
}

/**
 * 计算一回合的金币收入明细（不扣支出，支出用 calcGoldAfter 处理）。
 *
 * @param {{goldBefore: number, winStreak?: number, loseStreak?: number}} input 结算入参
 * @param {EconomyConfig} config 经济配置
 * @returns {{goldBefore:number, base:number, interest:number, interestSteps:number, streak:number, streakBonus:number, total:number}}
 *          base=基础收入，interest=利息，streakBonus=连胜/连败奖励，total=三者之和
 */
function calcRoundIncome(input, config) {
  if (!input || typeof input !== 'object') {
    throw new TypeError('economy.calcRoundIncome: 入参必须是对象');
  }
  const goldBefore = requireGold(input.goldBefore, 'goldBefore');
  const base = requireInt(config, 'baseIncome', { min: 0 });
  const interest = calcInterest(goldBefore, config);
  const interestSteps = calcInterestSteps(goldBefore, config);
  const streakResult = calcStreakBonus(
    { winStreak: input.winStreak, loseStreak: input.loseStreak },
    config,
  );

  return {
    goldBefore,
    base,
    interest,
    interestSteps,
    streak: streakResult.streak,
    streakBonus: streakResult.bonus,
    total: base + interest + streakResult.bonus,
  };
}

/**
 * 计算回合结算后的金币。
 *
 * gold_after = MIN(gold_before + income_total - spend, max_gold)
 *
 * @param {{goldBefore:number, incomeTotal:number, spend?:number}} input 结算入参
 * @param {EconomyConfig} config 经济配置
 * @returns {{goldBefore:number, incomeTotal:number, spend:number, goldAfter:number, capped:boolean}}
 *          capped=true 表示被 max_gold 截断（数据对账时提示玩家）
 * @throws {RangeError} 支出超过「原有金币 + 本回合收入」时抛错（说明调用方漏做了余额校验）
 */
function calcGoldAfter(input, config) {
  if (!input || typeof input !== 'object') {
    throw new TypeError('economy.calcGoldAfter: 入参必须是对象');
  }
  const goldBefore = requireGold(input.goldBefore, 'goldBefore');
  const incomeTotal = requireGold(input.incomeTotal, 'incomeTotal');
  const spend = input.spend === undefined ? 0 : requireGold(input.spend, 'spend');
  const maxGold = requireInt(config, 'maxGold', { min: 0 });

  const raw = goldBefore + incomeTotal - spend;
  if (raw < 0) {
    throw new RangeError(
      `economy: 金币不足以支付支出（现有 ${goldBefore} + 收入 ${incomeTotal} < 支出 ${spend}）`,
    );
  }
  return {
    goldBefore,
    incomeTotal,
    spend,
    goldAfter: Math.min(raw, maxGold),
    capped: raw > maxGold,
  };
}

/**
 * 金币上限截断（用于购买 / 出售等零散加币场景）。
 * @param {number} gold 当前金币
 * @param {EconomyConfig} config 经济配置
 * @returns {number} 截断后的金币
 */
function applyGoldCap(gold, config) {
  requireGold(gold, 'gold');
  const maxGold = requireInt(config, 'maxGold', { min: 0 });
  return Math.min(gold, maxGold);
}

/**
 * 计算棋子出售退款。
 *
 * 退款 = FLOOR( hero.cost × sell_refund_rule[star] × card_pool_config.sell_refund_ratio )
 * 默认配置（{"1":1,"2":3,"3":9} + ratio 1.00）下：
 *   1 费 1 星 → 1 金，2 费 2 星 → 6 金，3 费 3 星 → 27 金（三合一不折损）。
 *
 * @param {{cost:number, star:number, refundRatio?:number}} input 棋子信息
 * @param {EconomyConfig} config 经济配置
 * @returns {{cost:number, star:number, coefficient:number, refundRatio:number, refund:number}}
 * @throws {RangeError} 星级在 sellRefundRule 中没有对应系数
 */
function calcSellRefund(input, config) {
  if (!input || typeof input !== 'object') {
    throw new TypeError('economy.calcSellRefund: 入参必须是对象');
  }
  const cost = input.cost;
  const star = input.star;
  if (!Number.isInteger(cost) || cost < 0) {
    throw new RangeError(`economy: cost 必须是非负整数，收到 ${cost}`);
  }
  if (!Number.isInteger(star) || star < 1) {
    throw new RangeError(`economy: star 必须是 >=1 的整数，收到 ${star}`);
  }
  const refundRatio = input.refundRatio === undefined ? 1 : input.refundRatio;
  if (typeof refundRatio !== 'number' || !Number.isFinite(refundRatio) || refundRatio < 0) {
    throw new RangeError(`economy: refundRatio 必须是非负数值，收到 ${refundRatio}`);
  }

  const rule = config && config.sellRefundRule;
  if (!rule || typeof rule !== 'object') {
    throw new TypeError('economy: 缺少配置项 sellRefundRule');
  }
  const coefficient = rule[String(star)];
  if (typeof coefficient !== 'number' || !Number.isFinite(coefficient) || coefficient < 0) {
    throw new RangeError(`economy: sellRefundRule 缺少 ${star} 星系数`);
  }

  return {
    cost,
    star,
    coefficient,
    refundRatio,
    // 向下取整：宁可少给 1 金也不产生小数金币（金币全程 INT）
    refund: Math.floor(cost * coefficient * refundRatio),
  };
}

/**
 * 「下回合收入预估」：语义与 calcRoundIncome 相同，单独命名以便接口层直读。
 * @param {{goldBefore:number, winStreak?:number, loseStreak?:number}} input 入参
 * @param {EconomyConfig} config 经济配置
 * @returns {object} 同 calcRoundIncome 返回值
 */
function estimateIncome(input, config) {
  return calcRoundIncome(input, config);
}

module.exports = {
  calcInterest,
  calcInterestSteps,
  calcStreakBonus,
  calcRoundIncome,
  calcGoldAfter,
  applyGoldCap,
  calcSellRefund,
  estimateIncome,
};
