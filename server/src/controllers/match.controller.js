'use strict';

const { ok } = require('../utils/response');
const { asyncHandler } = require('./asyncHandler');

/** 对局 / 商店 / 棋盘 / 存档 */
function createMatchController(services) {
  const { matchService, shopService, boardService, traitService, economyService, snapshotService } = services;
  const id = (req) => Number(req.params.id);
  const version = (req) => (req.body && req.body.version !== undefined ? req.body.version : req.query.version);

  return {
    create: asyncHandler(async (req, res) => ok(res, await matchService.create(req.body || {}), 201)),
    list: asyncHandler(async (req, res) =>
      ok(res, await matchService.list(req.query.status, Number(req.query.page) || 1, Number(req.query.pageSize) || 20))),
    detail: asyncHandler(async (req, res) => ok(res, await matchService.get(id(req)))),
    board: asyncHandler(async (req, res) => ok(res, await boardService.getBoard(id(req), 0))),
    result: asyncHandler(async (req, res) => ok(res, await matchService.result(id(req)))),
    surrender: asyncHandler(async (req, res) => ok(res, await matchService.surrender(id(req), version(req)))),

    shop: asyncHandler(async (req, res) => ok(res, await shopService.getShop(id(req), 0))),
    refresh: asyncHandler(async (req, res) => ok(res, await shopService.refresh(id(req), 0, version(req)))),
    buy: asyncHandler(async (req, res) =>
      ok(res, await shopService.buy(id(req), 0, req.body.slotNo, version(req)))),
    sell: asyncHandler(async (req, res) =>
      ok(res, await shopService.sell(id(req), 0, req.params.instanceId, version(req)))),
    levelUp: asyncHandler(async (req, res) =>
      ok(res, await shopService.levelUp(id(req), 0, req.body.count, version(req)))),
    economy: asyncHandler(async (req, res) => ok(res, await economyService.getEconomy(id(req), 0))),

    submitBoard: asyncHandler(async (req, res) =>
      ok(res, await boardService.submit(id(req), 0, req.body.layout, version(req)))),
    deploy: asyncHandler(async (req, res) =>
      ok(res, await boardService.deploy(id(req), 0, req.body.instanceId, req.body, version(req)))),
    traits: asyncHandler(async (req, res) => ok(res, await traitService.getTraits(id(req), 0))),

    snapshots: asyncHandler(async (req, res) => ok(res, await snapshotService.list(id(req)))),
    latestSnapshot: asyncHandler(async (req, res) => ok(res, await snapshotService.latest(id(req)))),
    restore: asyncHandler(async (req, res) =>
      ok(res, await snapshotService.restore(id(req), Number(req.params.sid), version(req)))),
  };
}

module.exports = { createMatchController };
