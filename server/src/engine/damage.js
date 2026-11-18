'use strict';

/**
 * engine/damage.js —— 战斗结束后的扣血 / 淘汰 / 排名 / 积分（纯函数）
 * =============================================================================
 * 对应数据库：
 *   match_round.damage_to_human / damage_to_opponent   —— 本回合双方扣血
 *   match_player.hp / is_alive / final_rank / eliminated_round
 *   game_match.final_rank / score_delta
 *   player.score                                     —— 天梯积分
 *
 * 扣血规则（配置全部来自 game_config，代码不写死）：
 *   败方扣血 = base_round_damage + damage_per_survivor × Σ(胜方每个存活棋子的星级权重)
 *   平局     = 双方各扣 base_round_damage（不给存活追加，避免"平局比输还惨"）
 *   星级权重 = star_damage_weight[star]，配置未提供时退化为「星级即权重」（1/2/3），
 *              这与 config 注释「按星级加权」的口径一致。
 *
 * 排名规则（对齐 TFT 的通行做法，且完全确定可复现）：
 *   存活者按 hp 降序占 1..k 名；已被淘汰者按 淘汰回合逆序（越晚死名次越高）→ hp → 座位号。
 *   同回合同时被淘汰的两人，用 hp 降序 + 座位号兜底，保证结果唯一，
 *   否则同一批数据重算出的名次会漂移，积分也就对不上账。
 * =============================================================================
 */

/**
 * @typedef {Object} DamageConfig
 * @property {number} baseRoundDamage   base_round_damage   败方基础扣血
 * @property {number} damagePerSurvivor damage_per_survivor 胜方每个存活棋子的追加扣血
 * @property {Object<string, number>} [starDamageWeight]    星级 → 权重（可选）
 */

/**
 * @typedef {Object} ScoreConfig
 * @property {Object<string, number>} rankScoreMap rank_score_map  名次 → 积分变化（如 {"1":30,...}）
 * @property {number} scoreFloor                   score_floor      积分下限
 */

/**
 * @typedef {Object} RankedPlayer 参与者（对应一条 match_player）
 * @property {number} id 参与者 id
 * @property {number} [seatNo] 座位号 1~8
 * @property {number} [hp] 剩余血量
 * @property {boolean} [isAlive] 是否存活
 * @property {number} [eliminatedRound] 被淘汰的回合号
 */

/** 结果码 → 语义（与 match_round.result 注释一致：1=胜 2=负 3=平） */
const RESULT_CODE_MAP = { 1: 'win', 2: 'loss', 3: 'draw' };

/** 语义 → 结果码，写回数据库时用 */
const RESULT_VALUE_MAP = { win: 1, loss: 2, draw: 3 };

/**
 * 校验非负整数配置项。
 * @param {Object} config 配置
 * @param {string} key 键名
 * @returns {number} 配置值
 */
function requireInt(config, key) {
  const value = config ? config[key] : undefined;
  if (!Number.isInteger(value) || value < 0) {
    throw new TypeError(`damage: 配置项 ${key} 必须是非负整数，收到 ${value}`);
  }
  return value;
}

/**
 * 归一化战斗结果：同时接受 'win' / 1 两种写法（service 层读 DB 得到 1/2/3）。
 * @param {string|number} result 结果
 * @returns {'win'|'loss'|'draw'} 语义化结果
 * @throws {TypeError} 无法识别
 */
function normalizeResult(result) {
  if (typeof result === 'string') {
    const lower = result.toLowerCase();
    if (lower === 'win' || lower === 'loss' || lower === 'draw') return lower;
  }
  if (typeof result === 'number' && RESULT_CODE_MAP[result]) {
    return RESULT_CODE_MAP[result];
  }
  throw new TypeError(`damage: 无法识别的战斗结果 ${result}（可用 win/loss/draw 或 1/2/3）`);
}

/**
 * 计算存活棋子的「星级权重和」。
 * @param {Array<number|Object>} survivors 存活棋子（可直接传星级数组，或 [{star}] 数组）
 * @param {DamageConfig} config 伤害配置
 * @returns {{count:number, weight:number}} 存活数量与权重和
 */
