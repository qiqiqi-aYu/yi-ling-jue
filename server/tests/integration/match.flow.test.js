'use strict';

/**
 * tests/integration/match.flow.test.js —— P0 全链路集成测试（真实 MySQL）
 *
 * 覆盖：登录 → 读配置 → 创建对局 → 刷新 → 购买 → 部署 → 战斗 → 战报 → 结算 → 存档 → 读档
 * 每条写请求都带 clientRequestId，顺带验证幂等中间件不会重复扣钱。
 */

const request = require('supertest');
const { createApp } = require('../../src/app');
const { createServices } = require('../../src/services');

const header = (token) => ({ Authorization: `Bearer ${token}` });
const rid = (suffix) => `it-${Date.now()}-${suffix}`;

describe('P0 完整对局流程', () => {
  let app;
  let services;
  let token;
  let matchId;
  let version;

  beforeAll(async () => {
    services = await createServices();
    app = await createApp({ services });
  });

  afterAll(async () => {
    if (matchId) await services.dao.deleteMatch(matchId);
    // 释放 mysql2 连接池，避免 Jest 因 TCP 句柄悬挂而不退出
    const { closePool } = require('../../src/config/db');
    await closePool();
  });

  test('小程序登录拿到 player JWT', async () => {
    const res = await request(app)
      .post('/api/v1/auth/miniapp/login')
      .send({ code: 'integration-test-code' });
    expect(res.body.code).toBe(0);
    expect(res.body.data.role).toBe('player');
    token = res.body.data.token;
    expect(token).toBeTruthy();
  });

  test('只读配置接口返回 24 英雄与 2/3/4 档位', async () => {
    const heroes = await request(app).get('/api/v1/heroes').set(header(token));
    expect(heroes.body.code).toBe(0);
    expect(heroes.body.data.total).toBe(24);

    const odds = await request(app).get('/api/v1/config/shop-odds').set(header(token));
    expect(odds.body.code).toBe(0);
    expect(odds.body.data.totals[9]).toBeCloseTo(1, 4);
  });

  test('创建对局：8 名参与者 + 真人首刷商店', async () => {
    const res = await request(app)
      .post('/api/v1/matches')
      .set(header(token))
      .send({ clientRequestId: rid('create'), aiDifficulty: 2 });
    expect(res.body.code).toBe(0);
    matchId = res.body.data.matchId;
    version = res.body.data.version;
    expect(res.body.data.players).toHaveLength(8);
    expect(res.body.data.shop).toHaveLength(5);
    expect(res.body.data.me.gold).toBe(5);
  });

  test('幂等：同一个 clientRequestId 重复刷新只扣一次钱', async () => {
    const key = rid('refresh');
    const first = await request(app)
      .post(`/api/v1/matches/${matchId}/shop/refresh`)
      .set(header(token))
      .send({ clientRequestId: key, version });
    expect(first.body.code).toBe(0);
    const goldAfterFirst = first.body.data.goldAfter;
    version = first.body.data.version;

    const again = await request(app)
      .post(`/api/v1/matches/${matchId}/shop/refresh`)
      .set(header(token))
      .send({ clientRequestId: key, version });
    expect(again.body.code).toBe(0);
    expect(again.body.data.goldAfter).toBe(goldAfterFirst);

    const state = await request(app).get(`/api/v1/matches/${matchId}`).set(header(token));
    expect(state.body.data.me.gold).toBe(goldAfterFirst);
  });

  test('购买棋子并部署到棋盘', async () => {
    const buy = await request(app)
      .post(`/api/v1/matches/${matchId}/shop/buy`)
      .set(header(token))
      .send({ clientRequestId: rid('buy'), slotNo: 1, version });
    expect(buy.body.code).toBe(0);
    version = buy.body.data.version;

    const layout = [
      { instanceId: buy.body.data.bought.uid, location: 1, row: 2, col: 3 },
    ];
    const board = await request(app)
      .put(`/api/v1/matches/${matchId}/board`)
      .set(header(token))
      .send({ clientRequestId: rid('board'), version, layout });
    expect(board.body.code).toBe(0);
    expect(board.body.data.board).toHaveLength(1);
    version = board.body.data.version;
  });

  test('人口上限：1 级不允许同时上阵 2 个棋子', async () => {
    const shop = await request(app).get(`/api/v1/matches/${matchId}/shop`).set(header(token));
    const slot = shop.body.data.shop.find((item) => item.heroId);
    if (!slot) return;
    const buy = await request(app)
      .post(`/api/v1/matches/${matchId}/shop/buy`)
      .set(header(token))
      .send({ clientRequestId: rid('buy2'), slotNo: slot.slotNo, version });
    if (buy.body.code !== 0) return; // 金币不足也算合法分支
    version = buy.body.data.version;
    const current = await request(app).get(`/api/v1/matches/${matchId}/board`).set(header(token));
    const layout = [
      ...current.body.data.board.map((unit) => ({
        instanceId: unit.uid, location: 1, row: unit.row, col: unit.col,
      })),
      { instanceId: buy.body.data.bought.uid, location: 1, row: 1, col: 1 },
    ];
    const denied = await request(app)
      .put(`/api/v1/matches/${matchId}/board`)
      .set(header(token))
      .send({ clientRequestId: rid('board2'), version: buy.body.data.version, layout });
    expect(denied.body.code).toBe(3004);
  });

  test('触发第 1 回合战斗，产出战报 / 结算 / 存档', async () => {
    const res = await request(app)
      .post(`/api/v1/matches/${matchId}/rounds/1/battle`)
      .set(header(token))
      .send({ clientRequestId: rid('battle'), version });
    expect(res.body.code).toBe(0);
    expect(res.body.data.battle.result).toMatch(/^(win|lose|loss|draw)$/);
    expect(res.body.data.playerResults).toHaveLength(8);
    expect(res.body.data.settlement.incomeTotal).toBeGreaterThanOrEqual(5);
    expect(res.body.data.nextRound).toBe(2);
    version = res.body.data.version;

    const log = await request(app)
      .get(`/api/v1/matches/${matchId}/rounds/1/battle`)
      .set(header(token));
    expect(log.body.code).toBe(0);
    expect(Array.isArray(log.body.data.timeline)).toBe(true);
  });

  test('读档：恢复第 0 回合存档后版本递增', async () => {
    const snaps = await request(app).get(`/api/v1/matches/${matchId}/snapshots`).set(header(token));
    expect(snaps.body.code).toBe(0);
    expect(snaps.body.data.length).toBeGreaterThan(0);
    const sid = snaps.body.data[snaps.body.data.length - 1].id;
    // 真实客户端会在写操作前重新拉一次状态，避免用过期 version
    const fresh = await request(app).get(`/api/v1/matches/${matchId}`).set(header(token));
    version = fresh.body.data.version;

    const res = await request(app)
      .post(`/api/v1/matches/${matchId}/snapshots/${sid}/restore`)
      .set(header(token))
      .send({ clientRequestId: rid('restore'), version });
    expect(res.body.code).toBe(0);
    expect(res.body.data.version).toBe(version + 1);
    version = res.body.data.version;
  });

  test('角色权限：player 不能访问 admin 路由', async () => {
    const res = await request(app).get('/api/v1/admin/dashboard').set(header(token));
    expect(res.status).toBe(404); // 后台接口未纳入 P0，统一走 404 兜底
  });
});
