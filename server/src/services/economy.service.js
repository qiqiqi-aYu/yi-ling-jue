'use strict';

/**
 * services/economy.service.js —— 经济只读服务 + 收入预估
 * 所有计算都调用 engine/economy.js，服务只负责取数与组装。
 */

const { calcRoundIncome, calcInterest, calcSellRefund, estimateIncome } = require('../engine/economy');
const { fail } = require('../utils/errors');

/**
 * @param {{dao:Object, balance:Object}} ctx 依赖
 * @returns {Object} service
 */
function createEconomyService(ctx) {
  const { dao, balance } = ctx;

  /**
   * match_player.win_streak 用单列正负号表示连胜/连败，引擎要求拆成两个非负整数。
   * @param {number} streak 有符号连击
   * @returns {{winStreak:number, loseStreak:number}} 引擎入参
   */
  const streaksOf = (streak) => {
    const value = Number(streak) || 0;
    return { winStreak: Math.max(0, value), loseStreak: Math.max(0, -value) };
  };

  return {
    /**
     * 当前金币、等级与下回合收入预估。
     * @param {number} matchId 对局 ID
     * @param {number} playerIndex 座位号
     * @returns {Promise<Object>} 经济视图
     */
    async getEconomy(matchId, playerIndex) {
      const player = await dao.getPlayer(matchId, playerIndex);
      if (!player) throw fail.unit(`player:${playerIndex}`);
      const economyConfig = balance.engine.economyConfig;
      const streaks = streaksOf(player.win_streak);
      const income = calcRoundIncome({ goldBefore: player.gold, ...streaks }, economyConfig);
      const estimate = estimateIncome
        ? estimateIncome({ goldBefore: player.gold, ...streaks }, economyConfig)
        : null;

      return {
        gold: player.gold,
        level: player.level,
        exp: player.exp,
        winStreak: player.win_streak,
        interestIfEndNow: calcInterest(player.gold, economyConfig),
        nextRoundIncome: {
          base: income.base,
          interest: income.interest,
          streak: income.streakBonus,
          total: income.total,
        },
        estimate: estimate || undefined,
        config: economyConfig,
      };
    },

    /**
     * 退款金额（给出售接口复用）。
     * @param {number} cost 费用
     * @param {number} star 星级
     * @returns {number} 退款金币
     */
    refund(cost, star) {
      return calcSellRefund({ cost, star }, balance.engine.economyConfig).refund;
    },
  };
}

module.exports = { createEconomyService };
