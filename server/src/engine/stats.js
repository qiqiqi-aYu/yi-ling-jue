'use strict';

/**
 * engine/stats.js —— 英雄最终战斗属性结算（纯函数）
 * =============================================================================
 * 结算链路（顺序固定，顺序不同结果就不同）：
 *   1 星白板（hero.base_*） → 星级倍率（game_config.star_*_multiplier）
 *   → 羁绊「自身加成」（只作用于拥有该羁绊的棋子）
 *   → 队伍级加成（乐伶 allyAsPercent：本方全体攻速）
 *   → 敌方减益（阵法师 enemyAsSlowPercent：对手全体攻速）
 *
 * 羁绊 effect_json 词表见《弈灵诀-数据库设计说明书》§7.3，两套写法并存：
 *
 *  ① 弈灵诀主词表（**整数百分数**，解析时统一 /100，落库即 12 表示 12%）
 *     atkPercent / hpPercent / critRate / critDmgPercent / cdReduce / healPercent
 *     skillDmgPercent / spellLifesteal / summonAtkPercent / summonHpPercent   → 自身
 *     lowHpDmgPercent（配合 hpThreshold）                                      → 自身·条件触发
 *     reviveChance（小数）/ reviveHpPercent                                     → 自身·阵亡触发
 *     allyAsPercent                                                           → 本方全体攻速
 *     enemyAsSlowPercent                                                      → 对手全体减速
 *
 *  ② 兼容旧词表（**小数**，阶段一迁移前的小样本配置仍在用）
 *     hp / attack / armor / magic_resist / skill_power / heal / mana_per_attack（加法）
 *     hp_percent / attack_percent / attack_speed（小数比例）
 *     dodge / crit_rate（小数概率）
 *     enemy_armor_reduce / enemy_magic_resist_reduce（光环）
 *
 * ★ 12 → 0.12 的换算是本模块的职责，绝不能在 DB 或 loader 里偷偷做两次，
 *   否则会出现「12 倍数值」这类最难查的错误（设计说明书 §7.3 已明确）。
 * ★ 未知 key 一律抛错：后台用 JsonEditor 改配置时写错一个字母，必须启动即失败，
 *   而不是加成静默失效。
 * =============================================================================
 */

/**
 * @typedef {Object} StatsConfig
 * @property {number} starHpMultiplier      star_hp_multiplier      每升 1 星的生命倍率
 * @property {number} starAttackMultiplier  star_attack_multiplier  每升 1 星的攻击倍率
 * @property {number} [maxStar]             max_star               最高星级（可选，仅做入参校验）
 */

/* ------------------------------------------------------------------ *
 * 词表定义
 * ------------------------------------------------------------------ */

/** 旧词表：加法加成（effect 键 → 属性键），数值即真实值 */
const FLAT_EFFECT_KEYS = {
  hp: 'hp',
  attack: 'attack',
  armor: 'armor',
  magic_resist: 'magicResist',
  magicResist: 'magicResist',
  skill_power: 'skillPower',
  skillPower: 'skillPower',
  heal: 'heal',
  mana_per_attack: 'manaPerAttack',
  manaPerAttack: 'manaPerAttack',
};

/** 旧词表：比例加成（小数），相加后作用于基数
 *  注意：不要在这里登记 hpPercent / critRate 这类驼峰名——
 *  它们属于弈灵诀主词表（整数百分数），登记会造成「30 被当成 30 倍」的事故。
 */
const RATIO_EFFECT_KEYS = {
  hp_percent: 'hpPercent',
  attack_percent: 'attackPercent',
  attackPercent: 'attackPercent',
  attack_speed: 'attackSpeed',
  attackSpeed: 'attackSpeed',
};

/** 旧词表：概率型（小数），相加后夹在 [0,1] */
const CHANCE_EFFECT_KEYS = {
  dodge: 'dodge',
  crit_rate: 'critRate',
};

/** 旧词表：光环（作用于敌方护甲 / 魔抗） */
const AURA_EFFECT_KEYS = {
  enemy_armor_reduce: 'enemyArmorReduce',
  enemyArmorReduce: 'enemyArmorReduce',
  enemy_magic_resist_reduce: 'enemyMagicResistReduce',
  enemyMagicResistReduce: 'enemyMagicResistReduce',
};

