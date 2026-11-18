'use strict';

import { post, get } from './request.js';

/**
 * 认证接口：只转发后端响应，不做 openid 派生或任何游戏数值计算。
 */

/** @param {string} code 小程序登录 code */
export function miniappLogin(code) {
  return post('/auth/miniapp/login', { code }, { auth: false, idempotent: false });
}

export function getCurrentUser() {
  return get('/auth/me');
}
