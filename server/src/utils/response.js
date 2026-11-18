'use strict';

/** 统一响应体：{code, message, data, requestId, timestamp} */

/**
 * 成功响应。
 * @param {Object} res Express response
 * @param {*} data 数据
 * @param {number} [httpStatus=200] HTTP 状态码
 * @returns {Object} res
 */
function ok(res, data, httpStatus = 200) {
  return res.status(httpStatus).json({
    code: 0,
    message: 'ok',
    data: data === undefined ? null : data,
    requestId: res.locals.requestId || null,
    timestamp: Date.now(),
  });
}

/**
 * 失败响应。
 * @param {Object} res Express response
 * @param {import('./errors').AppError} err 规范化异常
 * @returns {Object} res
 */
function fail(res, err) {
  return res.status(err.httpStatus).json({
    code: err.code,
    message: err.message,
    data: null,
    requestId: res.locals.requestId || null,
    timestamp: Date.now(),
  });
}

module.exports = { ok, fail };