/** 弈灵诀主词表：整数百分数 → 比例，作用于自身（critRate 走概率通道以便夹取） */
const PERCENT_SELF_KEYS = {
  atkPercent: 'attackPercent',
  hpPercent: 'hpPercent',
  critDmgPercent: 'critDamagePercent',
  cdReduce: 'cdReduce',
  healPercent: 'healPercent',
  skillDmgPercent: 'skillDmgPercent',
  spellLifesteal: 'spellLifesteal',
  summonAtkPercent: 'summonAttackPercent',
  summonHpPercent: 'summonHpPercent',
};

/** 弈灵诀主词表：本身就是小数，不再 /100 */
const DECIMAL_SELF_KEYS = {
  hpThreshold: 'hpThreshold',
  reviveChance: 'reviveChance',
};

/** 弈灵诀主词表：条件 / 触发类（整数百分数 → 比例），战斗过程中判定 */
const DYNAMIC_PERCENT_KEYS = {
  lowHpDmgPercent: 'lowHpDamagePercent',
  reviveHpPercent: 'reviveHpPercent',
};

/** 弈灵诀主词表：队伍级（本方全体），整数百分数 → 比例 */
const TEAM_PERCENT_KEYS = {
  allyAsPercent: 'allyAttackSpeedPercent',
};

/** 弈灵诀主词表：敌方级（对手全体），整数百分数 → 比例 */
const ENEMY_PERCENT_KEYS = {
  enemyAsSlowPercent: 'enemyAttackSpeedSlowPercent',
};

/** 整数百分数 → 比例的小工具（12 → 0.12） */
const PERCENT_BASE = 100;

/* ------------------------------------------------------------------ *
 * 基础工具
 * ------------------------------------------------------------------ */

/**
 * 读取并校验倍率配置。
 * @param {StatsConfig} config 属性配置
 * @param {string} key 键名
 * @returns {number} 倍率
 */
function requireMultiplier(config, key) {
  const value = config ? config[key] : undefined;
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new TypeError(`stats: 配置项 ${key} 必须是正数，收到 ${value}`);
  }
  return value;
}

/**
 * 保留 4 位小数，避免 0.15 + 0.1 这类浮点噪声污染战报与单测断言。
 * @param {number} value 原值
 * @returns {number} 处理后的值
 */
function round4(value) {
  return Math.round(value * 1e4) / 1e4;
}

/**
 * 把任意数值夹到 [min, max]。
 * @param {number} value 原值
 * @param {number} min 下界
 * @param {number} max 上界
 * @returns {number} 夹取后的值
 */
function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

/**
 * 新增一个加成项（同键累加）。
 * @param {Object} target 目标桶
 * @param {string} key 属性键
 * @param {number} value 数值
 * @returns {void}
 */
function accumulate(target, key, value) {
  target[key] = (target[key] || 0) + value;
}

/* ------------------------------------------------------------------ *
 * 星级
 * ------------------------------------------------------------------ */

/**
 * 应用星级加成。
 *
 * 公式（指数成长）：hp = FLOOR(base_hp × starHpMultiplier^(star-1))，攻击同理。
 * 举例（1.8 倍率）：600 血 / 55 攻 → 2 星 1080 / 99 → 3 星 1944 / 178。
 * 攻速、射程不随星级变化（本项目规则）。
 *
 * @param {Object} hero 英雄白板数据（baseHp / baseAttack 等）
 * @param {number} star 星级 1~maxStar
 * @param {StatsConfig} config 属性配置
 * @returns {Object} 含 hp / attack 的新对象（不修改入参）
 */
