'use strict';

/**
 * 全局常量：状态码、角色、对局状态、棋盘尺寸。
 * 与 docs/02 §1.3 错误码表一一对应，前后端共用的枚举由 miniapp/utils/constants.js 复制。
 */

const ROLE = { PLAYER: 'player', ADMIN: 'admin' };

const MATCH_STATUS = { RUNNING: 'running', FINISHED: 'finished' };

const ERROR_CODE = {
  OK: 0,
  INVALID_PARAM: 1001,
  DUPLICATE_REQUEST: 1002,
  UNAUTHORIZED: 2001,
  FORBIDDEN: 2002,
  ADMIN_DISABLED: 2003,
  NOT_ENOUGH_GOLD: 3001,
  POOL_EMPTY: 3002,
  BENCH_FULL: 3003,
  BOARD_FULL: 3004,
  INVALID_PHASE: 3005,
  UNIT_NOT_FOUND: 3006,
  MATCH_FINISHED: 3007,
  VERSION_CONFLICT: 3008,
  LEVEL_LIMIT: 3009,
  COMBINE_FAILED: 3010,
  CONFIG_INVALID: 4001,
  INTERNAL: 5000,
};

const HTTP_STATUS_BY_CODE = {
  1001: 400,
  1002: 409,
  2001: 401,
  2002: 403,
  2003: 403,
  3001: 422,
  3002: 422,
  3003: 422,
  3004: 409,
  3005: 409,
  3006: 404,
  3007: 409,
  3008: 409,
  3009: 422,
  3010: 422,
  4001: 422,
  5000: 500,
};

/** 棋盘：4 行 × 7 列；备战席 9 格由 game_config.bench_size 决定 */
const BOARD_ROWS = 4;
const BOARD_COLS = 7;

module.exports = {
  ROLE,
  MATCH_STATUS,
  ERROR_CODE,
  HTTP_STATUS_BY_CODE,
  BOARD_ROWS,
  BOARD_COLS,
};
