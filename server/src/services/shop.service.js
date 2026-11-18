'use strict';

/**
 * services/shop.service.js —— 商店刷新 / 购买 / 出售 / 买经验。
 *
 * 事务边界（docs/01 §6.2）：
 *   锁 match 行 + 锁本人 match_player 行 → 校验 → 引擎计算 → 同事务写回
 *   pool_json 是 8 人共享的一份逻辑卡池，因此每次变动都同步写 8 行。
 */

const { drawShop, adjustPool } = require('../engine/probability');
const { calcGoldAfter } = require('../engine/economy');
const { fail } = require('../utils/errors');
const { loadMutable, bumpVersion } = require('./support');

/**
 * @param {Object} ctx 依赖（dao / balance / heroService / makeRng）
 * @returns {Object} service
 */
function createShopService(ctx) {
  const { dao, balance, heroService, makeRng } = ctx;
  const game = balance.gameConfig;
  const heroById = new Map(balance.engine.heroes.map((hero) => [Number(hero.heroId), hero]));
  const levelById = new Map(balance.levels.list.map((row) => [Number(row.level), row]));
  const shopSize = game.shopSize || 5;
  const benchSize = game.benchSize || 9;

  /** 每个请求拥有独立的实例 ID 生成器（ID 不参与数值，故用随机字节） */
  const newInstanceId = (matchId, playerIndex) => require('../utils/id').instanceId(matchId, playerIndex);

  /**
   * 只写公共卡池（8 行同步），避免 8 人读到不同余量。
   * @param {number} matchId 对局 ID
   * @param {Object[]} pool 新卡池
   * @param {Object} conn 事务连接
   * @returns {Promise<void>}
   */
  const writePool = (matchId, pool, conn) => dao.updateAllPlayers(matchId, { pool_json: pool }, conn);

  return {
    /** 当前商店（只读） */
    async getShop(matchId, playerIndex) {
      const player = await dao.getPlayer(matchId, playerIndex);
      if (!player) throw fail.unit(`player:${playerIndex}`);
      return { shop: player.shop, pool: player.pool, level: player.level };
    },

    /**
     * 刷新商店：扣钱 → 按等级概率与卡池余量抽 N 张 → 保留锁定格。
     * @param {number} matchId 对局
     * @param {number} playerIndex 座位
     * @param {number} [expectedVersion] 乐观锁版本
     * @returns {Promise<Object>} {shop, goldBefore, goldAfter, refreshCost, version}
     */
    /**
     * 在已有事务内刷新商店（match.service 创建对局时复用，避免嵌套事务）。
     * @param {Object} match 对局行（已加锁）
     * @param {Object} player 玩家行（已加锁）
     * @param {Object} conn 事务连接
     * @param {{free?:boolean}} [options] free=true 不扣钱（首次发牌）
     * @returns {Promise<Object>} 刷新结果（不含 version）
     */
    async refreshCore(match, player, conn, options = {}) {
      const level = levelById.get(Number(player.level));
      if (!level) throw fail.param(`等级配置缺失：${player.level}`);
      const cost = options.free ? 0 : level.refreshCost;
      if (player.gold < cost) throw fail.gold(cost, player.gold);

      const lockedSlots = player.shop.filter((slot) => slot.locked && slot.heroId);
      const lockedByNo = new Map(lockedSlots.map((slot) => [Number(slot.slotNo), slot]));
      const rng = makeRng(match.seed, `shop-${player.player_index}-${match.version}`);
      const draw = drawShop({
        odds: balance.odds.byLevel[player.level],
        cards: player.pool,
        rng,
        count: shopSize - lockedSlots.length,
      });
      if (draw.picks.length === 0) throw fail.poolEmpty();
      const fresh = draw.picks.map((pick, index) => ({
        slotNo: index + 1, heroId: pick.heroId, cost: pick.cost, locked: false,
      }));

      const shop = [];
      let cursor = 0;
      for (let slotNo = 1; slotNo <= shopSize; slotNo += 1) {
        if (lockedByNo.has(slotNo)) {
          shop.push({ ...lockedByNo.get(slotNo), slotNo });
        } else {
          shop.push(fresh[cursor] ? { ...fresh[cursor], slotNo } : { slotNo, heroId: null, locked: false });
          cursor += 1;
        }
      }

      const goldAfter = calcGoldAfter(
        { goldBefore: player.gold, incomeTotal: 0, spend: cost },
        balance.engine.economyConfig,
      ).goldAfter;
      await writePool(match.id, draw.pool, conn);
      await dao.updatePlayer(player.id, { shop_json: shop, gold: goldAfter }, conn);
      return { shop, goldBefore: player.gold, goldAfter, refreshCost: cost };
    },

    async refresh(matchId, playerIndex, expectedVersion) {
      return dao.withTransaction(async (conn) => {
        const { match, player } = await loadMutable(dao, matchId, playerIndex, conn, expectedVersion);
        const result = await this.refreshCore(match, player, conn);
        return { ...result, version: await bumpVersion(dao, match, conn) };
      });
    },

    /**
     * 购买：校验金币与备战席 → 扣金 → 卡池 -1 → 入备战席 → 自动三合一。
     * @param {number} matchId 对局
     * @param {number} playerIndex 座位
     * @param {number} slotNo 商店格号
     * @param {number} [expectedVersion] 乐观锁版本
     * @returns {Promise<Object>} 结果
     */
    async buy(matchId, playerIndex, slotNo, expectedVersion) {
      return dao.withTransaction(async (conn) => {
        const { match, player } = await loadMutable(dao, matchId, playerIndex, conn, expectedVersion);
        const slot = player.shop.find((item) => Number(item.slotNo) === Number(slotNo));
        if (!slot || !slot.heroId) throw fail.param(`商店格 ${slotNo} 没有棋子`);
        if (player.bench.length >= benchSize) throw fail.benchFull();
        const hero = heroById.get(Number(slot.heroId));
        if (!hero) throw fail.unit(`hero:${slot.heroId}`);
        if (player.gold < hero.cost) throw fail.gold(hero.cost, player.gold);

        const goldAfter = calcGoldAfter(
          { goldBefore: player.gold, incomeTotal: 0, spend: hero.cost },
          balance.engine.economyConfig,
        ).goldAfter;
        const pool = adjustPool(player.pool, hero.heroId, -1);
        const unit = {
          uid: newInstanceId(matchId, playerIndex),
          heroId: hero.heroId,
          name: hero.name,
          cost: hero.cost,
          star: 1,
        };
        const bench = [...player.bench, unit];
        const combined = heroService.applyCombine(
          bench,
          player.board,
          balance.engine.statsConfig,
          () => newInstanceId(matchId, playerIndex),
        );

        const shop = player.shop.map((item) =>
          Number(item.slotNo) === Number(slotNo) ? { ...item, heroId: null, locked: false } : item,
        );
        await writePool(matchId, pool, conn);
        await dao.updatePlayer(
          player.id,
          { gold: goldAfter, shop_json: shop, bench_json: combined.bench, board_json: combined.board },
          conn,
        );
        const version = await bumpVersion(dao, match, conn);
        return {
          bought: unit,
          merged: combined.merged,
          bench: combined.bench,
          goldBefore: player.gold,
          goldAfter,
          version,
        };
      });
    },

    /**
     * 出售棋子：退款 + 归还卡池（数量 = 3^(star-1)）。
     * @param {number} matchId 对局
     * @param {number} playerIndex 座位
     * @param {string} uid 棋子实例 ID
     * @param {number} [expectedVersion] 乐观锁版本
     * @returns {Promise<Object>} 结果
     */
    async sell(matchId, playerIndex, uid, expectedVersion) {
      return dao.withTransaction(async (conn) => {
        const { match, player } = await loadMutable(dao, matchId, playerIndex, conn, expectedVersion);
        const found = heroService.find(player, uid);
        const { refund, pool } = heroService.sell(found.unit, player.pool);
        const bench = player.bench.slice();
        const board = player.board.slice();
        if (found.location === 'bench') bench.splice(found.index, 1);
        else board.splice(found.index, 1);

        const goldAfter = calcGoldAfter(
          { goldBefore: player.gold, incomeTotal: refund, spend: 0 },
          balance.engine.economyConfig,
        ).goldAfter;
        await writePool(matchId, pool, conn);
        await dao.updatePlayer(
          player.id,
          { gold: goldAfter, bench_json: bench, board_json: board },
          conn,
        );
        const version = await bumpVersion(dao, match, conn);
        return { sold: found.unit, refund, goldAfter, version };
      });
    },

    /**
     * 买经验：4 金 = 4 经验，自动逐级升级。
     * @param {number} matchId 对局
     * @param {number} playerIndex 座位
     * @param {number} count 购买次数
     * @param {number} [expectedVersion] 乐观锁版本
     * @returns {Promise<Object>} 结果
     */
    async levelUp(matchId, playerIndex, count, expectedVersion) {
      const times = Number(count) || 1;
      if (!Number.isInteger(times) || times < 1 || times > 10) throw fail.param('count 必须是 1~10 的整数');
      return dao.withTransaction(async (conn) => {
        const { match, player } = await loadMutable(dao, matchId, playerIndex, conn, expectedVersion);
        const spend = times * 4;
        if (player.gold < spend) throw fail.gold(spend, player.gold);

        let level = Number(player.level);
        let exp = Number(player.exp) + times * 4;
        let leveled = 0;
        while (level < 9) {
          const need = levelById.get(level).expToNext;
          if (exp < need) break;
          exp -= need;
          level += 1;
          leveled += 1;
        }
        if (level === 9) exp = 0;
        const goldAfter = calcGoldAfter(
          { goldBefore: player.gold, incomeTotal: 0, spend },
          balance.engine.economyConfig,
        ).goldAfter;
        await dao.updatePlayer(player.id, { gold: goldAfter, level, exp }, conn);
        const version = await bumpVersion(dao, match, conn);
        return { goldBefore: player.gold, goldAfter, level, exp, leveled, version };
      });
    },
  };
}

module.exports = { createShopService };
