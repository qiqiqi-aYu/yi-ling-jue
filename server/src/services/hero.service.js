'use strict';

/**
 * services/hero.service.js —— 棋子实例：三合一升星、出售退款、卡池归还。
 * 本服务不直接写库，提供纯状态变换函数，由 shop/battle service 在事务内调用。
 */

const { calcSellRefund } = require('../engine/economy');
const { adjustPool } = require('../engine/probability');
const { fail } = require('../utils/errors');

/**
 * 三合一升星：站在棋盘或备战席上的同名同星棋子凑够 3 个即合成 1 个更高星。
 * 优先消耗备战席棋子，保留棋盘上第一个棋子的位置。
 *
 * @param {Object[]} bench 备战席（会被复制）
 * @param {Object[]} board 棋盘（会被复制）
 * @param {{maxStar:number}} config 星级配置
 * @param {Function} makeId 生成新实例 ID 的函数
 * @returns {{bench:Object[], board:Object[], merged:Object[]}} 新状态与合成记录
 */
function applyCombine(bench, board, config, makeId) {
  const nextBench = bench.map((unit) => ({ ...unit }));
  const nextBoard = board.map((unit) => ({ ...unit }));
  const maxStar = config && config.maxStar ? config.maxStar : 3;
  const merged = [];

  /** 不断扫描，直到没有任何可合成组合（连合成产生的新棋子也能继续参与） */
  for (;;) {
    const groups = new Map();
    [...nextBoard, ...nextBench].forEach((unit) => {
      if (unit.star >= maxStar) return;
      const key = `${unit.heroId}-${unit.star}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(unit);
    });

    const hit = [...groups.entries()].find(([, list]) => list.length >= 3);
    if (!hit) break;

    const [key, list] = hit;
    const [heroId, starText] = key.split('-');
    const fromStar = Number(starText);
    // 棋盘优先保留，其余从备战席开始消耗
    const ordered = list.slice().sort((a, b) => {
      const locRank = (u) => (nextBoard.some((x) => x.uid === u.uid) ? 0 : 1);
      return locRank(a) - locRank(b);
    });
    const taken = ordered.slice(0, 3);
    const takeUids = new Set(taken.map((unit) => String(unit.uid)));

    const source = nextBoard.some((unit) => takeUids.has(String(unit.uid))) ? nextBoard : nextBench;
    const anchor = source.find((unit) => takeUids.has(String(unit.uid)));
    const index = source.indexOf(anchor);

    // 从两个数组里移除参与合成的棋子
    for (let i = nextBench.length - 1; i >= 0; i -= 1) {
      if (takeUids.has(String(nextBench[i].uid))) nextBench.splice(i, 1);
    }
    for (let i = nextBoard.length - 1; i >= 0; i -= 1) {
      if (takeUids.has(String(nextBoard[i].uid))) nextBoard.splice(i, 1);
    }

    const upgraded = {
      ...anchor,
      uid: makeId(),
      heroId: Number(heroId),
      star: fromStar + 1,
    };
    source.splice(Math.min(index, source.length), 0, upgraded);
    merged.push({ heroId: Number(heroId), fromStar, toStar: fromStar + 1, instanceId: upgraded.uid });
  }

  return { bench: nextBench, board: nextBoard, merged };
}

/**
 * @param {{dao:Object, balance:Object}} ctx 依赖
 * @returns {Object} service
 */
function createHeroService(ctx) {
  const { balance } = ctx;

  return {
    applyCombine,

    /**
     * 出售一个棋子：退款 + 归还卡池。
     * @param {Object} unit 棋子实例
     * @param {Object[]} pool 当前卡池
     * @returns {{refund:number, pool:Object[]}} 退款与新卡池
     */
    sell(unit, pool) {
      const refund = calcSellRefund(
        { cost: unit.cost, star: unit.star },
        balance.engine.economyConfig,
      ).refund;
      // 一星归还 1 张，二星归还 3 张，三星归还 9 张——与购买时消耗的卡数一致
      const count = Math.pow(3, unit.star - 1);
      return { refund, pool: adjustPool(pool, unit.heroId, count) };
    },

    /**
     * 在棋盘/备战席中定位棋子。
     * @param {Object} player 玩家状态
     * @param {string} uid 实例 ID
     * @returns {{unit:Object, location:'board'|'bench', index:number}} 位置
     */
    find(player, uid) {
      const boardIndex = player.board.findIndex((unit) => String(unit.uid) === String(uid));
      if (boardIndex >= 0) {
        return { unit: player.board[boardIndex], location: 'board', index: boardIndex };
      }
      const benchIndex = player.bench.findIndex((unit) => String(unit.uid) === String(uid));
      if (benchIndex >= 0) {
        return { unit: player.bench[benchIndex], location: 'bench', index: benchIndex };
      }
      throw fail.unit(uid);
    },
  };
}

module.exports = { createHeroService, applyCombine };