function calcSurvivorWeight(survivors, config) {
  if (survivors === undefined || survivors === null) return { count: 0, weight: 0 };
  if (!Array.isArray(survivors)) {
    throw new TypeError('damage: survivors 必须是数组');
  }

  const weightMap = config && config.starDamageWeight;
  let weight = 0;

  for (const survivor of survivors) {
    const star = typeof survivor === 'number' ? survivor : survivor && survivor.star;
    if (!Number.isInteger(star) || star < 1) {
      throw new RangeError(`damage: 棋子星级必须是 >=1 的整数，收到 ${star}`);
    }
    // 未配置星级权重时退化为「星级即权重」——1 星 1 点、2 星 2 点、3 星 3 点
    const starWeight = weightMap && typeof weightMap[String(star)] === 'number'
      ? weightMap[String(star)]
      : star;
    weight += starWeight;
  }

  return { count: survivors.length, weight };
}

/**
 * 计算胜方阵容对败方造成的扣血。
 * @param {Array<number|Object>} survivors 胜方存活棋子
 * @param {DamageConfig} config 伤害配置
 * @returns {{baseDamage:number, survivorBonus:number, damage:number, survivorCount:number, survivorWeight:number}}
 */
function calcRoundDamage(survivors, config) {
  const baseDamage = requireInt(config, 'baseRoundDamage');
  const perSurvivor = requireInt(config, 'damagePerSurvivor');
  const { count, weight } = calcSurvivorWeight(survivors, config);

  const survivorBonus = perSurvivor * weight;
  return {
    baseDamage,
    survivorBonus,
    damage: baseDamage + survivorBonus,
    survivorCount: count,
    survivorWeight: weight,
  };
}

/**
 * 计算一场战斗给双方各自造成的扣血。
 *
 * @param {{result:string|number, humanSurvivors?:Array, opponentSurvivors?:Array}} input 战斗结果
 * @param {DamageConfig} config 伤害配置
 * @returns {{
 *   result:'win'|'loss'|'draw',
 *   resultCode:number,
 *   damageToHuman:number,
 *   damageToOpponent:number,
 *   breakdown:{human:Object, opponent:Object}
 * }} 扣血结果
 */
function calcBattleDamage(input, config) {
  if (!input || typeof input !== 'object') {
    throw new TypeError('damage.calcBattleDamage: 入参必须是对象');
  }
  const result = normalizeResult(input.result);
  const humanSurvivors = input.humanSurvivors || [];
  const opponentSurvivors = input.opponentSurvivors || [];

  const emptyBreakdown = {
    baseDamage: requireInt(config, 'baseRoundDamage'),
    survivorBonus: 0,
    damage: 0,
    survivorCount: 0,
    survivorWeight: 0,
  };

  if (result === 'win') {
    const toOpponent = calcRoundDamage(humanSurvivors, config);
    return {
      result,
      resultCode: RESULT_VALUE_MAP[result],
      damageToHuman: 0,
      damageToOpponent: toOpponent.damage,
      breakdown: { human: emptyBreakdown, opponent: toOpponent },
    };
  }

  if (result === 'loss') {
    const toHuman = calcRoundDamage(opponentSurvivors, config);
    return {
      result,
      resultCode: RESULT_VALUE_MAP[result],
      damageToHuman: toHuman.damage,
      damageToOpponent: 0,
      breakdown: { human: toHuman, opponent: emptyBreakdown },
    };
  }

  // 平局：双方只扣基础伤害，不给存活追加
  const base = requireInt(config, 'baseRoundDamage');
  const drawBreakdown = {
    baseDamage: base,
    survivorBonus: 0,
    damage: base,
    survivorCount: 0,
    survivorWeight: 0,
  };
  return {
    result,
    resultCode: RESULT_VALUE_MAP[result],
    damageToHuman: base,
    damageToOpponent: base,
    breakdown: { human: drawBreakdown, opponent: drawBreakdown },
  };
}

/**
 * 应用伤害：血量不会扣成负数（match_player.hp 允许负数但 UI 只显示 0，这里统一夹到 0）。
 * @param {number} hpBefore 扣血前血量
 * @param {number} damage 扣血量
 * @returns {{hpBefore:number, damage:number, hpAfter:number, overkill:number, eliminated:boolean}}
 */
function applyDamage(hpBefore, damage) {
  if (!Number.isInteger(hpBefore) || hpBefore < 0) {
    throw new RangeError(`damage: hpBefore 必须是非负整数，收到 ${hpBefore}`);
  }
  if (!Number.isInteger(damage) || damage < 0) {
    throw new RangeError(`damage: damage 必须是非负整数，收到 ${damage}`);
  }
  const hpAfter = Math.max(0, hpBefore - damage);
  return {
    hpBefore,
    damage,
    hpAfter,
    overkill: Math.max(0, damage - hpBefore),
    eliminated: hpAfter <= 0,
  };
}

