'use strict';

import { get, post } from './request.js';

/**
 * D 组：商店与经济 P0 接口。
 * 所有扣金、收入、抽卡、升星结果都由后端返回，前端不推算。
 */

/** GET /matches/:id/shop */
export function getShop(matchId) {
  return get(`/matches/${matchId}/shop`);
}

/** POST /matches/:id/shop/refresh */
export function refreshShop(matchId, { version } = {}) {
  const data = {};
  if (version !== undefined) data.version = version;
  return post(`/matches/${matchId}/shop/refresh`, data);
}

/** POST /matches/:id/shop/buy */
export function buyHero(matchId, slotNo, { version } = {}) {
  const data = { slotNo };
  if (version !== undefined) data.version = version;
  return post(`/matches/${matchId}/shop/buy`, data);
}

/** POST /matches/:id/heroes/:instanceId/sell */
export function sellHero(matchId, instanceId, { version } = {}) {
  const data = {};
  if (version !== undefined) data.version = version;
  return post(`/matches/${matchId}/heroes/${instanceId}/sell`, data);
}

/** POST /matches/:id/level-up */
export function levelUp(matchId, count = 1, { version } = {}) {
  const data = { count };
  if (version !== undefined) data.version = version;
  return post(`/matches/${matchId}/level-up`, data);
}

/** GET /matches/:id/economy */
export function getEconomy(matchId) {
  return get(`/matches/${matchId}/economy`);
}
