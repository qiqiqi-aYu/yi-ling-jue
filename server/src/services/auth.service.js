'use strict';

/**
 * services/auth.service.js —— 小程序匿名登录与后台账号登录。
 *
 * 单机版不落 player 表：小程序 code 只用来派生稳定 openid 并签发 role=player 的 JWT。
 * 后台账号落在 admin_user，密码用 bcrypt 校验。
 */

const bcrypt = require('bcryptjs');
const jwt = require('../middleware/auth');
const { sign } = jwt;
const { openidFromCode } = require('../utils/id');
const { fail } = require('../utils/errors');

/**
 * @param {{dao:Object}} ctx 依赖
 * @returns {Object} service
 */
function createAuthService(ctx) {
  const { dao } = ctx;

  return {
    /**
     * 小程序登录。
     * @param {{code:string}} input 微信 code
     * @returns {Promise<Object>} token 与 openid
     */
    async miniappLogin(input) {
      if (!input || typeof input.code !== 'string' || input.code.trim() === '') {
        throw fail.param('code 不能为空');
      }
      const openid = openidFromCode(input.code.trim());
      const { token, expiresIn } = sign({ role: 'player', openid });
      return { token, expiresIn, role: 'player', openid };
    },

    /**
     * 后台登录。
     * @param {{username:string, password:string}} input 账号密码
     * @returns {Promise<Object>} token
     */
    async adminLogin(input) {
      if (!input || !input.username || !input.password) throw fail.param('用户名与密码不能为空');
      const admin = await dao.getByUsername(input.username);
      if (!admin || admin.status !== 1) throw fail.param('账号不存在或已禁用');
      const matched = await bcrypt.compare(String(input.password), admin.password);
      if (!matched) throw fail.param('密码错误');
      const { token, expiresIn } = sign({ role: 'admin', adminId: admin.id });
      return { token, expiresIn, role: 'admin', username: admin.username };
    },

    /** 当前身份 */
    me(user) {
      return {
        role: user.role,
        openid: user.openid || null,
        adminId: user.adminId || null,
        username: user.username || null,
      };
    },
  };
}

module.exports = { createAuthService };
