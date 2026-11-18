'use strict';

/**
 * engine/synergy.js —— 羁绊（Synergy）统计（纯函数）
 * =============================================================================
 * 对应数据库：
 *   hero_trait(hero_id, trait_id)                        —— 英雄拥有哪些羁绊
 *   trait_level(trait_id, required_count, effect_json)   —— 档位与加成
 *   match_round_trait(hero_count, active_level, effect_json) —— 回合快照，字段与本模块输出一一对应
 *
 * 统计口径（与 schema.sql 中 match_round_trait.hero_count 注释一致）：
 *   - 只看**棋盘上**的棋子（备战席不参战，由调用方过滤好再传入）；
 *   - 同一英雄只计 1 次（2 星、3 星的同名棋子仍然只算 1 个不同英雄）；
 *   - 一个棋子可以同时贡献种族 + 职业两个羁绊；
 *   - 档位取**已满足的最高档**，不做多档叠加（2 战士只吃 2 档加成，不会叠加 1 档）。
 *
 * 输出字段刻意与前端 synergy-panel 组件、match_round_trait 表对齐：
 *   heroCount     该羁绊的不同英雄数
 *   activeLevel   已激活的最高 required_count，0 表示未激活
 *   nextLevel     下一档需要的英雄数，null 表示已满档
 *   need          距离下一档还差几个英雄，null 表示已满档
 * =============================================================================
 */

/**
 * @typedef {Object} BoardPiece 棋盘上的棋子实例（来自 match_hero + hero + hero_trait）
 * @property {number|string} heroId 英雄 id
 * @property {number} [star] 星级，羁绊统计不使用，仅透传
 * @property {number[]} [traitIds] 该英雄拥有的羁绊 id 列表
 * @property {number} [boardRow] 行（仅透传）
 * @property {number} [boardCol] 列（仅透传）
 */

/**
 * @typedef {Object} TraitTier 一个羁绊档位（一条 trait_level 记录）
 * @property {number} traitId 羁绊 id
 * @property {number} requiredCount 激活所需的不同英雄数
 * @property {Object} effect 生效加成（effect_json 解析后的对象）
 * @property {string} [description] 档位说明
 */

/**
 * @typedef {Object} TraitMeta 羁绊静态信息（一条 trait 记录）
 * @property {string} name 名称
 * @property {number} [type] 1=种族 2=职业
 * @property {number} [sortNo] 排序号
 * @property {string} [iconUrl] 图标
 */

/**
 * 校验并收集「棋子 → 羁绊」的映射，同名英雄去重。
 * @param {BoardPiece[]} board 棋盘棋子
 * @returns {{traitHeroes: Map<number, Set<string>>, heroesWithoutTrait: Array}} 统计中间结果
 */
function collectTraitHeroes(board) {
  if (!Array.isArray(board)) {
    throw new TypeError('synergy: board 必须是数组');
  }
  const traitHeroes = new Map();
  const heroesWithoutTrait = [];

  for (const piece of board) {
    if (!piece || typeof piece !== 'object') {
      throw new TypeError('synergy: board 元素必须是棋子对象');
    }
    if (piece.heroId === undefined || piece.heroId === null) {
      throw new TypeError('synergy: 棋子缺少 heroId');
    }
    const traitIds = piece.traitIds === undefined ? [] : piece.traitIds;
    if (!Array.isArray(traitIds)) {
      throw new TypeError(`synergy: 英雄 ${piece.heroId} 的 traitIds 必须是数组`);
    }

    const uniqueTraitIds = [...new Set(traitIds)];
    if (uniqueTraitIds.length === 0) {
      heroesWithoutTrait.push(piece);
      continue;
    }
    for (const traitId of uniqueTraitIds) {
      const key = Number(traitId);
      if (!Number.isInteger(key)) {
        throw new TypeError(`synergy: 羁绊 id 必须是整数，收到 ${traitId}`);
      }
      const heroes = traitHeroes.get(key) || new Set();
      // 同一英雄的不同星级只算 1 个，用 heroId 字符串作为集合键
      heroes.add(String(piece.heroId));
      traitHeroes.set(key, heroes);
    }
  }

  return { traitHeroes, heroesWithoutTrait };
}

/**
 * 把 trait_level 记录按羁绊分组，并按 requiredCount 升序排列。
 * @param {TraitTier[]} tiers 全部档位
 * @returns {Map<number, TraitTier[]>} 羁绊 id → 档位数组（升序）
 * @throws {RangeError} 同一羁绊出现重复档位（对应 uk_trait_required 唯一索引）
 */
