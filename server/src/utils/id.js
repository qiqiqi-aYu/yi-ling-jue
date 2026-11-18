'use strict';

const crypto = require('crypto');

/**
 * 请求 ID / 棋子实例 ID 工具。
 * 棋子实例 ID 只是「身份标识」，不参与任何随机数值计算，
 * 因此用 crypto 生成即可，不占用 engine/rng 的可复现随机流。
 */

/** @returns {string} req_ 前缀的请求 ID */
function requestId() {
  return `req_${crypto.randomBytes(6).toString('hex')}`;
}

/** @returns {string} UUID v4 */
function uuid() {
  return crypto.randomUUID();
}

/**
 * 生成棋子实例 ID。
 * @param {number} matchId 对局 ID
 * @param {number} playerIndex 座位号
 * @returns {string} 实例 ID
 */
function instanceId(matchId, playerIndex) {
  return `h${matchId}_${playerIndex}_${crypto.randomBytes(4).toString('hex')}`;
}

/**
 * 由微信 code 派生一个稳定的匿名 openid（单机课设不接真实 code2session）。
 * 生产环境应替换为真实的 code2session 调用。
 * @param {string} code 微信登录 code
 * @returns {string} openid
 */
function openidFromCode(code) {
  return `wx_${crypto.createHash('sha256').update(String(code)).digest('hex').slice(0, 24)}`;
}

module.exports = { requestId, uuid, instanceId, openidFromCode };
