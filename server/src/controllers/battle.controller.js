'use strict';

const { ok } = require('../utils/response');
const { asyncHandler } = require('./asyncHandler');

/** 回合与战斗 */
function createBattleController(services) {
  const battle = services.battleService;
  const id = (req) => Number(req.params.id);
  const roundNo = (req) => Number(req.params.roundNo);
  const version = (req) => (req.body && req.body.version !== undefined ? req.body.version : req.query.version);

  return {
    listRounds: asyncHandler(async (req, res) => ok(res, await battle.listRounds(id(req)))),
    round: asyncHandler(async (req, res) => ok(res, await battle.getRound(id(req), roundNo(req)))),
    fight: asyncHandler(async (req, res) =>
      ok(res, await battle.battle(id(req), roundNo(req), version(req)))),
    battleLog: asyncHandler(async (req, res) =>
      ok(res, await battle.getBattle(id(req), roundNo(req)))),
  };
}

module.exports = { createBattleController };
