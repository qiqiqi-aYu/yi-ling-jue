'use strict';

const { fail } = require('../utils/errors');

/**
 * services 公共辅助：事务内的「读锁 + 版本校验」。
 *
 * 所有会改对局状态的接口都先调用它：
 *   1. SELECT ... FOR UPDATE 锁 match 行（串行化同一局的所有写操作）
 *   2. 校验 status / version，返回 match 与指定座位玩家的运行时状态
 */

/**
 * @param {Object} dao DAO
 * @param {number} matchId 对局 ID
 * @param {number} playerIndex 座位号
 * @param {Object} conn 事务连接
 * @param {number} [expectedVersion] 客户端带来的版本号
 * @returns {Promise<{match:Object, player:Object}>} 已加锁的行
 */
async function loadMutable(dao, matchId, playerIndex, conn, expectedVersion) {
  const match = await dao.lockMatch(matchId, conn);
  if (!match) throw fail.unit(`match:${matchId}`);
  if (match.status === 'finished') throw fail.matchFinished();
  if (expectedVersion !== undefined && expectedVersion !== null && expectedVersion !== '') {
    if (Number(expectedVersion) !== Number(match.version)) throw fail.version();
  }

  const player = await dao.getPlayer(matchId, playerIndex, conn);
  if (!player) throw fail.unit(`player:${playerIndex}`);
  const locked = await dao.lockPlayer(player.id, conn);
  return { match, player: locked || player };
}

/**
 * 写完后统一维护版本号（让并发请求能靠 version 检测到过期）。
 * @param {Object} dao DAO
 * @param {Object} match 当前对局
 * @param {Object} conn 事务连接
 * @returns {Promise<number>} 新版本号
 */
async function bumpVersion(dao, match, conn) {
  const next = Number(match.version) + 1;
  await dao.updateMatch(match.id, { version: next }, conn, match.version);
  return next;
}

/**
 * 把有符号的 win_streak 拆成引擎要的 {winStreak, loseStreak}。
 * @param {number} streak 有符号连击
 * @returns {{winStreak:number, loseStreak:number}} 拆分结果
 */
function streaksOf(streak) {
  const value = Number(streak) || 0;
  return { winStreak: Math.max(0, value), loseStreak: Math.max(0, -value) };
}

/**
 * 根据连击结果生成新的有符号连击值。
 * @param {number} current 当前连击
 * @param {'win'|'loss'|'draw'} result 本回合结果
 * @returns {number} 新连击
 */
function nextStreak(current, result) {
  if (result === 'win') return (current > 0 ? current : 0) + 1;
  if (result === 'loss') return -((current < 0 ? -current : 0) + 1);
  return 0;
}

module.exports = { loadMutable, bumpVersion, streaksOf, nextStreak };
