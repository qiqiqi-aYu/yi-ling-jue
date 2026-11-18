'use strict';

import { ERROR_CODE } from '../utils/constants.js';
import { createRequestId } from '../utils/id.js';

/**
 * 统一请求封装：只负责 baseURL、token、错误码与幂等 ID。
 * 前端禁止在此处或任何页面中实现游戏数值计算，所有结果均来自后端 P0 接口。
 */

const DEFAULT_BASE_URL = 'http://localhost:3000/api/v1';
const TOKEN_STORAGE_KEY = 'yilingjue_token_v1';
const REQUEST_TIMEOUT = 15000;

/** @returns {string} 当前 API 根地址 */
export function getBaseUrl() {
  return (import.meta.env && import.meta.env.VITE_API_BASE_URL) || DEFAULT_BASE_URL;
}

/** @returns {string} 本地 token */
export function getToken() {
  try {
    return uni.getStorageSync(TOKEN_STORAGE_KEY) || '';
  } catch (err) {
    return '';
  }
}

/** @param {string} token JWT */
export function setToken(token) {
  try {
    uni.setStorageSync(TOKEN_STORAGE_KEY, token || '');
  } catch (err) {
    // 存储不可用时保持内存会话即可，不阻断请求。
  }
}

export function clearToken() {
  setToken('');
}

/** @param {Object} params 查询参数 */
function buildQuery(params) {
  if (!params) return '';
  const parts = Object.keys(params)
    .filter((key) => params[key] !== undefined && params[key] !== null && params[key] !== '')
    .map((key) => `${encodeURIComponent(key)}=${encodeURIComponent(params[key])}`);
  return parts.length ? `?${parts.join('&')}` : '';
}

/** @param {Object} payload 后端响应 */
function normalizeError(payload, statusCode) {
  const message = (payload && payload.message) || `请求失败（${statusCode || 'network'}）`;
  const error = new Error(message);
  error.code = payload && payload.code !== undefined ? payload.code : statusCode;
  error.requestId = payload && payload.requestId;
  error.response = payload;
  return error;
}

/**
 * 发起后端请求。
 * @param {Object} options 请求配置
 * @param {string} options.url 相对 /api/v1 的路径
 * @param {string} [options.method] HTTP 方法
 * @param {Object} [options.data] 请求体
 * @param {Object} [options.params] URL 查询参数
 * @param {boolean} [options.auth] 是否携带 JWT，默认 true
 * @param {boolean} [options.idempotent] 写操作是否自动生成 clientRequestId，默认 false
 * @returns {Promise<any>} 成功时的 data 字段
 */
export function request(options) {
  const {
    url,
    method = 'GET',
    data = {},
    params = null,
    auth = true,
    idempotent = false,
  } = options || {};

  if (!url) return Promise.reject(new Error('request: url 不能为空'));

  const isWrite = ['POST', 'PUT', 'DELETE'].includes(method.toUpperCase());
  const payload = { ...(data || {}) };
  if (isWrite && idempotent && !payload.clientRequestId) {
    payload.clientRequestId = createRequestId();
  }

  const token = auth ? getToken() : '';
  const header = {
    'Content-Type': 'application/json',
  };
  if (token) header.Authorization = `Bearer ${token}`;

  const fullUrl = `${getBaseUrl()}${url}${buildQuery(params)}`;

  return new Promise((resolve, reject) => {
    uni.request({
      url: fullUrl,
      method: method.toUpperCase(),
      data: payload,
      header,
      timeout: REQUEST_TIMEOUT,
      success(res) {
        const body = res.data;
        if (res.statusCode >= 200 && res.statusCode < 300 && body && body.code === ERROR_CODE.OK) {
          resolve(body.data);
          return;
        }
        reject(normalizeError(body, res.statusCode));
      },
      fail(err) {
        const networkError = new Error((err && err.errMsg) || '网络连接失败');
        networkError.code = -1;
        reject(networkError);
      },
    });
  });
}

/** @param {Object} options GET 请求配置 */
export function get(url, options = {}) {
  return request({ ...options, url, method: 'GET' });
}

/** @param {Object} options POST 请求配置 */
export function post(url, data = {}, options = {}) {
  return request({ ...options, url, method: 'POST', data, idempotent: options.idempotent !== false });
}

/** @param {Object} options PUT 请求配置 */
export function put(url, data = {}, options = {}) {
  return request({ ...options, url, method: 'PUT', data, idempotent: options.idempotent !== false });
}
