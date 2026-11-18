'use strict';

/**
 * tests/integration/level.flow.test.js —— 模块 8：等级经验与购买经验（真实 MySQL）
 *
 * 覆盖：
 *   ① 对局返回结构含 exp / nextExp / level / maxUnit 与购买状态标识
 *   ② 购买经验扣金加经验、经验溢出自动升级
 *   ③ 金币不足时禁止购买（3001）
 *   ④ 9 级时禁止购买（3009），且满级优先于金币不足
 *   ⑤ 回合战斗结算后存活玩家经验自动 +1
 */

const request = require('supertest');
const { createApp } = require('../../src/app');
const { createServices } = require('../../src/services');

const header = (token) => ({ Authorization: `Bearer ${token}` });
const rid = (suffix) => `lvl-${Date.now()}-${suffix}-${Math.random().toString(36).slice(2, 7)}`;

describe('模块 8 · 等级经验与购买经验', () => {
  let app;
  let services;
  let token;
  let matchId;
  let version;

  beforeAll(async () => {
    services = await createServices();
    app = await createApp({ services });

    const login = await request(app)
      .post('/api/v1/auth/miniapp/login')
      .send({ code: 'level-integration-code' });
    token = login.body.data.token;

    const created = await request(app)
      .post('/api/v1/matches')
      .set(header(token))
      .send({ clientRequestId: rid('create') });
    matchId = created.body.data.matchId;
    version = created.body.data.version;
  });

  afterAll(async () => {
    if (matchId) await services.dao.deleteMatch(matchId);
    const { closePool } = require('../../src/config/db');
    await closePool();
  });

  test('对局返回结构包含 exp / nextExp / level / maxUnit 与购买状态', async () => {
    const res = await request(app).get(`/api/v1/matches/${matchId}`).set(header(token));
    expect(res.body.code).toBe(0);

    const me = res.body.data.me;
    expect(me.level).toBe(1);
    expect(me.exp).toBe(0);
    expect(me.nextExp).toBe(1);
    expect(me.maxUnit).toBe(1);
    // 人口上限与等级一致，且保留旧字段避免破坏既有前端
    expect(me.maxBoardSlots).toBe(1);
    expect(me.expPercent).toBe(0);
    // 初始 5 金、1 级：允许购买
    expect(me.canBuyExp).toBe(true);
    expect(me.buyExpBlockedReason).toBeNull();
  });

  test('购买经验：扣 5 金得 4 经验，溢出经验自动连升两级', async () => {
    const res = await request(app)
      .post(`/api/v1/matches/${matchId}/buy-exp`)
      .set(header(token))
      .send({ clientRequestId: rid('buy1'), version });

    expect(res.body.code).toBe(0);
    const data = res.body.data;
    expect(data.goldBefore).toBe(5);
    expect(data.goldCost).toBe(5);
    expect(data.goldAfter).toBe(0);
    expect(data.expGain).toBe(4);
    // 1→2 耗 1 点、2→3 耗 2 点，4 点经验刚好升到 3 级并余 1
    expect(data.level).toBe(3);
    expect(data.exp).toBe(1);
    expect(data.leveled).toBe(2);
    expect(data.maxUnit).toBe(3);
    expect(data.nextExp).toBe(4);
    version = data.version;

    const detail = await request(app).get(`/api/v1/matches/${matchId}`).set(header(token));
    expect(detail.body.data.me.level).toBe(3);
    expect(detail.body.data.me.exp).toBe(1);
    expect(detail.body.data.me.maxUnit).toBe(3);
    expect(detail.body.data.me.gold).toBe(0);
    // 金币归零后应被后端判定为不可购买
    expect(detail.body.data.me.canBuyExp).toBe(false);
    expect(detail.body.data.me.buyExpBlockedReason).toBe('GOLD_NOT_ENOUGH');
  });

  test('金币不足时禁止购买经验（3001）', async () => {
    const res = await request(app)
      .post(`/api/v1/matches/${matchId}/buy-exp`)
      .set(header(token))
      .send({ clientRequestId: rid('buy-poor'), version });

    expect(res.body.code).toBe(3001);
    expect(res.body.message).toContain('金币不足');
  });

  test('回合战斗结算后存活玩家经验自动 +1', async () => {
    const before = await request(app).get(`/api/v1/matches/${matchId}`).set(header(token));
    const expBefore = before.body.data.me.exp;
    const levelBefore = before.body.data.me.level;
    expect(expBefore).toBe(1);
    expect(levelBefore).toBe(3);

    const res = await request(app)
      .post(`/api/v1/matches/${matchId}/rounds/1/battle`)
      .set(header(token))
      .send({ clientRequestId: rid('battle'), version });
    expect(res.body.code).toBe(0);

    const settlement = res.body.data.settlement;
    expect(settlement.expGained).toBe(1);
    expect(settlement.expBefore).toBe(expBefore);
    expect(settlement.expAfter).toBe(2);
    expect(settlement.levelBefore).toBe(levelBefore);
    expect(settlement.levelAfter).toBe(3);
    version = res.body.data.version;

    // 落库结果与结算一致，说明经验不是只在返回值里加了一下
    const after = await request(app).get(`/api/v1/matches/${matchId}`).set(header(token));
    expect(after.body.data.me.exp).toBe(settlement.expAfter);
    expect(after.body.data.me.level).toBe(settlement.levelAfter);
  });

  test('9 级时禁止购买经验（3009），且满级优先于金币不足', async () => {
    const player = await services.dao.getPlayer(matchId, 0);
    // 直接把玩家推到满级并给足金币，模拟后期局面
    await services.dao.updatePlayer(player.id, { level: 9, exp: 0, gold: 100 });

    const detail = await request(app).get(`/api/v1/matches/${matchId}`).set(header(token));
    const me = detail.body.data.me;
    expect(me.level).toBe(9);
    expect(me.nextExp).toBeNull();
    expect(me.expPercent).toBe(100);
    expect(me.maxUnit).toBe(9);
    expect(me.canBuyExp).toBe(false);
    expect(me.buyExpBlockedReason).toBe('LEVEL_MAX');

    const full = await request(app)
      .post(`/api/v1/matches/${matchId}/buy-exp`)
      .set(header(token))
      .send({ clientRequestId: rid('buy-max'), version });
    expect(full.body.code).toBe(3009);

    // 金币也不足时应仍然报「已达上限」，而不是先报金币不足
    await services.dao.updatePlayer(player.id, { gold: 0 });
    const poorAndFull = await request(app)
      .post(`/api/v1/matches/${matchId}/buy-exp`)
      .set(header(token))
      .send({ clientRequestId: rid('buy-max-poor'), version });
    expect(poorAndFull.body.code).toBe(3009);
  });
});
