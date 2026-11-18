'use strict';

/**
 * services/trait.service.js —— 实时羁绊统计与生效加成。
 * 直接复用 engine/synergy.js，服务只负责把「棋子实例 + 英雄白板」组装成引擎入参。
 */

const { computeTraits, collectActiveEffects } = require('../engine/synergy');
const { fail } = require('../utils/errors');

/**
 * @param {Object} ctx 依赖
 * @returns {Object} service
 */
function createTraitService(ctx) {
  const { dao, balance } = ctx;
  const heroById = new Map(balance.engine.heroes.map((hero) => [Number(hero.heroId), hero]));

  /**
   * 把棋盘实例变成带羁绊的引擎棋子。
   * @param {Object[]} board 棋盘实例
   * @returns {Object[]} 引擎棋子
   */
  const toUnits = (board) =>
    board.map((unit) => {
      const hero = heroById.get(Number(unit.heroId));
      return {
        ...hero,
        ...unit,
        heroId: Number(unit.heroId),
        traitIds: hero ? hero.traitIds : [],
        name: hero ? hero.name : unit.name,
      };
    });

  return {
    /** 组装引擎棋子（battle service 也复用） */
    toUnits,

    /**
     * 羁绊统计。
     * @param {number} matchId 对局
     * @param {number} playerIndex 座位
     * @returns {Promise<Object>} {list, active, activeCount, effects}
     */
    async getTraits(matchId, playerIndex) {
      const player = await dao.getPlayer(matchId, playerIndex);
      if (!player) throw fail.unit(`player:${playerIndex}`);
      const result = computeTraits(
        toUnits(player.board),
        balance.engine.traitLevels,
        balance.engine.traitMeta,
      );
      return {
        ...result,
        effects: Object.fromEntries(collectActiveEffects(result.list)),
      };
    },
  };
}

module.exports = { createTraitService };
