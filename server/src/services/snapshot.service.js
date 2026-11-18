'use strict';

/**
 * services/snapshot.service.js —— 自动存档 / 读档还原。
 *
 * state_json 里保存 8 名参与者的完整运行时状态与对局随机种子。
 * 还原时按 version 校验，避免把旧存档覆盖到更新后的对局上。
 */

const { fail } = require('../utils/errors');
const { bumpVersion } = require('./support');

/**
 * @param {Object} ctx 依赖
 * @returns {Object} service
 */
function createSnapshotService(ctx) {
  const { dao } = ctx;

  return {
    /** 在已有事务内写一条存档（battle.service 调用） */
    save(matchId, roundNo, state, conn) {
      return dao.insertSnapshot(matchId, roundNo, state, conn);
    },

    /** 存档列表 */
    list(matchId) {
      return dao.listSnapshots(matchId);
    },

    /** 最新存档 */
    async latest(matchId) {
      const snap = await dao.latestSnapshot(matchId);
      if (!snap) throw fail.unit(`snapshot:${matchId}`);
      return snap;
    },

    /**
     * 读档还原。
     * @param {number} matchId 对局
     * @param {number} snapshotId 存档 ID
     * @param {number} [expectedVersion] 版本校验
     * @returns {Promise<Object>} 还原结果
     */
    async restore(matchId, snapshotId, expectedVersion) {
      return dao.withTransaction(async (conn) => {
        const match = await dao.lockMatch(matchId, conn);
        if (!match) throw fail.unit(`match:${matchId}`);
        if (expectedVersion !== undefined && Number(expectedVersion) !== Number(match.version)) throw fail.version();
        const snap = await dao.getSnapshot(matchId, snapshotId, conn);
        if (!snap) throw fail.unit(`snapshot:${snapshotId}`);
        if (!snap.state || !Array.isArray(snap.state.players)) {
          throw fail.param('存档内容不完整，无法还原');
        }

        for (const player of snap.state.players) {
          const current = await dao.getPlayer(matchId, player.player_index, conn);
          if (!current) continue;
          await dao.updatePlayer(
            current.id,
            {
              hp: player.hp,
              gold: player.gold,
              level: player.level,
              exp: player.exp,
              win_streak: player.win_streak,
              board_json: player.board || [],
              bench_json: player.bench || [],
              pool_json: player.pool || [],
              shop_json: player.shop || [],
              eliminated: player.eliminated ? 1 : 0,
              eliminated_round: player.eliminatedRound || player.eliminated_round || null,
              rank: player.rank || null,
            },
            conn,
          );
        }

        const target = snap.state.match || {};
        const nextVersion = Number(match.version) + 1;
        await dao.updateMatch(
          matchId,
          {
            round: target.round || snap.round_no,
            status: target.status || 'running',
            version: nextVersion,
          },
          conn,
          match.version,
        );
        return { matchId, round: target.round || snap.round_no, version: nextVersion, restoredFrom: snap.id };
      });
    },
  };
}

module.exports = { createSnapshotService };
