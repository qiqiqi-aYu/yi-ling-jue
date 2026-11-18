'use strict';

/**
 * services/board.service.js —— 棋盘整体提交与单子部署。
 * 一次 PUT 原子替换 board_json / bench_json，避免逐格请求造成中间态。
 */

const { BOARD_ROWS, BOARD_COLS } = require('../config/constants');
const { fail } = require('../utils/errors');
const { loadMutable, bumpVersion } = require('./support');

/**
 * @param {Object} ctx 依赖
 * @returns {Object} service
 */
function createBoardService(ctx) {
  const { dao, balance } = ctx;

  return {
    /** 只读棋盘 + 备战席 + 人口上限 */
    async getBoard(matchId, playerIndex) {
      const player = await dao.getPlayer(matchId, playerIndex);
      if (!player) throw fail.unit(`player:${playerIndex}`);
      const level = balance.levels.list.find((row) => Number(row.level) === Number(player.level));
      return {
        board: player.board,
        bench: player.bench,
        maxBoardSlots: level ? level.maxBoardSlots : player.level,
        boardRows: BOARD_ROWS,
        boardCols: BOARD_COLS,
      };
    },

    /**
     * 整体提交布局。
     * @param {number} matchId 对局
     * @param {number} playerIndex 座位
     * @param {Array} layout [{instanceId, location:1|2, row, col, benchIndex}]
     * @param {number} [expectedVersion] 版本
     * @returns {Promise<Object>} 新棋盘
     */
    async submit(matchId, playerIndex, layout, expectedVersion) {
      if (!Array.isArray(layout)) throw fail.param('layout 必须是数组');
      return dao.withTransaction(async (conn) => {
        const { match, player } = await loadMutable(dao, matchId, playerIndex, conn, expectedVersion);
        const owned = new Map(
          [...player.board, ...player.bench].map((unit) => [String(unit.uid), unit]),
        );
        const level = balance.levels.list.find((row) => Number(row.level) === Number(player.level));
        const maxSlots = level ? level.maxBoardSlots : player.level;

        const board = [];
        const bench = [];
        const usedUids = new Set();
        const usedCells = new Set();
        const usedBench = new Set();

        for (const item of layout) {
          if (!item || item.instanceId === undefined) throw fail.param('layout 项缺少 instanceId');
          const uid = String(item.instanceId);
          if (!owned.has(uid)) throw fail.unit(uid);
          if (usedUids.has(uid)) throw fail.param(`棋子 ${uid} 在 layout 中重复`);
          usedUids.add(uid);
          const unit = { ...owned.get(uid) };

          if (Number(item.location) === 1) {
            const row = Number(item.row);
            const col = Number(item.col);
            if (!Number.isInteger(row) || !Number.isInteger(col) || row < 0 || row >= BOARD_ROWS || col < 0 || col >= BOARD_COLS) {
              throw fail.param(`棋盘坐标越界：${row},${col}`);
            }
            const cell = `${row},${col}`;
            if (usedCells.has(cell)) throw fail.param(`格子 ${cell} 被重复占用`);
            usedCells.add(cell);
            unit.row = row;
            unit.col = col;
            board.push(unit);
          } else {
            const benchIndex = Number(item.benchIndex);
            if (!Number.isInteger(benchIndex) || benchIndex < 0 || benchIndex >= (balance.gameConfig.benchSize || 9)) {
              throw fail.param(`备战席下标越界：${benchIndex}`);
            }
            if (usedBench.has(benchIndex)) throw fail.param(`备战席 ${benchIndex} 被重复占用`);
            usedBench.add(benchIndex);
            unit.row = undefined;
            unit.col = undefined;
            bench[benchIndex] = unit;
          }
        }

        if (board.length > maxSlots) throw fail.boardFull(maxSlots);
        // 未出现在 layout 中的棋子默认留在备战席，按原顺序填空
        for (const [uid, unit] of owned) {
          if (usedUids.has(uid)) continue;
          const slot = bench.findIndex((_, index) => bench[index] === undefined);
          if (slot < 0) throw fail.benchFull();
          bench[slot] = unit;
        }
        const compactBench = bench.filter(Boolean);

        await dao.updatePlayer(player.id, { board_json: board, bench_json: compactBench }, conn);
        const version = await bumpVersion(dao, match, conn);
        return { board, bench: compactBench, version };
      });
    },

    /**
     * 单棋子上阵 / 下阵 / 换位（逐格调试用）。
     * @param {number} matchId 对局
     * @param {number} playerIndex 座位
     * @param {string} instanceId 棋子实例
     * @param {Object} target {location, row, col}
     * @param {number} [expectedVersion] 版本
     * @returns {Promise<Object>} 新布局
     */
    async deploy(matchId, playerIndex, instanceId, target, expectedVersion) {
      const player = await dao.getPlayer(matchId, playerIndex);
      if (!player) throw fail.unit(`player:${playerIndex}`);
      const all = [
        ...player.board.map((unit) => ({
          instanceId: unit.uid, location: 1, row: unit.row, col: unit.col,
        })),
        ...player.bench.map((unit, index) => ({
          instanceId: unit.uid, location: 2, benchIndex: index,
        })),
      ];
      const targetUid = String(instanceId);
      const index = all.findIndex((item) => String(item.instanceId) === targetUid);
      if (index < 0) throw fail.unit(instanceId);
      const layout = all.filter((_, i) => i !== index);

      if (Number(target.location) === 1) {
        // 若目标格已有棋子，原棋子被挤回备战席（交换位置）
        const occupant = layout.find(
          (item) => Number(item.location) === 1 && Number(item.row) === Number(target.row) && Number(item.col) === Number(target.col),
        );
        if (occupant) {
          occupant.location = 2;
          delete occupant.row;
          delete occupant.col;
          occupant.benchIndex = player.bench.length;
        }
        layout.push({ instanceId: targetUid, location: 1, row: Number(target.row), col: Number(target.col) });
      } else {
        layout.push({ instanceId: targetUid, location: 2, benchIndex: Number(target.benchIndex || 0) });
      }
      return this.submit(matchId, playerIndex, layout, expectedVersion);
    },
  };
}

module.exports = { createBoardService };