/**
 * 根据战斗结果更新连胜 / 连败计数（平局双方都清零）。
 * @param {{winStreak?:number, loseStreak?:number}} player 参与者当前计数
 * @param {string|number} result 战斗结果
 * @returns {{winStreak:number, loseStreak:number}} 更新后的计数
 */
function updateStreak(player, result) {
  const normalized = normalizeResult(result);
  const winStreak = player && Number.isInteger(player.winStreak) ? player.winStreak : 0;
  const loseStreak = player && Number.isInteger(player.loseStreak) ? player.loseStreak : 0;

  if (normalized === 'win') return { winStreak: winStreak + 1, loseStreak: 0 };
  if (normalized === 'loss') return { winStreak: 0, loseStreak: loseStreak + 1 };
  return { winStreak: 0, loseStreak: 0 };
}

/**
 * 判断参与者是否存活（优先用 is_alive 字段，缺省时按 hp > 0 推断）。
 * @param {RankedPlayer} player 参与者
 * @returns {boolean} 是否存活
 */
function isPlayerAlive(player) {
  if (player.isAlive === undefined || player.isAlive === null) {
    return (player.hp || 0) > 0;
  }
  return Boolean(player.isAlive) && (player.hp === undefined || player.hp > 0);
}

/**
 * 给全部参与者分配最终名次。
 *
 * @param {RankedPlayer[]} players 参与者列表
 * @returns {Array<RankedPlayer & {finalRank:number}>} 追加 finalRank 的新数组（按名次升序）
 */
function assignRanks(players) {
  if (!Array.isArray(players) || players.length === 0) {
    throw new TypeError('damage.assignRanks: players 必须是非空数组');
  }
  const ids = new Set();
  for (const player of players) {
    if (!player || player.id === undefined) {
      throw new TypeError('damage.assignRanks: 参与者必须包含 id');
    }
    if (ids.has(String(player.id))) {
      throw new RangeError(`damage.assignRanks: 参与者 id ${player.id} 重复`);
    }
    ids.add(String(player.id));
  }

  const seat = (player) => (Number.isInteger(player.seatNo) ? player.seatNo : 0);
  const idKey = (player) => String(player.id);

  const alive = players.filter(isPlayerAlive).sort((a, b) => {
    const hpDiff = (b.hp || 0) - (a.hp || 0);
    if (hpDiff !== 0) return hpDiff;
    const seatDiff = seat(a) - seat(b);
    if (seatDiff !== 0) return seatDiff;
    return idKey(a) < idKey(b) ? -1 : 1;
  });

  const dead = players.filter((player) => !isPlayerAlive(player)).sort((a, b) => {
    // 淘汰回合越大（越晚死）名次越高
    const roundDiff = (b.eliminatedRound || 0) - (a.eliminatedRound || 0);
    if (roundDiff !== 0) return roundDiff;
    const hpDiff = (b.hp || 0) - (a.hp || 0);
    if (hpDiff !== 0) return hpDiff;
    const seatDiff = seat(a) - seat(b);
    if (seatDiff !== 0) return seatDiff;
    return idKey(a) < idKey(b) ? -1 : 1;
  });

  return [...alive, ...dead].map((player, index) => ({
    ...player,
    isAlive: isPlayerAlive(player),
    finalRank: index + 1,
  }));
}

/**
 * 回合结算的淘汰判定：把 hp<=0 的存活者标记为淘汰并记录淘汰回合。
 *
 * @param {RankedPlayer[]} players 已扣完血的参与者
 * @param {number} roundNo 当前回合号
 * @returns {{players:Array, eliminated:Array, aliveCount:number, matchOver:boolean}} 结算结果
 */
function settleEliminations(players, roundNo) {
  if (!Array.isArray(players)) {
    throw new TypeError('damage.settleEliminations: players 必须是数组');
  }
  if (!Number.isInteger(roundNo) || roundNo < 1) {
    throw new RangeError(`damage: roundNo 必须是 >=1 的整数，收到 ${roundNo}`);
  }

  const eliminated = [];
  const next = players.map((player) => {
    const wasAlive = player.isAlive === undefined ? (player.hp || 0) > 0 : Boolean(player.isAlive);
    const hp = Math.max(0, player.hp || 0);
    const shouldEliminate = wasAlive && hp <= 0;

    const updated = {
      ...player,
      hp,
      isAlive: wasAlive && !shouldEliminate,
      eliminatedRound: shouldEliminate ? roundNo : player.eliminatedRound,
    };
    if (shouldEliminate) eliminated.push(updated);
    return updated;
  });

  const aliveCount = next.filter((player) => player.isAlive).length;
  return {
    players: next,
    eliminated,
    aliveCount,
    // 只剩 1 人（或 0 人）时对局结束；达到 max_round 的结束由 round.service 另判
    matchOver: aliveCount <= 1,
  };
}

