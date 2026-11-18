'use strict';

const { ERROR_CODE, HTTP_STATUS_BY_CODE } = require('../config/constants');

/**
 * 业务异常：所有 service 抛这一种，errorHandler 统一转响应。
 */
class AppError extends Error {
  /**
   * @param {number} code 业务错误码（见 config/constants）
   * @param {string} message 面向用户的中文提示
   * @param {Object} [details] 附加调试信息
   */
  constructor(code, message, details) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.httpStatus = HTTP_STATUS_BY_CODE[code] || 500;
    this.details = details || null;
  }
}

/** 常用错误构造器，减少 service 里的魔法数字 */
const fail = {
  param: (message, details) => new AppError(ERROR_CODE.INVALID_PARAM, message, details),
  gold: (need, current) =>
    new AppError(ERROR_CODE.NOT_ENOUGH_GOLD, `金币不足：需要 ${need}，当前 ${current}`),
  poolEmpty: () => new AppError(ERROR_CODE.POOL_EMPTY, '卡池该费用已抽空'),
  benchFull: () => new AppError(ERROR_CODE.BENCH_FULL, '备战席已满'),
  boardFull: (limit) => new AppError(ERROR_CODE.BOARD_FULL, `人口已达上限（${limit}）`),
  phase: () => new AppError(ERROR_CODE.INVALID_PHASE, '当前阶段不允许该操作'),
  unit: (instanceId) => new AppError(ERROR_CODE.UNIT_NOT_FOUND, `棋子不存在：${instanceId}`),
  matchFinished: () => new AppError(ERROR_CODE.MATCH_FINISHED, '对局已结束'),
  version: () => new AppError(ERROR_CODE.VERSION_CONFLICT, '版本号冲突，请重新拉取状态'),
  level: () => new AppError(ERROR_CODE.LEVEL_LIMIT, '等级已满或经验不足'),
  levelMax: (maxLevel) => new AppError(ERROR_CODE.LEVEL_LIMIT, `已达等级上限 ${maxLevel} 级`),
  combine: () => new AppError(ERROR_CODE.COMBINE_FAILED, '同名同星棋子不足 3 个'),
  config: (message) => new AppError(ERROR_CODE.CONFIG_INVALID, message),
  auth: () => new AppError(ERROR_CODE.UNAUTHORIZED, '未登录或 token 已失效'),
  forbidden: () => new AppError(ERROR_CODE.FORBIDDEN, '角色权限不足'),
};

/**
 * 把任意异常规范成 AppError（未知异常归 5000，不泄漏堆栈给客户端）。
 * @param {Error|AppError} err 原异常
 * @returns {AppError} 规范后的异常
 */
function normalizeError(err) {
  if (err instanceof AppError) return err;
  if (err && err.code === 'ER_DUP_ENTRY') {
    return new AppError(ERROR_CODE.DUPLICATE_REQUEST, '重复请求');
  }
  return new AppError(ERROR_CODE.INTERNAL, err && err.message ? err.message : '服务器内部错误');
}

module.exports = { AppError, fail, normalizeError };