function applyStar(hero, star, config) {
  if (!hero || typeof hero !== 'object') {
    throw new TypeError('stats.applyStar: hero 必须是对象');
  }
  if (!Number.isInteger(star) || star < 1) {
    throw new RangeError(`stats: star 必须是 >=1 的整数，收到 ${star}`);
  }
  if (config && Number.isInteger(config.maxStar) && star > config.maxStar) {
    throw new RangeError(`stats: star 不能超过 maxStar(${config.maxStar})，收到 ${star}`);
  }
  if (!Number.isInteger(hero.baseHp) || hero.baseHp < 0) {
    throw new TypeError(`stats: hero.baseHp 必须是非负整数，收到 ${hero.baseHp}`);
  }
  if (!Number.isInteger(hero.baseAttack) || hero.baseAttack < 0) {
    throw new TypeError(`stats: hero.baseAttack 必须是非负整数，收到 ${hero.baseAttack}`);
  }

  const hpMultiplier = requireMultiplier(config, 'starHpMultiplier');
  const attackMultiplier = requireMultiplier(config, 'starAttackMultiplier');

  return {
    ...hero,
    star,
    hp: Math.max(1, Math.floor(hero.baseHp * Math.pow(hpMultiplier, star - 1))),
    attack: Math.max(1, Math.floor(hero.baseAttack * Math.pow(attackMultiplier, star - 1))),
  };
}

/* ------------------------------------------------------------------ *
 * effect_json 解析
 * ------------------------------------------------------------------ */

/**
 * 把一组 effect_json 解析成分类加成包。
 *
 * @param {Object} effect 羁绊加成对象（如 {"atkPercent":12} 或 {armor:30}）
 * @returns {{
 *   flat: Object, ratio: Object, chance: Object,
 *   dynamic: Object, team: Object, enemy: Object, aura: Object
 * }} 分类后的加成
 * @throws {RangeError} 出现未知键（防止配置写错导致加成静默失效）
 */
function parseEffect(effect) {
  const result = { flat: {}, ratio: {}, chance: {}, dynamic: {}, team: {}, enemy: {}, aura: {} };
  if (effect === undefined || effect === null) return result;
  if (typeof effect !== 'object' || Array.isArray(effect)) {
    throw new TypeError('stats: effect 必须是对象（effect_json 解析结果）');
  }

  for (const key of Object.keys(effect)) {
    const value = effect[key];
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new TypeError(`stats: 羁绊加成 ${key} 必须是有限数值，收到 ${value}`);
    }

    if (Object.prototype.hasOwnProperty.call(FLAT_EFFECT_KEYS, key)) {
      accumulate(result.flat, FLAT_EFFECT_KEYS[key], value);
    } else if (Object.prototype.hasOwnProperty.call(RATIO_EFFECT_KEYS, key)) {
      accumulate(result.ratio, RATIO_EFFECT_KEYS[key], value);
    } else if (Object.prototype.hasOwnProperty.call(CHANCE_EFFECT_KEYS, key)) {
      accumulate(result.chance, CHANCE_EFFECT_KEYS[key], value);
    } else if (Object.prototype.hasOwnProperty.call(AURA_EFFECT_KEYS, key)) {
      accumulate(result.aura, AURA_EFFECT_KEYS[key], value);
    } else if (Object.prototype.hasOwnProperty.call(PERCENT_SELF_KEYS, key)) {
      accumulate(result.ratio, PERCENT_SELF_KEYS[key], value / PERCENT_BASE);
    } else if (key === 'critRate') {
      // 弈灵诀词表：整数百分数，走概率通道（相加后夹在 [0,1]）
      accumulate(result.chance, 'critRate', value / PERCENT_BASE);
    } else if (Object.prototype.hasOwnProperty.call(DECIMAL_SELF_KEYS, key)) {
      accumulate(result.dynamic, DECIMAL_SELF_KEYS[key], value);
    } else if (Object.prototype.hasOwnProperty.call(DYNAMIC_PERCENT_KEYS, key)) {
      accumulate(result.dynamic, DYNAMIC_PERCENT_KEYS[key], value / PERCENT_BASE);
    } else if (Object.prototype.hasOwnProperty.call(TEAM_PERCENT_KEYS, key)) {
      accumulate(result.team, TEAM_PERCENT_KEYS[key], value / PERCENT_BASE);
    } else if (Object.prototype.hasOwnProperty.call(ENEMY_PERCENT_KEYS, key)) {
      accumulate(result.enemy, ENEMY_PERCENT_KEYS[key], value / PERCENT_BASE);
    } else {
      throw new RangeError(
        `stats: 未知的羁绊加成键 "${key}"（可用键：${[
          ...Object.keys(FLAT_EFFECT_KEYS),
          ...Object.keys(RATIO_EFFECT_KEYS),
          ...Object.keys(CHANCE_EFFECT_KEYS),
          ...Object.keys(AURA_EFFECT_KEYS),
          ...Object.keys(PERCENT_SELF_KEYS),
          'critRate',
          ...Object.keys(DECIMAL_SELF_KEYS),
          ...Object.keys(DYNAMIC_PERCENT_KEYS),
          ...Object.keys(TEAM_PERCENT_KEYS),
          ...Object.keys(ENEMY_PERCENT_KEYS),
        ].join(' / ')}）`,
      );
    }
  }

  return result;
}

