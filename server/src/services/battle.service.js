'use strict';

/**
 * services/battle.service.js —— 回合主链路
 *
 * 一次 POST 完成：AI 决策 → 配对 → 羁绊/属性 → 战斗模拟 → 收入 / 扣血 / 淘汰 →
 * 写战报 → 写存档 → 推进回合。全部写操作在同一个事务里，战斗模拟本身不查库。
 */

const {
  simulateBattle,
} = require('../engine/combat');
const { computeTraits, collectActiveEffects } = require('../engine/synergy');
const {
  resolveTeamStats,
  applyEnemyAura,
  applyEnemySlow,
} = require('../engine/stats');
const { calcRoundIncome, calcGoldAfter } = require('../engine/economy');
const {
  calcBattleDamage,
  applyDamage,
  settleEliminations,
  assignRanks,
} = require('../engine/damage');
const { fail } = require('../utils/errors');
const { loadMutable, bumpVersion, streaksOf, nextStreak } = require('./support');
const { instanceId } = require('../utils/id');

/**
 * @param {Object} ctx 依赖
 * @returns {Object} service
 */
function createBattleService(ctx) {
  const { dao, balance, aiService, heroService, traitService, snapshotService, makeRng } = ctx;
  const economyConfig = balance.engine.economyConfig;
  const damageConfig = balance.engine.damageConfig;
  const statsConfig = balance.engine.statsConfig;
  const maxRound = balance.gameConfig.maxRound || 30;

  /** 由棋子 uid 找到对应的星级，用于扣血权重 */
  const starOf = (units, uid) => {
    const unit = units.find((item) => String(item.uid) === String(uid));
    return unit ? Number(unit.star) || 1 : 1;
  };

  /**
   * 把一方的棋盘实例变成可战斗的最终属性单位。
   * @param {Object[]} unitsIn 棋盘实例（含 row/col）
   * @param {Object} rng 随机流
   * @returns {{units:Object[], activeTraits:Object[], aura:Object, debuff:Object}} 战斗阵容
   */
  function buildTeam(unitsIn) {
    const units = traitService.toUnits(unitsIn);
    const traits = computeTraits(units, balance.engine.traitLevels, balance.engine.traitMeta);
    const effects = collectActiveEffects(traits.list);
    const resolved = resolveTeamStats(units, effects, statsConfig);
    return {
      units: resolved.units,
      activeTraits: traits.list.filter((trait) => trait.activeLevel > 0),
      aura: resolved.aura,
      debuff: resolved.enemyDebuff,
    };
  }

  return {
    /**
     * 执行一回合战斗（P0 主链路）。
     * @param {number} matchId 对局
     * @param {number} roundNo 回合号（必须等于当前回合）
     * @param {number} [expectedVersion] 乐观锁
     * @returns {Promise<Object>} 战报 + 结算
     */
    async battle(matchId, roundNo, expectedVersion) {
      if (!Number.isInteger(Number(roundNo))) throw fail.param('roundNo 必须是整数');
      const no = Number(roundNo);

      return dao.withTransaction(async (conn) => {
        const { match } = await loadMutable(dao, matchId, 0, conn, expectedVersion);
        if (no !== Number(match.round)) throw fail.phase(); // 回合号错位说明重复提交或跳步

        /* ---------- 1. AI 决策（与真人同一套规则） ---------- */
        let players = await dao.getPlayers(matchId, conn);
        const aiActions = {};
        for (const player of players) {
          if (!player.is_ai || player.hp <= 0) continue;
          const rng = makeRng(match.seed, `ai-${player.player_index}-${no}`);
          const decision = aiService.decide(
            match,
            player,
            rng,
            () => instanceId(matchId, player.player_index),
          );
          aiActions[player.player_index] = decision.actions;
          // decision.state 用的是运行时字段名，写库时必须映射回 xxx_json 列
          await dao.updatePlayer(
            player.id,
            {
              gold: decision.state.gold,
              level: decision.state.level,
              exp: decision.state.exp,
              win_streak: decision.state.win_streak,
              board_json: decision.state.board,
              bench_json: decision.state.bench,
              pool_json: decision.state.pool,
              shop_json: decision.state.shop,
            },
            conn,
          );
        }
        players = await dao.getPlayers(matchId, conn);

        /* ---------- 2. 配对（存活者随机洗牌，两两对战；奇数轮空） ---------- */
        const shuffleRng = makeRng(match.seed, `pairing-${no}`);
        const alive = players.filter((player) => player.hp > 0);
        const order = shuffleRng.shuffle(alive.slice());
        const pairs = [];
        for (let i = 0; i < order.length; i += 2) {
          pairs.push([order[i], order[i + 1] || null]);
        }

        /* ---------- 3. 逐对模拟战斗 ---------- */
        const pairReports = [];
        const resultBySeat = new Map();
        for (const [a, b] of pairs) {
          if (!b) {
            resultBySeat.set(a.player_index, {
              result: 'win', damageToA: 0, damageToB: 0, opponents: [],
            });
            pairReports.push({ a: a.player_index, b: null, result: 'win', bye: true });
            continue;
          }

          const teamA = buildTeam(a.board);
          const teamB = buildTeam(b.board);
          // 敌方光环 / 减速互相作用
          const unitsA = applyEnemySlow(applyEnemyAura(teamA.units, teamB.aura), teamB.debuff);
          const unitsB = applyEnemySlow(applyEnemyAura(teamB.units, teamA.aura), teamA.debuff);
          const battleSeed = makeRng(match.seed, `battle-${no}-${a.player_index}-${b.player_index}`).seed;
          const fight = simulateBattle({
            teamA: unitsA,
            teamB: unitsB,
            rng: makeRng(battleSeed, 'fight'),
            config: balance.engine.combatConfig,
          });

          // combat 用 'lose'，damage 引擎用 'loss'
          const resultForA = fight.result === 'lose' ? 'loss' : fight.result;
          const dmg = calcBattleDamage(
            {
              result: resultForA,
              humanSurvivors: fight.survivorUids.A.map((uid) => ({ star: starOf(teamA.units, uid) })),
              opponentSurvivors: fight.survivorUids.B.map((uid) => ({ star: starOf(teamB.units, uid) })),
            },
            damageConfig,
          );
          resultBySeat.set(a.player_index, {
            result: resultForA,
            damageToA: dmg.damageToHuman,
            damageToB: dmg.damageToOpponent,
            opponents: [b.player_index],
          });
          resultBySeat.set(b.player_index, {
            result: resultForA === 'win' ? 'loss' : resultForA === 'loss' ? 'win' : 'draw',
            damageToA: dmg.damageToOpponent,
            damageToB: dmg.damageToHuman,
            opponents: [a.player_index],
          });
          pairReports.push({
            a: a.player_index,
            b: b.player_index,
            result: fight.result,
            seed: battleSeed,
            durationSeconds: fight.durationSeconds,
            survivors: fight.survivors,
            timeline: fight.timeline,
            activeTraitsA: teamA.activeTraits,
            activeTraitsB: teamB.activeTraits,
          });
        }

        /* ---------- 4. 收入、扣血、淘汰、名次 ---------- */
        const updated = [];
        const settlements = [];
        for (const player of players) {
          const seatResult = resultBySeat.get(player.player_index) || {
            result: 'draw', damageToA: 0, damageToB: 0, opponents: [],
          };
          const streak = nextStreak(player.win_streak, seatResult.result);
          const income = calcRoundIncome(
            { goldBefore: player.gold, ...streaksOf(streak) },
            economyConfig,
          );
          const goldAfter = calcGoldAfter(
            { goldBefore: player.gold, incomeTotal: income.total },
            economyConfig,
          ).goldAfter;
          const hp = applyDamage(player.hp, seatResult.damageToA).hpAfter;
          const updatedPlayer = {
            ...player,
            hp,
            gold: goldAfter,
            win_streak: streak,
          };
          updated.push({
            ...updatedPlayer,
            isAlive: hp > 0,
            seatNo: player.player_index,
            id: player.id,
            eliminatedRound: player.hp > 0 && hp <= 0 ? no : player.eliminated_round || 0,
          });
          settlements.push({
            playerIndex: player.player_index,
            opponentIndex: seatResult.opponents[0] ?? null,
            result: seatResult.result,
            goldBefore: player.gold,
            incomeBase: income.base,
            incomeInterest: income.interest,
            incomeStreak: income.streakBonus,
            incomeTotal: income.total,
            goldAfter,
            damageTaken: seatResult.damageToA,
            damageDealt: seatResult.damageToB,
            hpBefore: player.hp,
            hpAfter: hp,
            streak,
          });
        }

        const elimination = settleEliminations(updated, no);
        const aliveCount = elimination.players.filter((player) => player.isAlive).length;
        const matchOver = aliveCount <= 1 || no >= maxRound;
        let ranked = null;
        if (matchOver) {
          ranked = assignRanks(elimination.players.map((player) => ({ ...player, hp: player.hp })));
        }
        const rankBySeat = new Map(ranked ? ranked.map((player) => [player.seatNo, player.finalRank]) : []);

        for (const player of elimination.players) {
          const rank = rankBySeat.get(player.player_index) || player.rank || null;
          await dao.updatePlayer(
            player.id,
            {
              hp: player.hp,
              gold: player.gold,
              win_streak: player.win_streak,
              eliminated: player.isAlive ? 0 : 1,
              eliminated_round: player.eliminatedRound || player.eliminated_round || null,
              rank,
            },
            conn,
          );
        }

        const humanSeat = players.find((player) => !player.is_ai);
        const humanPair = pairReports.find(
          (report) => report.a === humanSeat.player_index || report.b === humanSeat.player_index,
        ) || pairReports[0] || {};

        const roundResult = {
          roundNo: no,
          battle: {
            opponent: humanPair.b !== undefined && humanPair.b !== null
              ? { playerIndex: humanPair.b }
              : null,
            result: humanPair.result || 'draw',
            seed: humanPair.seed || null,
            durationSeconds: humanPair.durationSeconds || 0,
            survivors: humanPair.survivors || { A: 0, B: 0 },
            timeline: humanPair.timeline || [],
          },
          pairs: pairReports,
          settlement: settlements.find((item) => item.playerIndex === humanSeat.player_index) || settlements[0],
          playerResults: settlements,
          activeTraits: humanPair.activeTraitsA || [],
          aiActions,
        };

        await dao.insertRound(matchId, no, roundResult, settlements, conn);

        /* ---------- 5. 写存档 + 推进 ---------- */
        const nextState = {
          match: { ...match, round: matchOver ? no : no + 1, status: matchOver ? 'finished' : 'running' },
          players: elimination.players.map((player) => ({
            ...player,
            rank: rankBySeat.get(player.player_index) || player.rank || null,
          })),
          rng: { seed: match.seed },
        };
        const snapshotId = await snapshotService.save(matchId, no, nextState, conn);
        const version = await bumpVersion(dao, match, conn);
        if (matchOver) {
          await dao.updateMatch(matchId, { status: 'finished' }, conn, Number(match.version) + 1);
        } else {
          await dao.updateMatch(matchId, { round: no + 1 }, conn, Number(match.version) + 1);
        }

        return {
          roundNo: no,
          battle: roundResult.battle,
          settlement: roundResult.settlement,
          playerResults: settlements,
          activeTraits: roundResult.activeTraits,
          snapshotId,
          nextRound: matchOver ? null : no + 1,
          matchOver,
          myRank: rankBySeat.get(humanSeat.player_index) || null,
          version,
        };
      });
    },

    /** 回合列表 */
    async listRounds(matchId) {
      return dao.listRounds(matchId);
    },

    /** 单回合详情 */
    async getRound(matchId, roundNo) {
      const row = await dao.getRound(matchId, roundNo);
      if (!row) throw fail.unit(`round:${roundNo}`);
      return row;
    },

    /** 战报（含时间轴，前端按 timeline 的 t 播放简版动画） */
    async getBattle(matchId, roundNo) {
      const row = await dao.getRound(matchId, roundNo);
      if (!row) throw fail.unit(`round:${roundNo}`);
      const log = row.battleLog || {};
      return {
        roundNo: row.round_no,
        ...(log.battle || {}),
        pairs: log.pairs || [],
        activeTraits: log.activeTraits || [],
        aiActions: log.aiActions || {},
      };
    },
  };
}

module.exports = { createBattleService };
