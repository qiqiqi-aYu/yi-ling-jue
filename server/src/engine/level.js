'use strict';

/**
 * engine/level.js —— 棋手等级与经验（纯函数）
 * =============================================================================
 * 数值来源：
 *   level_config.exp_to_next     当前等级升到下一级所需经验（9 级填 0 表示封顶）
 *   level_config.max_board_slots 该等级的最大上阵人口（本项目恒等于等级）
 *   game_config.exp_per_round    每回合结算自动获得的经验
 *   game_config.buy_exp_gold     购买一次经验消耗的金币
 *   game_config.buy_exp_amount   购买一次获得的经验
 *
 * 设计约束（与 engine 其余模块一致）：
 *   - 不 require 任何 io / db / express，不使用 Math.random()，可直接单测；
 *   - 所有阈值都从入参 config 读取，模块内不写死数值；
 *   - 「能不能买经验」也由本模块判定，服务层与接口层只搬运结论，
 *     前端因此可以直接消费 allowed / message，不需要自己比较金币与等级。
 * =============================================================================
 */

/** 购买经验被拒绝的原因码（稳定标识，供后端与前端共用） */
const BUY_EXP_DENIED = {
  LEVEL_MAX: 'LEVEL_MAX',
  GOLD_NOT_ENOUGH: 'GOLD_NOT_ENOUGH',
};

/**
 * 校验非负整数。
 * @param {number} value 待校验值
 * @param {string} name 名称
 * @returns {number} 原值
 */
function requireNonNegativeInt(value, name) {
  if (!Number.isInteger(value) || value < 0) {
    throw new RangeError(`level: ${name} 必须是非负整数，收到 ${value}`);
  }
  return value;
}

/**
 * 校验等级配置，返回规范化的配置视图。
 * @param {Object} config { maxLevel, byLevel, expPerRound, buyExpGold, buyExpAmount }
 * @returns {Object} 规范化配置
 */
function normalizeConfig(config) {
  if (!config || typeof config !== 'object') {
    throw new TypeError('level: config 不能为空');
  }
  const maxLevel = config.maxLevel;
  if (!Number.isInteger(maxLevel) || maxLevel < 1) {
    throw new RangeError(`level: maxLevel 必须是 >=1 的整数，收到 ${maxLevel}`);
  }
  if (!config.byLevel) {
    throw new TypeError('level: config.byLevel 不能为空');
  }
  return {
    maxLevel,
    byLevel: config.byLevel,
    expPerRound: requireNonNegativeInt(config.expPerRound, 'expPerRound'),
    buyExpGold: requireNonNegativeInt(config.buyExpGold, 'buyExpGold'),
    buyExpAmount: requireNonNegativeInt(config.buyExpAmount, 'buyExpAmount'),
  };
}

/**
 * 读取某一级的配置行，兼容 Map 与普通对象两种形态。
 * @param {Map<number,Object>|Object<string,Object>} byLevel 等级配置
 * @param {number} level 等级
 * @returns {Object} 配置行
 */
function rowOf(byLevel, level) {
  const row = typeof byLevel.get === 'function' ? byLevel.get(level) : byLevel[level];
  if (!row) throw new RangeError(`level: level_config 缺少等级 ${level}`);
  return row;
}

/**
 * 读取等级配置行中的「升到下一级所需经验」。
 * @param {Object} row 配置行
 * @param {number} level 等级
 * @returns {number} 经验需求（9 级为 0）
 */
function expToNextOf(row, level) {
  const value = row.expToNext !== undefined ? row.expToNext : row.exp_to_next;
  requireNonNegativeInt(value, `level_config[${level}].expToNext`);
  return value;
}

/**
 * 读取等级配置行中的「最大上阵人口」，缺省时退化为等级本身。
 * @param {Object} row 配置行
 * @param {number} level 等级
 * @returns {number} 人口上限
 */
function maxUnitOf(row, level) {
  const value = row.maxBoardSlots !== undefined ? row.maxBoardSlots : row.max_board_slots;
  if (value === undefined || value === null) return level;
  requireNonNegativeInt(value, `level_config[${level}].maxBoardSlots`);
  return value;
}

/**
 * 计算某一等级下的展示态：升级所需经验、人口上限、经验条百分比。
 *
 * expPercent 由后端算好（整数 0~100），前端只负责把宽度绑上去，
 * 避免前端为了画进度条而自行做除法与取整。
 *
 * @param {number} level 等级
 * @param {number} exp 当前经验
 * @param {Object} config 等级配置
 * @returns {{level:number, exp:number, nextExp:number|null, maxUnit:number, expPercent:number, isMaxLevel:boolean}}
 */
function levelState(level, exp, config) {
  const cfg = normalizeConfig(config);
  if (!Number.isInteger(level) || level < 1 || level > cfg.maxLevel) {
    throw new RangeError(`level: level 必须在 1~${cfg.maxLevel} 之间，收到 ${level}`);
  }
  requireNonNegativeInt(exp, 'exp');

  const row = rowOf(cfg.byLevel, level);
  const isMaxLevel = level >= cfg.maxLevel;
  // 满级后不再累计经验，nextExp 用 null 明确表示「没有下一级」。
  const nextExp = isMaxLevel ? null : expToNextOf(row, level);
  const safeExp = isMaxLevel ? 0 : exp;
  let expPercent = 100;
  if (!isMaxLevel && nextExp > 0) {
    expPercent = Math.min(100, Math.floor((safeExp / nextExp) * 100));
  }

  return {
    level,
    exp: safeExp,
    nextExp,
    maxUnit: maxUnitOf(row, level),
    expPercent,
    isMaxLevel,
  };
}

