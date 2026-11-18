'use strict';

const jwt = require('jsonwebtoken');
const { ROLE } = require('../config/constants');
const { AppError, fail } = require('../utils/errors');

/** JWT 密钥：生产必须通过 .env 覆盖 */
const JWT_SECRET = process.env.JWT_SECRET || 'yi_ling_jue_dev_secret_change_me';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';

/**
 * 签发 token。
 * @param {{role:string, openid?:string, adminId?:number}} payload 身份信息
 * @returns {{token:string, expiresIn:string}} token
 */
function sign(payload) {
  return {
    token: jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN }),
    expiresIn: JWT_EXPIRES_IN,
  };
}

/** 解析 Bearer token，失败抛 2001 */
function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!token) return next(fail.auth());
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch (err) {
    next(fail.auth());
  }
}

/**
 * 角色守卫：必须放在 requireAuth 之后。
 * @param {string} role player / admin
 * @returns {Function} middleware
 */
function requireRole(role) {
  return (req, res, next) => {
    if (!req.user) return next(fail.auth());
    if (req.user.role !== role) return next(fail.forbidden());
    next();
  };
}

module.exports = { sign, requireAuth, requireRole, JWT_SECRET };
