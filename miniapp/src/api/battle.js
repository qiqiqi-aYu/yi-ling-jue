'use strict';

import { get, post } from './request.js';

/**
 * F 组：回合与战斗 P0 接口。
 * 时间轴由服务端战斗模拟产生，前端只保存和展示，不重算战斗结果。
 */

/** GET /matches/:id/rounds */
export function listRounds(matchId) {
  return get(`/matches/${matchId}/rounds`);
}

/** GET /matches/:id/rounds/:roundNo */
export function getRound(matchId, roundNo) {
  return get(`/matches/${matchId}/rounds/${roundNo}`);
}

/** POST /matches/:id/rounds/:roundNo/battle */
export function fightRound(matchId, roundNo, { version } = {}) {
  const data = {};
  if (version !== undefined) data.version = version;
  return post(`/matches/${matchId}/rounds/${roundNo}/battle`, data);
}

/** GET /matches/:id/rounds/:roundNo/battle */
export function getBattleLog(matchId, roundNo) {
  return get(`/matches/${matchId}/rounds/${roundNo}/battle`);
}
