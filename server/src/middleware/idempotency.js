'use strict';

/**
 * 写接口幂等中间件：clientRequestId 在 TTL 内只执行一次，重复请求直接返回首次结果。
 *
 * 落库在 idempotency_record（TTL 由 game_config.idempotency_ttl_seconds 决定）。
 * 这里包裹 res.json 捕获响应体，只在 code=0 时落库——失败请求允许客户端换参数重试。
 */

const { ERROR_CODE } = require('../config/constants');
const { AppError, fail } = require('../utils/errors');
const dao = require('../dao');

/** 默认 TTL（秒）；加载器拿到真实配置后会覆盖 */
let ttlSeconds = 300;

/** @param {number} seconds TTL 秒数 */
function setTtl(seconds) {
  if (Number.isFinite(seconds) && seconds > 0) ttlSeconds = seconds;
}

/**
 * 从 result_json 中还原首次响应。
 * @param {*} stored 保存的数据
 * @returns {*} data
 */
function unwrap(stored) {
  if (!stored) return null;
  const parsed = typeof stored === 'string' ? JSON.parse(stored) : stored;
  if (parsed && typeof parsed === 'object' && Object.prototype.hasOwnProperty.call(parsed, 'code')) {
    return parsed.data === undefined ? null : parsed.data;
  }
  return parsed;
}

/** 幂等中间件工厂 */
function idempotency(req, res, next) {
  const requestId = (req.body && req.body.clientRequestId) || req.headers['x-client-request-id'];
  if (!requestId) return next(new AppError(ERROR_CODE.DUPLICATE_REQUEST, '写操作必须带 clientRequestId'));

  const scene = req.idempotencyScene || `${req.method} ${req.baseUrl}${req.path}`;

  // 注意：此处是 async IIFE，异常必须手动 next(err)
  (async () => {
    const found = await dao.getIdempotency(requestId);
    if (found) {
      const fresh = !found.expire_time || new Date(found.expire_time).getTime() > Date.now();
      if (fresh) {
        res.locals.idempotentHit = true;
        res.locals.requestId = requestId;
        const { ok } = require('../utils/response');
        return ok(res, unwrap(found.result_json));
      }
    }

    const originalJson = res.json.bind(res);
    res.json = (body) => {
      if (body && body.code === ERROR_CODE.OK) {
        dao
          .saveIdempotency(requestId, scene, body, ttlSeconds)
          .catch(() => {}); // 幂等落库失败不能影响主流程响应
      }
      return originalJson(body);
    };
    next();
  })().catch(next);
}

module.exports = { idempotency, setTtl };
