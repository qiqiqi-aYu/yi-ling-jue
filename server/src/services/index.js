'use strict';

/**
 * services/index.js —— 依赖装配中心
 *
 * routes/controllers 只拿这一份 services 实例；
 * engine 纯函数通过 ctx 注入，dao 也只有这里创建一次。
 */

const dao = require('../dao');
const { loadBalance } = require('../config/balance.loader');
const { createRng } = require('../engine/rng');
const { setTtl } = require('../middleware/idempotency');

const { createEconomyService } = require('./economy.service');
const { createHeroService } = require('./hero.service');
const { createShopService } = require('./shop.service');
const { createBoardService } = require('./board.service');
const { createTraitService } = require('./trait.service');
const { createAiService } = require('./ai.service');
const { createBattleService } = require('./battle.service');
const { createSnapshotService } = require('./snapshot.service');
const { createMatchService } = require('./match.service');
const { createCatalogService } = require('./catalog.service');
const { createAuthService } = require('./auth.service');

/** 从对局种子 + 用途派生互不干扰的随机流 */
const makeRng = (seed, label) => createRng(seed).fork(label);

let servicesPromise = null;

/**
 * 构建（或复用）services 单例。配置在首次调用时从 MySQL 加载并缓存。
 * @param {{balance?:Object, dao?:Object}} [overrides] 测试可注入假配置 / 假 DAO
 * @returns {Promise<Object>} services
 */
async function createServices(overrides = {}) {
  const activeDao = overrides.dao || dao;
  const balance = overrides.balance || (await loadBalance());
  const ctx = { dao: activeDao, balance, makeRng };

  if (balance.gameConfig && balance.gameConfig.idempotencyTtlSeconds) {
    setTtl(balance.gameConfig.idempotencyTtlSeconds);
  }

  const economyService = createEconomyService(ctx);
  const heroService = createHeroService(ctx);
  const shopService = createShopService({ ...ctx, heroService });
  const boardService = createBoardService(ctx);
  const traitService = createTraitService(ctx);
  const aiService = createAiService({ ...ctx, heroService });
  const snapshotService = createSnapshotService(ctx);
  const battleService = createBattleService({
    ...ctx,
    aiService,
    heroService,
    traitService,
    snapshotService,
  });
  const matchService = createMatchService({
    ...ctx,
    economyService,
    shopService,
    traitService,
  });
  const catalogService = createCatalogService(ctx);
  const authService = createAuthService({ ...ctx, dao: activeDao });

  return {
    dao: activeDao,
    balance,
    economyService,
    heroService,
    shopService,
    boardService,
    traitService,
    aiService,
    battleService,
    snapshotService,
    matchService,
    catalogService,
    authService,
  };
}

/** 进程级单例（首次调用才会真的连库） */
function getServices() {
  if (!servicesPromise) servicesPromise = createServices();
  return servicesPromise;
}

/** 仅供测试：重置单例 */
function resetServices() {
  servicesPromise = null;
}

module.exports = { createServices, getServices, resetServices, makeRng };
