'use strict';

const { ok } = require('../utils/response');
const { asyncHandler } = require('./asyncHandler');

/** 暴露给路由的控制器工厂 */
function createAuthController(services) {
  const auth = services.authService;
  return {
    miniappLogin: asyncHandler(async (req, res) => ok(res, await auth.miniappLogin(req.body), 201)),
    adminLogin: asyncHandler(async (req, res) => ok(res, await auth.adminLogin(req.body), 201)),
    me: asyncHandler(async (req, res) => ok(res, auth.me(req.user))),
  };
}

module.exports = { createAuthController };
