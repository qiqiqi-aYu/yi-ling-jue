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

/**
 * 给商店格补齐展示字段（英雄名称 / 星级 / 卡池余量 / 羁绊名称）。
 *
 * 库里 shop_json 只存 slotNo / heroId / cost / locked，名称在英雄配置表里、
 * 余量在共享的 pool_json 里、羁绊名称在 trait 表里。这里只在「读路径」上补字段，
 * 不回写数据库；空位格原样返回，由前端按 heroId 为空渲染弱化的「空位」卡片。
 *
 * 羁绊名称由后端拼成 traitsText（形如「灵族 · 符师」），前端只做纯展示，
 * 不在小程序侧做任何「heroId → 羁绊」的映射或字符串拼接。
 *
 * @param {Object[]} shop 商店格数组
 * @param {Object[]} heroes 英雄配置快照（engine.heroes，含 traitIds）
 * @param {Object[]} [pool] 本局共享卡池（[{heroId, cost, remaining}]）
 * @param {Object<string,{name:string}>} [traitMeta] 羁绊元数据（engine.traitMeta，键为 traitId）
 * @returns {Object[]} 补上 name / star / remainingInPool / traits / traitsText 的商店格
 */
function decorateShop(shop, heroes, pool, traitMeta) {
  if (!Array.isArray(shop)) return [];
  const byId = new Map((heroes || []).map((hero) => [Number(hero.heroId), hero]));
  const poolById = new Map((pool || []).map((card) => [Number(card.heroId), card]));
  const meta = traitMeta || {};
  return shop.map((item) => {
    if (!item || !item.heroId) return item;
    const hero = byId.get(Number(item.heroId));
    if (!hero) return item;
    const card = poolById.get(Number(item.heroId));
    // traitIds 在 loader 里已按 id 升序，天然是「种族在前、职业在后」
    const traits = (hero.traitIds || [])
      .map((traitId) => meta[traitId])
      .filter((trait) => trait && trait.name)
      .map((trait) => trait.name);
    return {
      ...item,
      name: hero.name,
      star: item.star || 1,
      remainingInPool: card ? card.remaining : item.remainingInPool,
      traits,
      traitsText: traits.join(' · '),
    };
  });
}

module.exports = {
  loadMutable, bumpVersion, streaksOf, nextStreak, decorateShop,
};
