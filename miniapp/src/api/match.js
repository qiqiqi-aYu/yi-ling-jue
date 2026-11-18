'use strict';

import { get, post, put } from './request.js';

/**
 * C 组：对局生命周期 + 整体棋盘提交。
 * G 组：P0 快照入口也放在此处，避免为两个接口单独建模块。
 * 仅封装请求，不实现任何游戏数值计算。
 */

/** POST /matches */
export function createMatch({ aiDifficulty } = {}) {
  const data = {};
  if (aiDifficulty !== undefined) data.aiDifficulty = aiDifficulty;
  return post('/matches', data);
}

/** GET /matches */
export function listMatches(params = {}) {
  return get('/matches', { params });
}

/** GET /matches/:id */
export function getMatch(matchId) {
  return get(`/matches/${matchId}`);
}

/** GET /matches/:id/board */
export function getBoard(matchId) {
  return get(`/matches/${matchId}/board`);
}

/** GET /matches/:id/result */
export function getResult(matchId) {
  return get(`/matches/${matchId}/result`);
}

/** PUT /matches/:id/board */
export function submitBoard(matchId, { layout, version } = {}) {
  const data = { layout };
  if (version !== undefined) data.version = version;
  return put(`/matches/${matchId}/board`, data);
}

/** GET /matches/:id/snapshots/latest */
export function getLatestSnapshot(matchId) {
  return get(`/matches/${matchId}/snapshots/latest`);
}

/** POST /matches/:id/snapshots/:sid/restore */
export function restoreSnapshot(matchId, snapshotId, { version } = {}) {
  const data = {};
  if (version !== undefined) data.version = version;
  return post(`/matches/${matchId}/snapshots/${snapshotId}/restore`, data);
}
