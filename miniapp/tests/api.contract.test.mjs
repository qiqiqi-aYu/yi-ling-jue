import test from 'node:test';
import assert from 'node:assert/strict';
import { createPinia, setActivePinia } from 'pinia';

import { getBaseUrl } from '../src/api/request.js';
import * as matchApi from '../src/api/match.js';
import * as shopApi from '../src/api/shop.js';
import * as battleApi from '../src/api/battle.js';
import * as traitApi from '../src/api/trait.js';
import { useMatchStore } from '../src/store/match.js';

const calls = [];

function mockApi(handler) {
  calls.length = 0;
  globalThis.uni = {
    getStorageSync: () => '',
    setStorageSync: () => {},
    removeStorageSync: () => {},
    request(options) {
      calls.push(options);
      const result = handler(options) || {};
      if (result.fail) {
        options.fail({ errMsg: result.fail });
        return;
      }
      options.success({
        statusCode: result.statusCode || 200,
        data: {
          code: result.code === undefined ? 0 : result.code,
          message: result.message || 'ok',
          data: result.data === undefined ? {} : result.data,
          requestId: 'contract-test',
        },
      });
    },
  };
}

const base = getBaseUrl();

const contracts = [
  {
    name: 'createMatch → POST /matches',
    run: () => matchApi.createMatch({ aiDifficulty: 2 }),
    method: 'POST',
    url: `${base}/matches`,
    check: (body) => body.aiDifficulty === 2 && Boolean(body.clientRequestId),
  },
  {
    name: 'listMatches → GET /matches?status=running',
    run: () => matchApi.listMatches({ status: 'running', page: 2 }),
    method: 'GET',
    url: `${base}/matches?status=running&page=2`,
    check: (body) => body && typeof body === 'object',
  },
  {
    name: 'getMatch → GET /matches/:id',
    run: () => matchApi.getMatch(7),
    method: 'GET',
    url: `${base}/matches/7`,
  },
  {
    name: 'getBoard → GET /matches/:id/board',
    run: () => matchApi.getBoard(7),
    method: 'GET',
    url: `${base}/matches/7/board`,
  },
  {
    name: 'getResult → GET /matches/:id/result',
    run: () => matchApi.getResult(7),
    method: 'GET',
    url: `${base}/matches/7/result`,
  },
  {
    name: 'submitBoard → PUT /matches/:id/board（带 version）',
    run: () => matchApi.submitBoard(7, { version: 4, layout: [] }),
    method: 'PUT',
    url: `${base}/matches/7/board`,
    check: (body) => body.version === 4 && Array.isArray(body.layout) && Boolean(body.clientRequestId),
  },
  {
    name: 'deployHero → POST /board/deploy',
    run: () => matchApi.deployHero(7, 50001, { location: 1, row: 2, col: 3 }, { version: 4 }),
    method: 'POST',
    url: `${base}/matches/7/board/deploy`,
    check: (body) =>
      body.instanceId === 50001 &&
      body.location === 1 &&
      body.row === 2 &&
      body.col === 3 &&
      body.version === 4 &&
      Boolean(body.clientRequestId),
  },
  {
    name: 'getLatestSnapshot → GET /snapshots/latest',
    run: () => matchApi.getLatestSnapshot(7),
    method: 'GET',
    url: `${base}/matches/7/snapshots/latest`,
  },
  {
    name: 'restoreSnapshot → POST /snapshots/:sid/restore',
    run: () => matchApi.restoreSnapshot(7, 99, { version: 8 }),
    method: 'POST',
    url: `${base}/matches/7/snapshots/99/restore`,
    check: (body) => body.version === 8 && Boolean(body.clientRequestId),
  },
  {
    name: 'refreshShop → POST /shop/refresh',
    run: () => shopApi.refreshShop(7, { version: 4 }),
    method: 'POST',
    url: `${base}/matches/7/shop/refresh`,
    check: (body) => body.version === 4 && Boolean(body.clientRequestId),
  },
  {
    name: 'buyHero → POST /shop/buy',
    run: () => shopApi.buyHero(7, 2, { version: 4 }),
    method: 'POST',
    url: `${base}/matches/7/shop/buy`,
    check: (body) => body.slotNo === 2 && body.version === 4,
  },
  {
    name: 'sellHero → POST /heroes/:uid/sell',
    run: () => shopApi.sellHero(7, 50001, { version: 4 }),
    method: 'POST',
    url: `${base}/matches/7/heroes/50001/sell`,
    check: (body) => body.version === 4,
  },
  {
    name: 'buyExp → POST /buy-exp（只传 version，金币与经验由后端决定）',
    run: () => shopApi.buyExp(7, { version: 4 }),
    method: 'POST',
    url: `${base}/matches/7/buy-exp`,
    check: (body) =>
      body.version === 4 &&
      Boolean(body.clientRequestId) &&
      body.gold === undefined &&
      body.exp === undefined &&
      body.count === undefined,
  },
  {
    name: 'getEconomy → GET /economy',
    run: () => shopApi.getEconomy(7),
    method: 'GET',
    url: `${base}/matches/7/economy`,
  },
  {
    name: 'fightRound → POST /rounds/:n/battle',
    run: () => battleApi.fightRound(7, 1, { version: 4 }),
    method: 'POST',
    url: `${base}/matches/7/rounds/1/battle`,
    check: (body) => body.version === 4 && Boolean(body.clientRequestId),
  },
  {
    name: 'getBattleLog → GET /rounds/:n/battle',
    run: () => battleApi.getBattleLog(7, 1),
    method: 'GET',
    url: `${base}/matches/7/rounds/1/battle`,
  },
  {
    name: 'getTraits → GET /traits',
    run: () => traitApi.getTraits(7),
    method: 'GET',
    url: `${base}/matches/7/traits`,
  },
];