/**
 * 把分类后的加成应用到「已算完星级」的属性上。
 * 顺序：加法 → 概率夹取 → 百分比（乘法最后做，保证 +12% 攻击作用于最终攻击）
 *
 * @param {Object} unit 已应用星级的属性
 * @param {Object} buff parseEffect 的分类结果
 * @returns {Object} 新属性对象
 */
function applyParsedBuff(unit, buff) {
  const flat = buff.flat;
  const ratio = buff.ratio;
  const chance = buff.chance;

  const baseHp = unit.hp + (flat.hp || 0);
  const baseAttack = unit.attack + (flat.attack || 0);

  return {
    ...unit,
    hp: Math.max(1, Math.floor(baseHp * (1 + (ratio.hpPercent || 0)))),
    attack: Math.max(1, Math.floor(baseAttack * (1 + (ratio.attackPercent || 0)))),
    armor: Math.max(0, Math.floor((unit.armor || 0) + (flat.armor || 0))),
    magicResist: Math.max(0, Math.floor((unit.magicResist || 0) + (flat.magicResist || 0))),
    attackSpeed: round4(
      Math.max(0, (unit.attackSpeed || 0) * (1 + (ratio.attackSpeed || 0))),
    ),
    dodge: clamp(round4((unit.dodge || 0) + (chance.dodge || 0)), 0, 1),
    critRate: clamp(round4((unit.critRate || 0) + (chance.critRate || 0)), 0, 1),
    critDamagePercent: round4((unit.critDamagePercent || 0) + (ratio.critDamagePercent || 0)),
    cdReduce: clamp(round4((unit.cdReduce || 0) + (ratio.cdReduce || 0)), 0, 1),
    healPercent: round4((unit.healPercent || 0) + (ratio.healPercent || 0)),
    skillDmgPercent: round4((unit.skillDmgPercent || 0) + (ratio.skillDmgPercent || 0)),
    spellLifesteal: round4((unit.spellLifesteal || 0) + (ratio.spellLifesteal || 0)),
    summonAttackPercent: round4(
      (unit.summonAttackPercent || 0) + (ratio.summonAttackPercent || 0),
    ),
    summonHpPercent: round4((unit.summonHpPercent || 0) + (ratio.summonHpPercent || 0)),
    skillPower: Math.max(0, Math.floor((unit.skillPower || 0) + (flat.skillPower || 0))),
    heal: Math.max(0, Math.floor((unit.heal || 0) + (flat.heal || 0))),
    manaPerAttack: Math.max(
      0,
      Math.floor((unit.manaPerAttack || 0) + (flat.manaPerAttack || 0)),
    ),
  };
}

/**
 * 结算单个棋子：「星级 → 自身羁绊加成 → 条件/触发类动态字段」。
 *
 * @param {Object} hero 英雄白板 + 实例信息（star / traitIds）
 * @param {Map<number, {effect:Object}>|Object<string|number, {effect:Object}>} activeEffects
 *        computeTraits + collectActiveEffects 得到的「羁绊 id → 生效加成」
 * @param {StatsConfig} config 属性配置
 * @returns {Object} 最终属性（含 appliedTraitIds 与 dynamic，便于战报与单测核对）
 */
