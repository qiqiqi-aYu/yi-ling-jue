'use strict';

import { defineStore } from 'pinia';

import * as matchApi from '../api/match.js';
import * as shopApi from '../api/shop.js';
import * as battleApi from '../api/battle.js';
import * as traitApi from '../api/trait.js';

/**
 * 对局全局状态。
 *
 * 约束：本 Store 只保存后端 P0 接口返回的原始状态与 UI 选中项，
 * 不计算金币、收入、血量、扣血、概率、羁绊、战斗结果或任何游戏数值。
 */

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function errorOf(err) {
  return {
    code: err && err.code !== undefined ? err.code : null,
    message: (err && err.message) || '请求失败',
  };
}

async function withLoading(store, handler) {
  store.loading = true;
  store.error = null;
  try {
    return await handler();
  } catch (err) {
    store.error = errorOf(err);
    throw err;
  } finally {
    store.loading = false;
  }
}

/** 把后端写接口返回的数值原样同步到 me，不做任何推算 */
function mePatchOf(result) {
  const patch = {};
  if (!result || typeof result !== 'object') return patch;
  if (result.goldAfter !== undefined) patch.gold = result.goldAfter;
  if (result.hpAfter !== undefined) patch.hp = result.hpAfter;
  if (result.level !== undefined) patch.level = result.level;
  if (result.exp !== undefined) patch.exp = result.exp;
  if (result.maxBoardSlots !== undefined) patch.maxBoardSlots = result.maxBoardSlots;
  return patch;
}

