'use strict';

/**
 * services/ai.service.js —— AI 对手决策（纯状态变换，不写库）
 *
 * 单机自走棋的 7 个 AI 不需要「像人一样思考」，但要遵守与真人完全相同的规则：
 * 金币、卡池、人口、三合一、等级经验都走同一套 engine / service 逻辑。
 * 决策顺序：升级 → 买牌 → 上阵，保证每回合棋盘尽量填满。
 */

const { adjustPool } = require('../engine/probability');
const { BOARD_ROWS, BOARD_COLS } = require('../config/constants');

/**
 * @param {Object} ctx 依赖（balance / heroService）
 * @returns {{decide:Function}} service
 */
function createAiService(ctx) {
  const { balance, heroService } = ctx;
  const heroById = new Map(balance.engine.heroes.map((hero) => [Number(hero.heroId), hero]));
  const levelById = new Map(balance.levels.list.map((row) => [Number(row.level), row]));
  const benchSize = balance.gameConfig.benchSize || 9;

  /**
   * 让一个 AI 玩家完成本回合准备动作。
   * @param {Object} match 对局（提供 seed / round / version）
   * @param {Object} player AI 参与者状态
   * @param {Object} rng 该 AI 本回合的随机流
   * @param {Function} makeId 实例 ID 生成器
   * @returns {{state:Object, actions:Object[]}} 新状态与行为记录
   */
  function decide(match, player, rng, makeId) {
    const actions = [];
    let gold = Number(player.gold);
    let level = Number(player.level);
    let exp = Number(player.exp);
    let pool = player.pool.slice();
    let bench = player.bench.map((unit) => ({ ...unit }));
    let board = player.board.map((unit) => ({ ...unit }));

    // 1. 存钱到 10 金后升级（与真人相同的 4 金 = 4 经验）
    if (gold >= 10 && level < 9) {
      gold -= 4;
      exp += 4;
      let leveled = 0;
      while (level < 9 && exp >= levelById.get(level).expToNext) {
        exp -= levelById.get(level).expToNext;
        level += 1;
        leveled += 1;
      }
      if (level === 9) exp = 0;
      actions.push({ action: 'level_up', level, exp, leveled });
    }

    // 2. 买 0~2 张牌（受金币与备战席限制）
    const maxBuys = Math.min(3, benchSize - bench.length, Math.floor(gold));
    for (let i = 0; i < maxBuys; i += 1) {
      const odds = balance.odds.byLevel[level] || {};
      const costWeights = [1, 2, 3, 4, 5].map((cost) => Number(odds[cost]) || 0);
      const costIndex = rng.weightedIndex(costWeights);
      if (costIndex < 0) break;
      const cost = costIndex + 1;
      if (gold < cost) break;
      const candidates = pool.filter((card) => Number(card.cost) === cost && card.remaining > 0);
      if (candidates.length === 0) break;

      const heroIndex = rng.weightedIndex(candidates.map((card) => card.remaining));
      if (heroIndex < 0) break;
      const picked = candidates[heroIndex];
      pool = adjustPool(pool, picked.heroId, -1);
      gold -= cost;
      const hero = heroById.get(Number(picked.heroId));
      bench.push({
        uid: makeId(),
        heroId: picked.heroId,
        name: hero ? hero.name : `英雄${picked.heroId}`,
        cost,
        star: 1,
      });
      actions.push({ action: 'buy', heroId: picked.heroId, cost });
    }

    // 3. 三合一
    const combined = heroService.applyCombine(bench, board, balance.engine.statsConfig, makeId);
    bench = combined.bench;
    board = combined.board;
    combined.merged.forEach((item) => actions.push({ action: 'combine', ...item }));

    // 4. 把备战席棋子补到空位（按 row/col 顺序）
    const slots = balance.levels.list.find((row) => Number(row.level) === level);
    const maxSlots = slots ? slots.maxBoardSlots : level;
    const occupied = new Set(board.map((unit) => `${unit.row},${unit.col}`));
    while (board.length < maxSlots && bench.length > 0) {
      let placed = false;
      for (let row = 0; row < BOARD_ROWS && !placed; row += 1) {
        for (let col = 0; col < BOARD_COLS && !placed; col += 1) {
          if (occupied.has(`${row},${col}`)) continue;
          const unit = bench.shift();
          board.push({ ...unit, row, col });
          occupied.add(`${row},${col}`);
          actions.push({ action: 'deploy', instanceId: unit.uid, row, col });
          placed = true;
        }
      }
      if (!placed) break;
    }

    return {
      state: {
        ...player,
        gold, level, exp, pool, bench, board,
      },
      actions,
    };
  }

  return { decide };
}

module.exports = { createAiService };