function resolveUnitStats(hero, activeEffects, config) {
  const withStar = applyStar(hero, hero.star, config);
  const traits = hero.traitIds || [];
  if (!Array.isArray(traits)) {
    throw new TypeError(`stats: 英雄 ${hero.heroId} 的 traitIds 必须是数组`);
  }

  const getEffect = (traitId) => {
    if (!activeEffects) return undefined;
    if (typeof activeEffects.get === 'function') return activeEffects.get(traitId);
    return activeEffects[traitId];
  };

  let unit = {
    ...withStar,
    dodge: withStar.dodge || 0,
    critRate: withStar.critRate || 0,
    heal: withStar.heal || 0,
    manaPerAttack: withStar.manaPerAttack || 0,
  };
  const appliedTraitIds = [];
  const dynamic = {
    lowHpDamagePercent: 0,
    hpThreshold: 0,
    reviveChance: 0,
    reviveHpPercent: 0,
  };

  for (const traitId of traits) {
    const active = getEffect(traitId);
    if (!active || !active.effect) continue;
    const parsed = parseEffect(active.effect);
    unit = applyParsedBuff(unit, parsed);
    dynamic.lowHpDamagePercent += parsed.dynamic.lowHpDamagePercent || 0;
    dynamic.reviveHpPercent = Math.max(
      dynamic.reviveHpPercent,
      parsed.dynamic.reviveHpPercent || 0,
    );
    // 概率类累加后夹取；阈值类同羁绊内一致，取最后写入值
    if (parsed.dynamic.reviveChance) {
      dynamic.reviveChance = clamp(dynamic.reviveChance + parsed.dynamic.reviveChance, 0, 1);
    }
    if (parsed.dynamic.hpThreshold) dynamic.hpThreshold = parsed.dynamic.hpThreshold;
    appliedTraitIds.push(traitId);
  }

  return { ...unit, appliedTraitIds, dynamic };
}

/**
 * 结算一整队的属性。
 *
 * 返回三类队伍级结果，供 combat 层使用：
 *   aura       旧词表光环（敌方减甲 / 减魔抗），由 applyEnemyAura 施加给对手
 *   teamBuff   本方全体加成（乐伶 allyAsPercent → 攻速）
 *   enemyDebuff 施加给对手的减益（阵法师 enemyAsSlowPercent → 攻速）
 *
 * @param {Object[]} units 棋子列表（每项含 star / traitIds / baseHp 等）
 * @param {Map|Object} activeEffects 已激活羁绊（collectActiveEffects 的返回值）
 * @param {StatsConfig} config 属性配置
 * @returns {{units:Object[], aura:Object, teamBuff:Object, enemyDebuff:Object}} 结算结果
 */
function resolveTeamStats(units, activeEffects, config) {
  if (!Array.isArray(units)) {
    throw new TypeError('stats: units 必须是数组');
  }

  const aura = { enemyArmorReduce: 0, enemyMagicResistReduce: 0 };
  const teamBuff = { allyAttackSpeedPercent: 0 };
  const enemyDebuff = { enemyAttackSpeedSlowPercent: 0 };
  const seenTraits = new Set();

  const collect = (active, traitId) => {
    if (!active || !active.effect || seenTraits.has(traitId)) return;
    seenTraits.add(traitId);
    const parsed = parseEffect(active.effect);
    aura.enemyArmorReduce += parsed.aura.enemyArmorReduce || 0;
    aura.enemyMagicResistReduce += parsed.aura.enemyMagicResistReduce || 0;
    teamBuff.allyAttackSpeedPercent += parsed.team.allyAttackSpeedPercent || 0;
    enemyDebuff.enemyAttackSpeedSlowPercent += parsed.enemy.enemyAttackSpeedSlowPercent || 0;
  };

  if (activeEffects) {
    if (typeof activeEffects.forEach === 'function' && typeof activeEffects.get === 'function') {
      activeEffects.forEach((value, key) => collect(value, key));
    } else {
      Object.keys(activeEffects).forEach((key) => collect(activeEffects[key], Number(key)));
    }
  }

  // 队伍级攻速加成作用于本方全体（乘算，最后统一 round4）
  const allySpeed = teamBuff.allyAttackSpeedPercent;
  const resolved = units.map((unit) => {
    const resolvedUnit = resolveUnitStats(unit, activeEffects, config);
    if (!allySpeed) return resolvedUnit;
    return {
      ...resolvedUnit,
      attackSpeed: round4(resolvedUnit.attackSpeed * (1 + allySpeed)),
    };
  });

  return { units: resolved, aura, teamBuff, enemyDebuff };
}