function groupTiersByTrait(tiers) {
  if (!Array.isArray(tiers)) {
    throw new TypeError('synergy: traitLevels 必须是数组');
  }
  const grouped = new Map();

  for (const tier of tiers) {
    if (!tier || typeof tier !== 'object') {
      throw new TypeError('synergy: traitLevels 元素必须是对象');
    }
    if (!Number.isInteger(tier.traitId)) {
      throw new TypeError(`synergy: traitId 必须是整数，收到 ${tier.traitId}`);
    }
    if (!Number.isInteger(tier.requiredCount) || tier.requiredCount < 1) {
      throw new RangeError(`synergy: requiredCount 必须是 >=1 的整数，收到 ${tier.requiredCount}`);
    }
    const list = grouped.get(tier.traitId) || [];
    if (list.some((item) => item.requiredCount === tier.requiredCount)) {
      throw new RangeError(
        `synergy: 羁绊 ${tier.traitId} 存在重复档位 requiredCount=${tier.requiredCount}`,
      );
    }
    list.push({
      traitId: tier.traitId,
      requiredCount: tier.requiredCount,
      effect: tier.effect && typeof tier.effect === 'object' ? tier.effect : {},
      description: tier.description,
    });
    grouped.set(tier.traitId, list);
  }

  for (const list of grouped.values()) {
    list.sort((a, b) => a.requiredCount - b.requiredCount);
  }
  return grouped;
}

/**
 * 计算羁绊激活情况。
 *
 * @param {BoardPiece[]} board 棋盘棋子（只传 location=1 的棋子）
 * @param {TraitTier[]} traitLevels 全部羁绊档位配置
 * @param {Object<number, TraitMeta>} [traitMeta] 羁绊静态信息（名称/类型/排序）
 * @returns {{
 *   list: Array<Object>,       // 全部出现的羁绊（含未激活），已排序
 *   active: Array<Object>,     // 仅已激活的羁绊
 *   byTraitId: Object,         // 羁绊 id → 统计结果，便于 O(1) 取用
 *   activeCount: number,       // 已激活羁绊数量
 *   heroesWithoutTrait: Array  // 没有任何羁绊的棋子（配置漏填告警用）
 * }}
 */
function computeTraits(board, traitLevels, traitMeta = {}) {
  const { traitHeroes, heroesWithoutTrait } = collectTraitHeroes(board);
  const grouped = groupTiersByTrait(traitLevels);

  // 棋子身上出现了但配置表里没有的羁绊也要列出来，否则前端会「悄悄丢羁绊」
  const allTraitIds = new Set([...grouped.keys(), ...traitHeroes.keys()]);

  const list = [];
  for (const traitId of allTraitIds) {
    const tiers = grouped.get(traitId) || [];
    const heroes = traitHeroes.get(traitId) || new Set();
    const heroCount = heroes.size;

    // 已满足的最高档
    let activeTier = null;
    for (const tier of tiers) {
      if (heroCount >= tier.requiredCount) activeTier = tier;
    }
    // 下一档（第一个未满足的档位）
    const nextTier = tiers.find((tier) => tier.requiredCount > heroCount) || null;

    const meta = traitMeta[traitId] || {};
    list.push({
      traitId,
      name: meta.name,
      type: meta.type,
      iconUrl: meta.iconUrl,
      heroCount,
      heroIds: [...heroes],
      activeLevel: activeTier ? activeTier.requiredCount : 0,
      effect: activeTier ? activeTier.effect : null,
      nextLevel: nextTier ? nextTier.requiredCount : null,
      need: nextTier ? nextTier.requiredCount - heroCount : null,
      // 该羁绊是否在 trait_level 中有配置（没有配置说明数据不完整，后台应补齐）
      configured: tiers.length > 0,
      maxLevel: tiers.length ? tiers[tiers.length - 1].requiredCount : null,
      description: activeTier ? activeTier.description : undefined,
    });
  }

  // 排序：已激活优先 → 激活档位高优先 → 英雄数多优先 → sortNo → traitId
  list.sort((a, b) => {
    if (a.activeLevel !== b.activeLevel) return b.activeLevel - a.activeLevel;
    if (a.heroCount !== b.heroCount) return b.heroCount - a.heroCount;
    const sortA = (traitMeta[a.traitId] && traitMeta[a.traitId].sortNo) || 0;
    const sortB = (traitMeta[b.traitId] && traitMeta[b.traitId].sortNo) || 0;
    if (sortA !== sortB) return sortA - sortB;
    return a.traitId - b.traitId;
  });

  const byTraitId = {};
  for (const item of list) byTraitId[item.traitId] = item;

  return {
    list,
    active: list.filter((item) => item.activeLevel > 0),
    byTraitId,
    activeCount: list.filter((item) => item.activeLevel > 0).length,
    heroesWithoutTrait,
  };
}

/**
 * 抽取「已激活羁绊 → 生效加成」映射，供 stats.js 结算属性时直接查表。
 * @param {Array<Object>} traitList computeTraits 返回的 list（或 active）
 * @returns {Map<number, {traitId:number, activeLevel:number, effect:Object}>} 羁绊 id → 生效加成
 */
function collectActiveEffects(traitList) {
  if (!Array.isArray(traitList)) {
    throw new TypeError('synergy: traitList 必须是数组');
  }
  const effects = new Map();
  for (const item of traitList) {
    if (!item || item.activeLevel <= 0 || !item.effect) continue;
    effects.set(item.traitId, {
      traitId: item.traitId,
      activeLevel: item.activeLevel,
      effect: item.effect,
    });
  }
  return effects;
}

module.exports = {
  computeTraits,
  collectActiveEffects,
  collectTraitHeroes,
  groupTiersByTrait,
};