/**
 * 按经验表把 {level, exp} 推进到能到达的最高等级。
 *
 * 例（经验表 1/2/4/8…）：1 级 0 经验 +3 → 2 级 1 经验（先扣 1 升到 2 级，余 2 再扣 2 升到 3 级后余 0）。
 *
 * @param {{level:number, exp:number}} state 当前等级与经验
 * @param {number} gain 本次获得的经验（>=0）
 * @param {Object} config 等级配置
 * @returns {{level:number, exp:number, leveled:number, nextExp:number|null, maxUnit:number, expPercent:number, isMaxLevel:boolean, capped:boolean}}
 *          leveled=本次提升的等级数，capped=true 表示经验因满级被丢弃
 */
function grantExp(state, gain, config) {
  if (!state || typeof state !== 'object') {
    throw new TypeError('level.grantExp: state 必须是对象');
  }
  const cfg = normalizeConfig(config);
  requireNonNegativeInt(gain, 'gain');

  let level = state.level;
  if (!Number.isInteger(level) || level < 1 || level > cfg.maxLevel) {
    throw new RangeError(`level.grantExp: level 必须在 1~${cfg.maxLevel} 之间，收到 ${level}`);
  }
  let exp = requireNonNegativeInt(state.exp, 'exp') + gain;
  let leveled = 0;

  while (level < cfg.maxLevel) {
    const need = expToNextOf(rowOf(cfg.byLevel, level), level);
    // 需求为 0 说明该级未配置升级成本，直接停止，避免死循环。
    if (need <= 0 || exp < need) break;
    exp -= need;
    level += 1;
    leveled += 1;
  }

  const capped = level >= cfg.maxLevel;
  if (capped) exp = 0;

  const view = levelState(level, exp, cfg);
  return {
    level: view.level,
    exp: view.exp,
    leveled,
    nextExp: view.nextExp,
    maxUnit: view.maxUnit,
    expPercent: view.expPercent,
    isMaxLevel: view.isMaxLevel,
    capped,
  };
}

/**
 * 判定当前能否购买经验。
 *
 * 判定顺序：先看等级上限，再看金币，保证 9 级时无论金币多少都提示「已满级」。
 *
 * @param {{level:number, gold:number}} state 当前等级与金币
 * @param {Object} config 等级配置
 * @returns {{allowed:boolean, reason:string|null, message:string}}
 */
function canBuyExp(state, config) {
  if (!state || typeof state !== 'object') {
    throw new TypeError('level.canBuyExp: state 必须是对象');
  }
  const cfg = normalizeConfig(config);
  requireNonNegativeInt(state.level, 'level');
  requireNonNegativeInt(state.gold, 'gold');

  if (state.level >= cfg.maxLevel) {
    return {
      allowed: false,
      reason: BUY_EXP_DENIED.LEVEL_MAX,
      message: `已达等级上限 ${cfg.maxLevel} 级`,
    };
  }
  if (state.gold < cfg.buyExpGold) {
    return {
      allowed: false,
      reason: BUY_EXP_DENIED.GOLD_NOT_ENOUGH,
      message: `金币不足 ${cfg.buyExpGold}`,
    };
  }
  return { allowed: true, reason: null, message: '' };
}

/**
 * 计算一次购买经验后的完整结果（不落库，供服务层直接写库）。
 *
 * @param {{level:number, exp:number, gold:number}} state 当前状态
 * @param {Object} config 等级配置
 * @returns {{allowed:boolean, reason:string|null, message:string, goldCost:number, expGain:number, goldAfter:number, level:number, exp:number, leveled:number, nextExp:number|null, maxUnit:number, expPercent:number, isMaxLevel:boolean}}
 */
function buyExpOnce(state, config) {
  const cfg = normalizeConfig(config);
  const check = canBuyExp(state, cfg);
  if (!check.allowed) {
    return {
      ...check,
      goldCost: cfg.buyExpGold,
      expGain: 0,
      goldAfter: state.gold,
    };
  }

  const next = grantExp({ level: state.level, exp: state.exp }, cfg.buyExpAmount, cfg);
  return {
    allowed: true,
    reason: null,
    message: '',
    goldCost: cfg.buyExpGold,
    expGain: cfg.buyExpAmount,
    goldAfter: state.gold - cfg.buyExpGold,
    level: next.level,
    exp: next.exp,
    leveled: next.leveled,
    nextExp: next.nextExp,
    maxUnit: next.maxUnit,
    expPercent: next.expPercent,
    isMaxLevel: next.isMaxLevel,
  };
}

module.exports = {
  BUY_EXP_DENIED,
  levelState,
  grantExp,
  canBuyExp,
  buyExpOnce,
};
