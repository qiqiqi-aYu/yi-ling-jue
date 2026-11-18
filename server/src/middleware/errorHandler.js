'use strict';

const { normalizeError } = require('../utils/errors');
const { fail } = require('../utils/response');

/** 404 兜底 */
function notFound(req, res, next) {
  const err = normalizeError(new Error(`接口不存在：${req.method} ${req.originalUrl}`));
  err.code = 1001;
  err.httpStatus = 404;
  next(err);
}

/** 统一错误处理：只返回可用于用户的 code/message，不泄漏堆栈 */
function errorHandler(err, req, res, next) { // eslint-disable-line no-unused-vars
  const normalized = normalizeError(err);
  if (normalized.code === 5000) console.error('[error]', err);
  return fail(res, normalized);
}

module.exports = { notFound, errorHandler };