for (const contract of contracts) {
  test(contract.name, async () => {
    mockApi(() => ({ data: { ok: true } }));
    await contract.run();
    assert.equal(calls.length, 1);
    assert.equal(calls[0].method, contract.method);
    assert.equal(calls[0].url, contract.url);
    if (contract.check) assert.equal(contract.check(calls[0].data), true);
  });
}

test('Store 只搬运后端状态：创建 → 刷新 → 购买 → 部署 → 出售 → 战斗', async () => {
  setActivePinia(createPinia());

  const detail1 = {
    matchId: 7,
    status: 'running',
    round: 1,
    version: 3,
    seed: 123,
    me: { playerIndex: 0, hp: 100, gold: 5, level: 1, exp: 0, board: [], bench: [], maxBoardSlots: 1 },
    players: [{ playerIndex: 0, hp: 100 }],
    shop: [{ slotNo: 1, heroId: 1, cost: 1 }],
    traits: [],
    nextRoundIncome: { base: 5, interest: 0, streak: 0, total: 5 },
  };
  let currentDetail = detail1;

  mockApi(({ method, url, data }) => {
    if (method === 'POST' && url.endsWith('/matches')) {
      currentDetail = detail1;
      return { data: detail1 };
    }
    if (method === 'POST' && url.endsWith('/shop/refresh')) {
      currentDetail = {
        ...currentDetail,
        version: 4,
        me: { ...currentDetail.me, gold: 3 },
        shop: [{ slotNo: 1, heroId: 5 }],
      };
      return { data: { shop: currentDetail.shop, goldAfter: 3, version: 4 } };
    }
    if (method === 'POST' && url.endsWith('/shop/buy')) {
      currentDetail = {
        ...currentDetail,
        version: 5,
        me: { ...currentDetail.me, gold: 2, bench: [{ uid: 50001 }] },
        shop: [{ slotNo: 1, heroId: null }],
      };
      return {
        data: { bought: { uid: 50001 }, bench: currentDetail.me.bench, goldAfter: 2, version: 5 },
      };
    }
    if (method === 'PUT' && url.endsWith('/board')) {
      const board = [{ uid: 50001, row: 0, col: 0 }];
      currentDetail = {
        ...currentDetail,
        version: 6,
        me: { ...currentDetail.me, board, bench: [] },
      };
      return { data: { board, bench: [], version: 6 } };
    }
    if (method === 'POST' && url.endsWith('/board/deploy')) {
      const removing = data.location === 2;
      const board = removing ? [] : [{ uid: data.instanceId, row: data.row, col: data.col }];
      const bench = removing ? [{ uid: data.instanceId }] : [];
      const version = removing ? 7 : 8;
      currentDetail = {
        ...currentDetail,
        version,
        me: { ...currentDetail.me, board, bench },
      };
      return { data: { board, bench, version } };
    }
    if (method === 'POST' && url.endsWith('/sell')) {
      currentDetail = {
        ...currentDetail,
        version: 9,
        me: { ...currentDetail.me, bench: [] },
      };
      return { data: { sold: { uid: 50001 }, refund: 1, version: 9 } };
    }
    if (method === 'POST' && url.endsWith('/battle')) {
      currentDetail = {
        ...currentDetail,
        round: 2,
        version: 10,
        me: { ...currentDetail.me, hp: 90, gold: 8 },
      };
      return {
        data: {
          roundNo: 1,
          battle: { result: 'win', timeline: [{ t: 0.9, type: 'attack', value: 42 }] },
          settlement: { goldAfter: 8, hpAfter: 90 },
          playerResults: [{ playerIndex: 0, damageTaken: 0 }],
          activeTraits: [],
          nextRound: 2,
          matchOver: false,
          myRank: null,
          version: 10,
        },
      };
    }
    if (method === 'POST' && url.endsWith('/buy-exp')) {
      // 购买经验会同时改变金币、等级、所需经验与人口上限，Store 必须整体重拉
      currentDetail = {
        ...currentDetail,
        version: 11,
        me: {
          ...currentDetail.me,
          gold: 3,
          level: 2,
          exp: 0,
          nextExp: 2,
          expPercent: 0,
          maxUnit: 2,
          canBuyExp: true,
          buyExpBlockedReason: null,
        },
      };
      return {
        data: {
          goldBefore: 8,
          goldCost: 5,
          goldAfter: 3,
          expGain: 4,
          level: 2,
          exp: 0,
          nextExp: 2,
          maxUnit: 2,
          expPercent: 0,
          leveled: 1,
          version: 11,
        },
      };
    }
    if (method === 'GET' && url.endsWith('/matches/7')) return { data: currentDetail };
    return { data: {} };
  });
  const store = useMatchStore();

  await store.create({ aiDifficulty: 2 });
  assert.equal(store.matchId, 7);
  assert.equal(store.version, 3);
  assert.equal(store.shop[0].heroId, 1);

  calls.length = 0;
  await store.refreshShop();
  assert.deepEqual(
    calls.map((call) => call.method),
    ['POST', 'GET'],
  );
  assert.equal(store.version, 4);
  assert.equal(store.me.gold, 3);
  assert.equal(store.shop[0].heroId, 5);

  calls.length = 0;
  await store.buyHero(1);
  assert.deepEqual(
    calls.map((call) => call.method),
    ['POST', 'GET'],
  );
  assert.equal(store.version, 5);
  assert.equal(store.me.gold, 2);
  assert.equal(store.shop[0].heroId, null);

  await store.submitBoard([{ instanceId: 50001, location: 1, row: 0, col: 0 }]);
  assert.equal(store.version, 6);
  assert.equal(store.board.length, 1);
  assert.equal(store.board[0].row, 0);

  calls.length = 0;
  await store.placeHero({ uid: 50001 }, { location: 2 });
  assert.deepEqual(
    calls.map((call) => call.method),
    ['POST', 'GET'],
  );
  assert.equal(store.version, 7);
  assert.equal(store.board.length, 0);
  assert.equal(store.bench.length, 1);

  calls.length = 0;
  await store.placeHero({ uid: 50001 }, { location: 1, row: 2, col: 3 });
  assert.deepEqual(
    calls.map((call) => call.method),
    ['POST', 'GET'],
  );
  assert.equal(store.version, 8);
  assert.equal(store.board.length, 1);
  assert.equal(store.board[0].row, 2);
  assert.equal(store.bench.length, 0);

  calls.length = 0;
  await store.sellHero(50001);
  assert.deepEqual(
    calls.map((call) => call.method),
    ['POST', 'GET'],
  );
  assert.equal(store.version, 9);
  assert.equal(store.bench.length, 0);

  calls.length = 0;
  await store.fightRound(1);
  assert.deepEqual(
    calls.map((call) => call.method),
    ['POST', 'GET'],
  );
  assert.equal(store.version, 10);
  assert.equal(store.round, 2);
  assert.equal(store.timeline.length, 1);
  assert.equal(store.timeline[0].value, 42);
  assert.equal(store.me.gold, 8);
  assert.equal(store.me.hp, 90);

  calls.length = 0;
  await store.buyExp();
  // 购买经验必须先 POST 再 GET，用后端返回的完整状态覆盖本地
  assert.deepEqual(
    calls.map((call) => call.method),
    ['POST', 'GET'],
  );
  assert.equal(calls[0].url, `${base}/matches/7/buy-exp`);
  assert.equal(calls[0].data.version, 10);
  assert.equal(store.version, 11);
  assert.equal(store.me.level, 2);
  assert.equal(store.me.exp, 0);
  assert.equal(store.me.nextExp, 2);
  assert.equal(store.me.maxUnit, 2);
  // 按钮可用状态完全来自后端字段，Store 只搬运不推导
  assert.equal(store.me.canBuyExp, true);
  assert.equal(store.me.buyExpBlockedReason, null);
});

test('Store 保留后端版本冲突错误码', async () => {
  setActivePinia(createPinia());
  mockApi(() => ({ code: 3008, message: '版本号冲突' }));
  const store = useMatchStore();
  store.matchId = 7;
  store.version = 4;

  await assert.rejects(() => store.refreshShop());
  assert.equal(store.error.code, 3008);
});
