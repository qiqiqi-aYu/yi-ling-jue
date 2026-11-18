'use strict';

/**
 * 包裹 async controller，自动把 rejection 转给错误处理中间件。
 * @param {Function} fn async (req,res,next)=>void
 * @returns {Function} Express handler
 */
function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

module.exports = { asyncHandler };
