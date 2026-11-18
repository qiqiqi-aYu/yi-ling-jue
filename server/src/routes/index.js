'use strict';

/**
 * routes/index.js —— /api/v1 全部路由（仅路径映射 + 鉴权 + 幂等，不写业务）
 *
 * P0 接口共 26 个；这里另外把 P1/P2 里实现成本很低的几个只读接口也挂上了。
 */

const express = require('express');
const { requireAuth, requireRole } = require('../middleware/auth');
const { idempotency } = require('../middleware/idempotency');
const { createAuthController } = require('../controllers/auth.controller');
const { createCatalogController } = require('../controllers/catalog.controller');
const { createMatchController } = require('../controllers/match.controller');
const { createBattleController } = require('../controllers/battle.controller');

/**
 * @param {Object} services 服务集合
 * @returns {Object} Express Router
 */
function createRoutes(services) {
  const router = express.Router();
  const auth = createAuthController(services);
  const catalog = createCatalogController(services);
  const match = createMatchController(services);
  const battle = createBattleController(services);

  const player = [requireAuth, requireRole('player')];
  const logged = [requireAuth];

  /**
   * 写操作统一三段：标记场景 → 幂等中间件 → controller。
   * @param {string} scene 幂等场景名
   * @param {Function} handler 控制器
   * @returns {Array} handlers
   */
  const write = (scene, handler) => [
    (req, res, next) => {
      req.idempotencyScene = scene;
      next();
    },
    idempotency,
    handler,
  ];

  /* ---------------- A 认证 ---------------- */
  router.post('/auth/miniapp/login', auth.miniappLogin);
  router.post('/auth/admin/login', auth.adminLogin);
  router.get('/auth/me', ...logged, auth.me);

  /* ---------------- B 配置与图鉴 ---------------- */
  router.get('/config/balance', ...logged, catalog.balance);
  router.get('/config/levels', ...logged, catalog.levels);
  router.get('/config/shop-odds', ...logged, catalog.odds);
  router.get('/config/card-pool', ...logged, catalog.cardPool);
  router.get('/heroes', ...logged, catalog.heroes);
  router.get('/heroes/:id', ...logged, catalog.hero);
  router.get('/traits', ...logged, catalog.traits);
  router.get('/traits/:id', ...logged, catalog.trait);

  /* ---------------- C 对局生命周期 ---------------- */
  router.post('/matches', ...player, ...write('match.create', match.create));
  router.get('/matches', ...player, match.list);
  router.get('/matches/:id', ...player, match.detail);
  router.get('/matches/:id/board', ...player, match.board);
  router.get('/matches/:id/result', ...player, match.result);
  router.post('/matches/:id/surrender', ...player, ...write('match.surrender', match.surrender));

  /* ---------------- D 商店与经济 ---------------- */
  router.get('/matches/:id/shop', ...player, match.shop);
  router.post('/matches/:id/shop/refresh', ...player, ...write('shop.refresh', match.refresh));
  router.post('/matches/:id/shop/buy', ...player, ...write('shop.buy', match.buy));
  router.post('/matches/:id/heroes/:instanceId/sell', ...player, ...write('hero.sell', match.sell));
  router.post('/matches/:id/level-up', ...player, ...write('player.levelUp', match.levelUp));
  router.post('/matches/:id/buy-exp', ...player, ...write('player.buyExp', match.buyExp));
  router.get('/matches/:id/economy', ...player, match.economy);

  /* ---------------- E 棋盘与羁绊 ---------------- */
  router.put('/matches/:id/board', ...player, ...write('board.submit', match.submitBoard));
  router.post('/matches/:id/board/deploy', ...player, ...write('board.deploy', match.deploy));
  router.get('/matches/:id/traits', ...player, match.traits);

  /* ---------------- F 回合与战斗 ---------------- */
  router.get('/matches/:id/rounds', ...player, battle.listRounds);
  router.get('/matches/:id/rounds/:roundNo', ...player, battle.round);
  router.post('/matches/:id/rounds/:roundNo/battle', ...player, ...write('round.battle', battle.fight));
  router.get('/matches/:id/rounds/:roundNo/battle', ...player, battle.battleLog);

  /* ---------------- G 存档 ---------------- */
  router.get('/matches/:id/snapshots', ...player, match.snapshots);
  router.get('/matches/:id/snapshots/latest', ...player, match.latestSnapshot);
  router.post('/matches/:id/snapshots/:sid/restore', ...player, ...write('snapshot.restore', match.restore));

  return router;
}

module.exports = { createRoutes };
