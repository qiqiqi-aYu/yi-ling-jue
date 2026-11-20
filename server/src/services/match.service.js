'use strict';

/**
 * services/match.service.js —— 对局创建、聚合状态、结果查询。
 * 一局的随机种子只生成一次，之后商店 / AI / 战斗都从它 fork 子流。
 */

const crypto = require('crypto');
const { createMatchCardPool } = require('../config/balance.loader');
const { calcRoundIncome } = require('../engine/economy');
const { levelState, canBuyExp } = require('../engine/level');
const { assignRanks } = require('../engine/damage');
const { streaksOf, decorateShop } = require('./support');
const { fail } = require('../utils/errors');

/** 没有 player 表，积分只做单机演示，起点固定 1000 */
const DEMO_SCORE = 1000;

/**
 * @param {Object} ctx 依赖
 * @returns {Object} service
 */
function createMatchService(ctx) {
  const { dao, balance, shopService, traitService, economyService } = ctx;

  return {
    /**
     * 创建对局：1 真人 + 7 AI，共享卡池，真人首次免费用商店。
     * @param {{aiDifficulty?:number}} options 选项
     * @returns {Promise<Object>} 创建结果
     */
    async create(options = {}) {
      const seed = crypto.randomBytes(4).readUInt32BE(0) || 1;
      const matchId = await dao.withTransaction(async (conn) => {
        const id = await dao.createMatch(seed, conn);
        const pool = createMatchCardPool(balance);
        for (let index = 0; index < 8; index += 1) {
          await dao.createPlayer(
            {
              matchId: id,
              playerIndex: index,
              hp: balance.gameConfig.initialHp,
              gold: balance.gameConfig.initialGold,
              level: 1,
              exp: 0,
              winStreak: 0,
              board: [],
              bench: [],
              pool,
              shop: [],
              isAi: index !== 0,
            },
            conn,
          );
        }
        // 首次发牌不扣钱：数据库的初始金币就是 initial_gold
        const match = await dao.getMatch(id, conn);
        const human = await dao.getPlayer(id, 0, conn);
        await shopService.refreshCore(match, human, conn, { free: true });
        // 首次发牌已经消耗了一个随机流版本；version 从 1 起，避免第一次手动刷新复现同一排商店
        await dao.updateMatch(id, { version: 1 }, conn, 0);
        return id;
      });

      return this.get(matchId);
    },

    /** 我的对局列表 */
    async list(status, page = 1, pageSize = 20) {
      const matches = await dao.listMatches(status, page, pageSize);
      const players = await Promise.all(
        matches.map((match) => dao.getPlayer(match.id, 0)),
      );
      return matches.map((match, index) => ({
        matchId: match.id,
        seed: match.seed,
        status: match.status,
        round: match.round,
        version: match.version,
        createTime: match.create_time,
        myHp: players[index] ? players[index].hp : null,
        myRank: players[index] ? players[index].rank : null,
      }));
    },

    /** 聚合状态：对局 + 8 人 + 我的棋盘/商店 + 羁绊 + 收入预估 */
    async get(matchId) {
      const match = await dao.getMatch(matchId);
      if (!match) throw fail.unit(`match:${matchId}`);
      const players = await dao.getPlayers(matchId);
      const me = players.find((player) => player.player_index === 0);
      if (!me) throw fail.unit('player:0');
      const traits = await traitService.getTraits(matchId, 0);
      const income = calcRoundIncome(
        { goldBefore: me.gold, ...streaksOf(me.win_streak) },
        balance.engine.economyConfig,
      );
      const levelRow = balance.levels.list.find((row) => Number(row.level) === Number(me.level));
      // 等级态（所需经验 / 人口上限 / 经验条百分比）与「能否买经验」一律由内核算好，
      // 接口只输出结论，前端不参与任何金币与经验的比较。
      const levelView = levelState(Number(me.level), Number(me.exp), balance.engine.levelConfig);
      const buyExpState = canBuyExp(
        { level: levelView.level, gold: Number(me.gold) },
        balance.engine.levelConfig,
      );
      return {
        matchId: match.id,
        seed: match.seed,
        status: match.status,
        round: match.round,
        version: match.version,
        me: {
          playerIndex: 0,
          hp: me.hp,
          gold: me.gold,
          level: levelView.level,
          exp: levelView.exp,
          nextExp: levelView.nextExp,
          expPercent: levelView.expPercent,
          maxUnit: levelView.maxUnit,
          // 兼容旧前端字段：人口上限与 maxUnit 同源
          maxBoardSlots: levelRow ? levelRow.maxBoardSlots : levelView.maxUnit,
          canBuyExp: buyExpState.allowed,
          buyExpBlockedReason: buyExpState.reason,
          buyExpBlockedMessage: buyExpState.message,
          winStreak: me.win_streak,
          board: me.board,
          bench: me.bench,
        },
        players: players.map((player) => ({
          playerIndex: player.player_index,
          isAi: Boolean(player.is_ai),
          hp: player.hp,
          level: player.level,
          eliminated: Boolean(player.eliminated),
          rank: player.rank,
          unitCount: player.board.length,
        })),
        // 商店格在库里只存 slotNo/heroId/cost/locked，这里补上名称、星级、余量与羁绊名称供前端渲染
        shop: decorateShop(me.shop, balance.engine.heroes, me.pool, balance.engine.traitMeta),
        traits: traits.list,
        nextRoundIncome: {
          base: income.base,
          interest: income.interest,
          streak: income.streakBonus,
          total: income.total,
        },
      };
    },

    /** 最终名次与积分变化 */
    async result(matchId) {
      const match = await dao.getMatch(matchId);
      if (!match) throw fail.unit(`match:${matchId}`);
      const players = await dao.getPlayers(matchId);
      const ranked = assignRanks(
        players.map((player) => ({
          id: player.id,
          hp: player.hp,
          isAlive: player.hp > 0 && !player.eliminated,
          eliminatedRound: player.eliminated_round || 0,
          seatNo: player.player_index,
          finalRank: player.rank || undefined,
        })),
      );
      const human = ranked.find((player) => player.seatNo === 0);
      return {
        matchId,
        status: match.status,
        round: match.round,
        ranks: ranked.map((player) => ({
          playerIndex: player.seatNo,
          hp: player.hp,
          rank: player.finalRank,
          isAi: player.seatNo !== 0,
        })),
        myRank: human.finalRank,
        scoreBefore: DEMO_SCORE,
        scoreAfter: Math.max(0, DEMO_SCORE + (balance.gameConfig.rankScoreMap[String(human.finalRank)] || 0)),
      };
    },

    /** 投降：按当前名次结束对局（P1，接口保留） */
    async surrender(matchId, expectedVersion) {
      return dao.withTransaction(async (conn) => {
        const match = await dao.lockMatch(matchId, conn);
        if (!match) throw fail.unit(`match:${matchId}`);
        if (match.status === 'finished') throw fail.matchFinished();
        if (expectedVersion !== undefined && Number(expectedVersion) !== Number(match.version)) throw fail.version();
        const players = await dao.getPlayers(matchId, conn);
        const ranked = assignRanks(
          players.map((player) => ({
            id: player.id, hp: player.hp, isAlive: player.hp > 0,
            eliminatedRound: 0, seatNo: player.player_index,
          })),
        );
        for (const player of ranked) {
          await dao.updatePlayer(player.id, { rank: player.finalRank, eliminated: player.isAlive ? 0 : 1 }, conn);
        }
        await dao.updateMatch(matchId, { status: 'finished' }, conn, match.version);
        return { matchId, status: 'finished' };
      });
    },
  };
}

module.exports = { createMatchService, DEMO_SCORE };
