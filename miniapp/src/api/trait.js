'use strict';

import { get } from './request.js';

/**
 * E 组：实时羁绊 P0 接口。
 * 英雄计数、已激活档位和下一档需求全部来自后端。
 */

/** GET /matches/:id/traits */
export function getTraits(matchId) {
  return get(`/matches/${matchId}/traits`);
}