export const useMatchStore = defineStore('match', {
  state: () => ({
    // 当前对局标识与权威状态
    matchId: null,
    detail: null,
    status: '',
    round: 0,
    version: 0,
    seed: null,
    nextRound: null,
    matchOver: false,
    myRank: null,

    // 8 人概览与我的区域
    players: [],
    me: {},
    board: [],
    bench: [],
    boardMeta: {
      boardRows: 0,
      boardCols: 0,
      maxBoardSlots: 0,
    },

    // 商店 / 羁绊 / 经济
    shop: [],
    traits: [],
    activeTraits: [],
    traitEffects: {},
    economy: null,
    nextRoundIncome: null,

    // 回合与战报
    rounds: [],
    roundDetail: null,
    battleReport: null,
    timeline: [],
    playerResults: [],
    lastSettlement: null,
    snapshot: null,
    result: null,
    matches: [],

    // 请求状态与错误
    loading: false,
    error: null,
  }),

  getters: {
    hasMatch: (state) => state.matchId !== null && state.matchId !== undefined,
  },

  actions: {
    /** 清空当前对局状态 */
    reset() {
      this.$reset();
    },

    /** 将后端聚合状态原样写入 Store */
    applyDetail(detail) {
      if (!detail || typeof detail !== 'object') return;
      this.detail = detail;
      if (detail.matchId !== undefined) this.matchId = detail.matchId;
      if (detail.status !== undefined) this.status = detail.status;
      if (detail.round !== undefined) this.round = detail.round;
      if (detail.version !== undefined) this.version = detail.version;
      if (detail.seed !== undefined) this.seed = detail.seed;
      this.players = asArray(detail.players);
      this.me = detail.me && typeof detail.me === 'object' ? { ...detail.me } : {};
      this.board = asArray(this.me.board);
      this.bench = asArray(this.me.bench);
      this.shop = asArray(detail.shop);
      this.traits = asArray(detail.traits);
      this.nextRoundIncome = detail.nextRoundIncome || null;
      if (this.me.maxBoardSlots !== undefined) {
        this.boardMeta.maxBoardSlots = this.me.maxBoardSlots;
      }
    },

    /** 同步写接口返回的版本与数值；只搬运，不计算 */
    applyWriteResult(result) {
      if (!result || typeof result !== 'object') return;
      if (result.matchId !== undefined) this.matchId = result.matchId;
      if (result.version !== undefined) this.version = result.version;
      if (result.round !== undefined) this.round = result.round;
      if (result.nextRound !== undefined) this.nextRound = result.nextRound;
      if (result.status !== undefined) this.status = result.status;
      if (result.board) this.board = asArray(result.board);
      if (result.bench) this.bench = asArray(result.bench);
      if (result.shop) this.shop = asArray(result.shop);
      if (result.level !== undefined && result.exp !== undefined) {
        this.me = { ...this.me, ...mePatchOf(result) };
      } else {
        const patch = mePatchOf(result);
        if (Object.keys(patch).length > 0) this.me = { ...this.me, ...patch };
      }
    },

    /** 取得当前 matchId，缺失时给出明确错误 */
    currentId() {
      if (this.matchId === null || this.matchId === undefined) {
        throw new Error('match store: 当前没有对局');
      }
      return this.matchId;
    },

    /** GET /matches */
    loadList(params = {}) {
      return withLoading(this, async () => {
        const rows = await matchApi.listMatches(params);
        this.matches = asArray(rows);
        return rows;
      });
    },

    /** POST /matches */
    create(payload = {}) {
      return withLoading(this, async () => {
        const detail = await matchApi.createMatch(payload);
        this.applyDetail(detail);
        return detail;
      });
    },

    /** GET /matches/:id */
    load(matchId) {
      return withLoading(this, async () => {
        const id = matchId || this.currentId();
        const detail = await matchApi.getMatch(id);
        this.applyDetail(detail);
        return detail;
      });
    },

    /** GET /matches/:id/board */
    loadBoard() {
      return withLoading(this, async () => {
        const data = await matchApi.getBoard(this.currentId());
        this.board = asArray(data.board);
        this.bench = asArray(data.bench);
        if (data.maxBoardSlots !== undefined) this.boardMeta.maxBoardSlots = data.maxBoardSlots;
        if (data.boardRows !== undefined) this.boardMeta.boardRows = data.boardRows;
        if (data.boardCols !== undefined) this.boardMeta.boardCols = data.boardCols;
        return data;
      });
    },

    /** PUT /matches/:id/board */
    submitBoard(layout) {
      return withLoading(this, async () => {
        const data = await matchApi.submitBoard(this.currentId(), {
          layout,
          version: this.version,
        });
        this.applyWriteResult(data);
        return data;
      });
    },

    /** POST /matches/:id/board/deploy：上阵 / 下阵 / 换位，成功后重新拉取权威状态 */
    placeHero(unit, target) {
      return withLoading(this, async () => {
        const data = await matchApi.deployHero(this.currentId(), unit.uid, target, {
          version: this.version,
        });
        await this.load(this.currentId());
        return data;
      });
    },

    /** GET /matches/:id/shop */
    loadShop() {
      return withLoading(this, async () => {
        const data = await shopApi.getShop(this.currentId());
        this.shop = asArray(data.shop);
        if (data.level !== undefined) this.me = { ...this.me, level: data.level };
        return data;
      });
    },

    /** POST /matches/:id/shop/refresh */
    refreshShop() {
      return withLoading(this, async () => {
        const data = await shopApi.refreshShop(this.currentId(), { version: this.version });
        // 成功后重新拉取后端聚合状态覆盖本地，不在前端改写金币/商店/卡池。
        await this.load(this.currentId());
        return data;
      });
    },

    /** POST /matches/:id/shop/buy */
    buyHero(slotNo) {
      return withLoading(this, async () => {
        const data = await shopApi.buyHero(this.currentId(), slotNo, { version: this.version });
        // 购买会同时影响金币、备战席与卡池，统一以重新拉取的后端状态为准。
        await this.load(this.currentId());
        return data;
      });
    },

    /** POST /matches/:id/heroes/:instanceId/sell */
    sellHero(instanceId) {
      return withLoading(this, async () => {
        const data = await shopApi.sellHero(this.currentId(), instanceId, { version: this.version });
        // 出售会同时影响金币、备战席与卡池，统一以重新拉取的后端状态为准。
        await this.load(this.currentId());
        return data;
      });
    },

    /**
     * POST /matches/:id/buy-exp
     * 金币消耗与经验获得量全部由后端配置决定，前端不传也不算；
     * 购买可能触发连续升级并改变人口上限，成功后整体重拉后端状态覆盖本地。
     */
    buyExp() {
      return withLoading(this, async () => {
        const data = await shopApi.buyExp(this.currentId(), { version: this.version });
        await this.load(this.currentId());
        return data;
      });
    },

    /** GET /matches/:id/economy */
    loadEconomy() {
      return withLoading(this, async () => {
        const data = await shopApi.getEconomy(this.currentId());
        this.economy = data;
        return data;
      });
    },

    /** GET /matches/:id/traits */
    loadTraits() {
      return withLoading(this, async () => {
        const data = await traitApi.getTraits(this.currentId());
        this.traits = asArray(data.list);
        this.activeTraits = asArray(data.active);
        this.traitEffects = data.effects || {};
        return data;
      });
    },

    /** GET /matches/:id/rounds */
    loadRounds() {
      return withLoading(this, async () => {
        const rows = await battleApi.listRounds(this.currentId());
        this.rounds = asArray(rows);
        return rows;
      });
    },

    /** GET /matches/:id/rounds/:roundNo */
    loadRound(roundNo) {
      return withLoading(this, async () => {
        const data = await battleApi.getRound(this.currentId(), roundNo);
        this.roundDetail = data;
        return data;
      });
    },

    /** POST /matches/:id/rounds/:roundNo/battle */
    async fightRound(roundNo) {
      const data = await withLoading(this, async () => {
        const result = await battleApi.fightRound(this.currentId(), roundNo, { version: this.version });
        this.applyWriteResult(result);
        this.battleReport = result.battle || null;
        this.timeline = asArray(result.battle && result.battle.timeline);
        this.lastSettlement = result.settlement || null;
        this.playerResults = asArray(result.playerResults);
        this.activeTraits = asArray(result.activeTraits);
        this.matchOver = Boolean(result.matchOver);
        this.myRank = result.myRank === undefined ? null : result.myRank;
        return result;
      });
      // 战斗会同时改变金币、血量、棋盘和回合状态；重新拉取后端聚合状态。
      await this.load(this.currentId());
      return data;
    },

    /** GET /matches/:id/rounds/:roundNo/battle */
    loadBattleLog(roundNo) {
      return withLoading(this, async () => {
        const data = await battleApi.getBattleLog(this.currentId(), roundNo);
        this.battleReport = data;
        this.timeline = asArray(data.timeline);
        return data;
      });
    },

    /** GET /matches/:id/result */
    loadResult() {
      return withLoading(this, async () => {
        const data = await matchApi.getResult(this.currentId());
        this.result = data;
        return data;
      });
    },

    /** GET /matches/:id/snapshots/latest */
    loadLatestSnapshot() {
      return withLoading(this, async () => {
        const data = await matchApi.getLatestSnapshot(this.currentId());
        this.snapshot = data;
        return data;
      });
    },

    /** POST /matches/:id/snapshots/:sid/restore */
    async restoreSnapshot(snapshotId) {
      const data = await withLoading(this, async () => {
        const result = await matchApi.restoreSnapshot(this.currentId(), snapshotId, {
          version: this.version,
        });
        this.applyWriteResult(result);
        return result;
      });
      await this.load(this.currentId());
      return data;
    },
  },
});
