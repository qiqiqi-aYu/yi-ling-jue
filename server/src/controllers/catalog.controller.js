'use strict';

const { ok } = require('../utils/response');
const { asyncHandler } = require('./asyncHandler');

/** 只读配置与图鉴 */
function createCatalogController(services) {
  const catalog = services.catalogService;
  return {
    balance: asyncHandler(async (req, res) => ok(res, catalog.configBalance())),
    levels: asyncHandler(async (req, res) => ok(res, catalog.configLevels())),
    odds: asyncHandler(async (req, res) => ok(res, catalog.configOdds())),
    cardPool: asyncHandler(async (req, res) => ok(res, catalog.configCardPool())),
    heroes: asyncHandler(async (req, res) => ok(res, catalog.heroes(req.query))),
    hero: asyncHandler(async (req, res) => ok(res, catalog.hero(req.params.id))),
    traits: asyncHandler(async (req, res) => ok(res, catalog.traits(req.query.type))),
    trait: asyncHandler(async (req, res) => ok(res, catalog.trait(req.params.id))),
  };
}

module.exports = { createCatalogController };