/**
 * 把一方的光环作用到另一方（敌方减甲 / 减魔抗），护甲与魔抗夹在 >=0。
 *
 * @param {Object[]} units 被作用的棋子
 * @param {{enemyArmorReduce?:number, enemyMagicResistReduce?:number}} aura 对方光环
 * @returns {Object[]} 新棋子数组（不修改入参）
 */
function applyEnemyAura(units, aura) {
  if (!Array.isArray(units)) {
    throw new TypeError('stats: units 必须是数组');
  }
  if (!aura) return units.map((unit) => ({ ...unit }));

  const armorReduce = Math.max(0, Number(aura.enemyArmorReduce) || 0);
  const mrReduce = Math.max(0, Number(aura.enemyMagicResistReduce) || 0);

  return units.map((unit) => ({
    ...unit,
    armor: Math.max(0, (unit.armor || 0) - armorReduce),
    magicResist: Math.max(0, (unit.magicResist || 0) - mrReduce),
  }));
}

/**
 * 把敌方的减速效果作用到本方（阵法师 enemyAsSlowPercent），攻速不会降到 0 以下。
 *
 * @param {Object[]} units 被减速的棋子
 * @param {{enemyAttackSpeedSlowPercent?:number}} debuff 对方减益
 * @returns {Object[]} 新棋子数组（不修改入参）
 */
function applyEnemySlow(units, debuff) {
  if (!Array.isArray(units)) {
    throw new TypeError('stats: units 必须是数组');
  }
  if (!debuff) return units.map((unit) => ({ ...unit }));

  const slow = clamp(Number(debuff.enemyAttackSpeedSlowPercent) || 0, 0, 1);
  if (slow === 0) return units.map((unit) => ({ ...unit }));

  return units.map((unit) => ({
    ...unit,
    attackSpeed: round4(Math.max(0, (unit.attackSpeed || 0) * (1 - slow))),
  }));
}

/**
 * 一场对局的双方阵容属性结算（battle.service 直接调用这一个函数即可）。
 *
 * 步骤：双方各自算星级 + 自身羁绊 + 本方队伍增益 → 互相施加光环与减速。
 *
 * @param {{
 *   humanUnits: Object[],
 *   opponentUnits: Object[],
 *   humanEffects: Map|Object,
 *   opponentEffects: Map|Object,
 *   config: StatsConfig
 * }} input 入参
 * @returns {{
 *   human: Object[], opponent: Object[],
 *   humanAura: Object, opponentAura: Object,
 *   humanTeamBuff: Object, opponentTeamBuff: Object
 * }} 结算结果
 */
function resolveBattleStats(input) {
  if (!input || typeof input !== 'object') {
    throw new TypeError('stats.resolveBattleStats: 入参必须是对象');
  }
  const { humanUnits, opponentUnits, humanEffects, opponentEffects, config } = input;

  const humanSide = resolveTeamStats(humanUnits, humanEffects, config);
  const opponentSide = resolveTeamStats(opponentUnits, opponentEffects, config);

  // 我方亡灵光环 / 阵法师减速削弱对手，对手的同样削弱我方
  const human = applyEnemySlow(applyEnemyAura(humanSide.units, opponentSide.aura), opponentSide.enemyDebuff);
  const opponent = applyEnemySlow(
    applyEnemyAura(opponentSide.units, humanSide.aura),
    humanSide.enemyDebuff,
  );

  return {
    human,
    opponent,
    humanAura: humanSide.aura,
    opponentAura: opponentSide.aura,
    humanTeamBuff: humanSide.teamBuff,
    opponentTeamBuff: opponentSide.teamBuff,
  };
}

module.exports = {
  applyStar,
  parseEffect,
  resolveUnitStats,
  resolveTeamStats,
  applyEnemyAura,
  applyEnemySlow,
  resolveBattleStats,
};