/**
 * 判断对局是否已结束。
 * @param {RankedPlayer[]} players 参与者
 * @returns {boolean} 存活人数 <= 1 时结束
 */
function isMatchOver(players) {
  if (!Array.isArray(players)) {
    throw new TypeError('damage.isMatchOver: players 必须是数组');
  }
  return players.filter(isPlayerAlive).length <= 1;
}

/**
 * 计算名次对应的积分变化（含下限保护）。
 *
 * 公式：scoreAfter = MAX(scoreFloor, scoreBefore + rankScoreMap[rank])
 *       delta      = scoreAfter - scoreBefore
 * 「下限保护」发生在扣分时：若 1000 分、第 8 名扣 16 分，但 floor=0 时正常扣除；
 * 若 scoreFloor=1000，则扣到 1000 就不再往下掉。
 *
 * @param {{rank:number, currentScore:number}} input 入参
 * @param {ScoreConfig} config 积分配置
 * @returns {{rank:number, scoreBefore:number, rawDelta:number, delta:number, scoreAfter:number, floored:boolean}}
 */
function calcScoreDelta(input, config) {
  if (!input || typeof input !== 'object') {
    throw new TypeError('damage.calcScoreDelta: 入参必须是对象');
  }
  const { rank, currentScore } = input;
  if (!Number.isInteger(rank) || rank < 1) {
    throw new RangeError(`damage: rank 必须是 >=1 的整数，收到 ${rank}`);
  }
  if (!Number.isInteger(currentScore) || currentScore < 0) {
    throw new RangeError(`damage: currentScore 必须是非负整数，收到 ${currentScore}`);
  }
  const map = config && config.rankScoreMap;
  if (!map || typeof map !== 'object') {
    throw new TypeError('damage: 缺少配置项 rankScoreMap');
  }
  const rawDelta = map[String(rank)];
  if (typeof rawDelta !== 'number' || !Number.isFinite(rawDelta)) {
    throw new RangeError(`damage: rankScoreMap 缺少名次 ${rank} 的积分配置`);
  }
  const floor = requireInt(config, 'scoreFloor');

  const scoreAfter = Math.max(floor, currentScore + rawDelta);
  return {
    rank,
    scoreBefore: currentScore,
    rawDelta,
    delta: scoreAfter - currentScore,
    scoreAfter,
    floored: scoreAfter !== currentScore + rawDelta,
  };
}

/**
 * 对局总结算：排名 → 真人积分变化。services/rank.service.js 只需把结果写库。
 *
 * @param {{players:RankedPlayer[], humanPlayerId:number, currentScore:number}} input 入参
 * @param {ScoreConfig} config 积分配置
 * @returns {{players:Array, human:Object, humanRank:number, scoreDelta:number, scoreAfter:number, matchOver:boolean}}
 */
function settleMatch(input, config) {
  if (!input || typeof input !== 'object') {
    throw new TypeError('damage.settleMatch: 入参必须是对象');
  }
  const { players, humanPlayerId, currentScore } = input;
  const ranked = assignRanks(players);
  const human = ranked.find((player) => String(player.id) === String(humanPlayerId));
  if (!human) {
    throw new RangeError(`damage: participants 中找不到真人参与者 ${humanPlayerId}`);
  }

  const score = calcScoreDelta({ rank: human.finalRank, currentScore }, config);
  return {
    players: ranked,
    human,
    humanRank: human.finalRank,
    scoreDelta: score.delta,
    scoreAfter: score.scoreAfter,
    matchOver: ranked.filter((player) => player.isAlive).length <= 1,
  };
}

module.exports = {
  normalizeResult,
  calcSurvivorWeight,
  calcRoundDamage,
  calcBattleDamage,
  applyDamage,
  updateStreak,
  assignRanks,
  settleEliminations,
  isMatchOver,
  calcScoreDelta,
  settleMatch,
  RESULT_VALUE_MAP,
};
