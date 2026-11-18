'use strict';

/**
 * 与后端 server/src/config/constants.js 对齐的展示层枚举。
 * 前端只做状态判断与错误提示，不复制任何数值公式。
 */

export const ROLE = {
  PLAYER: 'player',
  ADMIN: 'admin',
};

export const MATCH_STATUS = {
  RUNNING: 'running',
  FINISHED: 'finished',
};

export const ERROR_CODE = {
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

export const SESSION_STORAGE_KEY = 'yilingjue_session_v1';
