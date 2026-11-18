'use strict';

/**
 * services/catalog.service.js —— 只读图鉴与配置（B 组接口）。
 * 数据源是 balance.loader 的内存快照，不查库；后台改配置后 refreshBalance 即可生效。
 */

const { fail } = require('../utils/errors');

/**
 * @param {{balance:Object}} ctx 依赖
 * @returns {Object} service
 */
function createCatalogService(ctx) {
  const { balance } = ctx;
  const heroById = new Map(balance.engine.heroes.map((hero) => [Number(hero.heroId), hero]));
  const traitById = new Map(balance.traits.list.map((trait) => [Number(trait.traitId || trait.id), trait]));
  const levelsByTrait = new Map();
  for (const level of balance.traitLevels.list) {
    const id = Number(level.traitId);
    if (!levelsByTrait.has(id)) levelsByTrait.set(id, []);
    levelsByTrait.get(id).push(level);
  }

  return {
    configBalance: () => balance.gameConfig,
    configLevels: () => balance.levels.list,
    configOdds: () => ({
      matrix: balance.odds.byLevel,
      totals: Object.fromEntries(
        Object.entries(balance.odds.byLevel).map(([level, odds]) => [
          level,
          Object.values(odds).reduce((sum, value) => sum + Number(value), 0),
        ]),
      ),
    }),
    configCardPool: () => ({
      rows: Object.entries(balance.cardPool.byCost).map(([cost, poolSize]) => ({
        cost: Number(cost),
        poolSize,
      })),
      total: balance.cardPool.total,
    }),

    heroes(filters = {}) {
      const list = balance.engine.heroes.filter((hero) => {
        if (filters.cost && Number(hero.cost) !== Number(filters.cost)) return false;
        if (filters.enabled !== undefined && Number(hero.enabled) !== Number(filters.enabled)) return false;
        return true;
      });
      const page = Number(filters.page) || 1;
      const pageSize = Number(filters.pageSize) || 20;
      return {
        list: list.slice((page - 1) * pageSize, page * pageSize),
        total: list.length,
        page,
        pageSize,
      };
    },

    hero(id) {
      const hero = heroById.get(Number(id));
      if (!hero) throw fail.unit(`hero:${id}`);
      return {
        ...hero,
        traitLevels: (hero.traitIds || []).map((traitId) => ({
          traitId,
          name: traitById.get(Number(traitId)) ? traitById.get(Number(traitId)).name : null,
          levels: levelsByTrait.get(Number(traitId)) || [],
        })),
      };
    },

    traits(type) {
      const list = balance.traits.list.filter((trait) => {
        if (!type) return true;
        return Number(trait.type) === Number(type);
      });
      return { list, total: list.length };
    },

    trait(id) {
      const trait = traitById.get(Number(id));
      if (!trait) throw fail.unit(`trait:${id}`);
      const heroIds = balance.heroTraits.get(Number(id)) || [];
      return {
        ...trait,
        levels: levelsByTrait.get(Number(id)) || [],
        heroes: heroIds.map((heroId) => {
          const hero = heroById.get(Number(heroId));
          return hero ? { heroId: hero.heroId, name: hero.name, cost: hero.cost } : null;
        }).filter(Boolean),
      };
    },
  };
}

module.exports = { createCatalogService };
