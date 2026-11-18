'use strict';

/**
 * tests/unit/balance.loader.test.js —— 配置加载器
 * 重点：DB 行 → 驼峰对象、DECIMAL 字符串转数值、JSON 解析、
 *      概率和/引用完整性校验、卡池均分、缓存与并发合并、以及与 engine 的真实对接。
 * 说明：这里的行数据用「小样本夹具」模拟 MySQL 返回，结构与 database/schema.sql 一致；
 *      真实库的联动由 `npm run config:check` 覆盖。
 */

const {
  buildBalance,
  validateBalance,
  createMatchCardPool,
  buildUnitSnapshot,
  createBalanceLoader,
  BALANCE_QUERIES,
} = require('../../src/config/balance.loader');
const { computeTraits, collectActiveEffects } = require('../../src/engine/synergy');
const { resolveUnitStats } = require('../../src/engine/stats');
const { weightedPick } = require('../../src/engine/probability');
const { calcInterest, calcRoundIncome } = require('../../src/engine/economy');
const { calcScoreDelta } = require('../../src/engine/damage');
const { createRng } = require('../../src/engine/rng');

/** 生成完整 game_config 行（键名与 seed.sql 一致，值为字符串，模拟 VARCHAR 列） */
function gameConfigRows(overrides = {}) {
  const base = {
    base_income: '5',
    interest_gold_step: '10',
    interest_per_step: '1',
    interest_cap: '5',
    max_gold: '999',
    streak_bonus_rules: '[{"minStreak":2,"bonus":1},{"minStreak":4,"bonus":2},{"minStreak":6,"bonus":3}]',
    sell_refund_rule: '{"1":1,"2":3,"3":9}',
    star_hp_multiplier: '1.80',
    star_attack_multiplier: '1.80',
    max_star: '3',
    base_round_damage: '3',
    damage_per_survivor: '1',
    rank_score_map: '{"1":30,"2":20,"3":12,"4":6,"5":-4,"6":-8,"7":-12,"8":-16}',
    score_floor: '0',
    initial_hp: '100',
    initial_gold: '5',
    battle_max_seconds: '30',
    idempotency_ttl_seconds: '300',
    ...overrides,
  };
  return Object.keys(base).map((key) => ({
    config_key: key,
    config_value: base[key],
    group_name: 'test',
  }));
}

/** 生成 1~9 级等级配置行 */
function levelRows() {
  return [1, 2, 3, 4, 5, 6, 7, 8, 9].map((level) => ({
    level,
    exp_to_next: level * 2,
    max_board_slots: level,
    refresh_cost: 2,
  }));
}

/** 生成 9×5 概率行（默认每级 100% 出 1 费，便于断言） */
function oddsRows(mutator) {
  const rows = [];
  for (let level = 1; level <= 9; level += 1) {
    for (let cost = 1; cost <= 5; cost += 1) {
      rows.push({ level, cost, probability: cost === 1 ? '1.0000' : '0.0000' });
    }
  }
  return mutator ? mutator(rows) : rows;
}

/** 小样本配置：3 个羁绊 + 5 个英雄（其中 1 个停用） */
function makeRows(overrides = {}) {
  const rows = {
    traits: [
      { id: 1, trait_key: 'race_human', name: '人族', type: 1, description: '提升攻击' },
      { id: 2, trait_key: 'race_demon', name: '妖族', type: 1, description: '提升生命' },
      { id: 7, trait_key: 'job_swordsman', name: '剑修', type: 2, description: '提升暴击' },
    ],
    traitLevels: [
      { id: 1, trait_id: 1, required_count: 2, effect_json: { atkPercent: 12 } },
      { id: 2, trait_id: 1, required_count: 4, effect_json: { atkPercent: 25 } },
      // 故意用字符串形式，验证 parseJson 兼容 mysql2 返回字符串的情况
      { id: 3, trait_id: 2, required_count: 2, effect_json: '{"hpPercent":15}' },
      { id: 4, trait_id: 2, required_count: 4, effect_json: { hpPercent: 30 } },
      { id: 5, trait_id: 7, required_count: 2, effect_json: { critRate: 12 } },
      { id: 6, trait_id: 7, required_count: 4, effect_json: { critRate: 26, critDmgPercent: 20 } },
    ],
    heroes: [
      // DECIMAL 列在 mysql2 中默认返回字符串，这里刻意保留字符串形态
      { id: 1, hero_key: 'hero_qingshan_swordsman', name: '青衫剑卒', cost: 1, base_hp: 600, base_attack: 55, attack_speed: '1.10', skill_desc: null, enabled: 1 },
      { id: 2, hero_key: 'hero_fox_imp', name: '山狐小妖', cost: 1, base_hp: 550, base_attack: 50, attack_speed: '1.05', skill_desc: null, enabled: 1 },
      { id: 3, hero_key: 'hero_chasing_wind', name: '追风剑客', cost: 2, base_hp: 720, base_attack: 72, attack_speed: '1.15', skill_desc: null, enabled: 1 },
      { id: 4, hero_key: 'hero_black_bear_king', name: '玄熊妖王', cost: 2, base_hp: 1100, base_attack: 65, attack_speed: '0.85', skill_desc: null, enabled: 1 },
      { id: 5, hero_key: 'hero_retired', name: '下架英雄', cost: 3, base_hp: 500, base_attack: 40, attack_speed: '1.00', skill_desc: null, enabled: 0 },
    ],
    heroTraits: [
      { hero_id: 1, trait_id: 1 }, { hero_id: 1, trait_id: 7 },
      { hero_id: 2, trait_id: 2 }, { hero_id: 2, trait_id: 7 },
      { hero_id: 3, trait_id: 1 }, { hero_id: 3, trait_id: 7 },
      { hero_id: 4, trait_id: 2 },
    ],
    cardPool: [
      { cost: 1, pool_size: 10 },
      { cost: 2, pool_size: 8 },
      { cost: 3, pool_size: 6 },
      { cost: 4, pool_size: 4 },
      { cost: 5, pool_size: 2 },
    ],
    levels: levelRows(),
    shopOdds: oddsRows(),
    gameConfig: gameConfigRows(),
    ...overrides,
  };
  return rows;
}

/** 组一个可通过校验的快照 */
function makeSnapshot(overrides) {
  return buildBalance(makeRows(overrides));
}

describe('buildBalance 字段映射', () => {
  test('trait / trait_level 转成驼峰，并按羁绊分组升序', () => {
    const snapshot = makeSnapshot();
    expect(snapshot.traits.list).toHaveLength(3);
    expect(snapshot.traits.races.map((trait) => trait.name)).toEqual(['人族', '妖族']);
    expect(snapshot.traits.classes.map((trait) => trait.name)).toEqual(['剑修']);

    const humanTiers = snapshot.traitLevels.byTraitId.get(1);
    expect(humanTiers.map((tier) => tier.requiredCount)).toEqual([2, 4]);
    expect(humanTiers[0].effect).toEqual({ atkPercent: 12 });
  });

  test('hero 的 DECIMAL 字段转成 number（否则引擎里会出现字符串乘法）', () => {
    const snapshot = makeSnapshot();
    const hero = snapshot.heroes.byId.get(1);
    expect(hero.attackSpeed).toBe(1.1);
    expect(typeof hero.attackSpeed).toBe('number');
    expect(hero.baseHp).toBe(600);
    expect(hero.baseAttack).toBe(55);
  });

  test('hero_trait 聚合成 heroId → traitIds[]', () => {
    const snapshot = makeSnapshot();
    expect(snapshot.heroTraits.get(1)).toEqual([1, 7]);
    expect(snapshot.heroTraits.get(4)).toEqual([2]);
    expect(snapshot.heroTraits.get(5)).toBeUndefined();
  });

  test('effect_json 为字符串时也能解析成对象', () => {
    const snapshot = makeSnapshot();
    expect(snapshot.traitLevels.byTraitId.get(2)[0].effect).toEqual({ hpPercent: 15 });
  });

  test('shop_odds_config 拼成「等级 → {费用: 概率}」', () => {
    const snapshot = makeSnapshot();
    expect(snapshot.odds.byLevel[1]).toEqual({ 1: 1, 2: 0, 3: 0, 4: 0, 5: 0 });
    expect(Object.keys(snapshot.odds.byLevel)).toHaveLength(9);
  });

  test('配置指纹随内容变化（用于战报/存档标记"这局用的哪版数值"）', () => {
    const a = makeSnapshot();
    const b = makeSnapshot({
      heroes: makeRows().heroes.map((hero) =>
        hero.id === 1 ? { ...hero, base_hp: 601 } : hero,
      ),
    });
    expect(a.version).toMatch(/^[0-9a-f]{12}$/);
    expect(b.version).not.toBe(a.version);
  });
});

describe('game_config 解析', () => {
  test('整型 / 小数 / JSON 三类参数按声明类型转换', () => {
    const snapshot = makeSnapshot();
    const cfg = snapshot.gameConfig;
    expect(cfg.baseIncome).toBe(5);
    expect(cfg.interestCap).toBe(5);
    expect(cfg.starHpMultiplier).toBe(1.8);
    expect(cfg.maxStar).toBe(3);
    expect(cfg.streakBonusRules).toEqual([
      { minStreak: 2, bonus: 1 },
      { minStreak: 4, bonus: 2 },
      { minStreak: 6, bonus: 3 },
    ]);
    expect(cfg.sellRefundRule).toEqual({ 1: 1, 2: 3, 3: 9 });
    expect(cfg.rankScoreMap[8]).toBe(-16);
  });

  test('★ 缺少必需参数直接抛错（避免引擎拿到 undefined 静默算错）', () => {
    const rows = makeRows({
      gameConfig: gameConfigRows().filter((row) => row.config_key !== 'base_income'),
    });
    expect(() => buildBalance(rows)).toThrow(/base_income/);
  });

  test('未登记的键保留原始值并给出告警', () => {
    const rows = makeRows({
      gameConfig: [...gameConfigRows(), { config_key: 'future_key', config_value: '1', group_name: 'x' }],
    });
    const snapshot = buildBalance(rows);
    expect(snapshot.warnings.join()).toContain('future_key');
    expect(snapshot.gameConfig.raw.future_key).toBe('1');
  });
});

describe('卡池均分', () => {
  test('总量按该费用启用英雄数均分', () => {
    const snapshot = makeSnapshot();
    expect(snapshot.cardPool.byCost.get(1)).toBe(10);
    expect(snapshot.cardPool.perHero.get(1)).toBe(5);
    expect(snapshot.cardPool.perHero.get(2)).toBe(5);
    expect(snapshot.cardPool.perHero.get(3)).toBe(4);
    expect(snapshot.cardPool.total).toBe(30);
  });

  test('除不尽时余数按 heroId 升序分配，并记录告警', () => {
    const pool = makeRows().cardPool.map((row) => (row.cost === 1 ? { cost: 1, pool_size: 9 } : row));
    const snapshot = buildBalance(makeRows({ cardPool: pool }));
    expect(snapshot.cardPool.perHero.get(1)).toBe(5);
    expect(snapshot.cardPool.perHero.get(2)).toBe(4);
    expect(snapshot.cardPool.unevenCosts).toEqual([1]);
    expect(snapshot.warnings.join()).toContain('无法被英雄数整除');
  });

  test('停用英雄不占用卡池（也不出现在单局卡池里）', () => {
    const snapshot = makeSnapshot();
    expect(snapshot.cardPool.perHero.has(5)).toBe(false);
    const pool = createMatchCardPool(snapshot);
    expect(pool.map((card) => card.heroId)).toEqual([1, 2, 3, 4]);
  });
});

describe('validateBalance 校验', () => {
  test('正常配置不抛错', () => {
    expect(() => validateBalance(makeSnapshot())).not.toThrow();
  });

  test('★ 某等级概率和不等于 1 时抛错并指出等级', () => {
    const rows = makeRows({
      shopOdds: oddsRows((list) =>
        list.map((row) => (row.level === 3 && row.cost === 1 ? { ...row, probability: '0.9000' } : row)),
      ),
    });
    const snapshot = buildBalance(rows);
    expect(() => validateBalance(snapshot)).toThrow(/等级 3/);
  });

  test('已启用英雄没有羁绊时抛错', () => {
    const rows = makeRows({ heroTraits: makeRows().heroTraits.filter((row) => row.hero_id !== 4) });
    const snapshot = buildBalance(rows);
    expect(() => validateBalance(snapshot)).toThrow(/未绑定任何羁绊/);
  });

  test('hero_trait 引用不存在的羁绊时抛错', () => {
    const rows = makeRows({
      heroTraits: [...makeRows().heroTraits, { hero_id: 1, trait_id: 99 }],
    });
    const snapshot = buildBalance(rows);
    expect(() => validateBalance(snapshot)).toThrow(/不存在的羁绊 99/);
  });

  test('缺档位 / 缺等级 / 缺卡池都会被发现', () => {
    const noTier = buildBalance(makeRows({ traitLevels: makeRows().traitLevels.filter((row) => row.trait_id !== 2) }));
    expect(() => validateBalance(noTier)).toThrow(/没有任何档位/);

    const noLevel = buildBalance(makeRows({ levels: levelRows().slice(0, 8) }));
    expect(() => validateBalance(noLevel)).toThrow(/应有 9 条/);
  });

  test('档位永远无法激活时给出告警（不阻塞启动）', () => {
    // 妖族只有 1 个英雄（id=4），却配了 2/4 档
    const snapshot = makeSnapshot();
    expect(snapshot.warnings.join()).toContain('永远无法激活');
  });
});

describe('engine 对接', () => {
  test('engine 配置包字段齐全（economy / stats / damage / score）', () => {
    const snapshot = makeSnapshot();
    expect(snapshot.engine.economyConfig).toMatchObject({
      baseIncome: 5,
      interestGoldStep: 10,
      interestPerStep: 1,
      interestCap: 5,
      maxGold: 999,
    });
    expect(snapshot.engine.statsConfig).toMatchObject({
      starHpMultiplier: 1.8,
      starAttackMultiplier: 1.8,
      maxStar: 3,
    });
    expect(snapshot.engine.damageConfig).toMatchObject({ baseRoundDamage: 3, damagePerSurvivor: 1 });
    expect(snapshot.engine.scoreConfig.rankScoreMap[1]).toBe(30);
    expect(snapshot.engine.traitLevels).toHaveLength(6);
    expect(snapshot.engine.traitMeta[1].name).toBe('人族');
    expect(snapshot.engine.heroes[0].traitIds).toEqual([1, 7]);
  });

  test('★ synergy：真实配置下 2 人族 + 2 剑修都激活 2 档', () => {
    const snapshot = makeSnapshot();
    const board = [
      buildUnitSnapshot(snapshot, 1, 2),
      buildUnitSnapshot(snapshot, 3, 2),
    ];
    const traits = computeTraits(board, snapshot.engine.traitLevels, snapshot.engine.traitMeta);
    const human = traits.byTraitId[1];
    const swordsman = traits.byTraitId[7];

    expect(human.heroCount).toBe(2);
    expect(human.activeLevel).toBe(2);
    expect(human.effect).toEqual({ atkPercent: 12 });
    expect(swordsman.activeLevel).toBe(2);
    expect(swordsman.nextLevel).toBe(4);
    expect(swordsman.need).toBe(2);
  });

  test('★ stats：12 表示 12%，引擎在解析时 /100（不是 12 倍）', () => {
    const snapshot = makeSnapshot();
    const board = [buildUnitSnapshot(snapshot, 1, 1), buildUnitSnapshot(snapshot, 3, 1)];
    const effects = collectActiveEffects(
      computeTraits(board, snapshot.engine.traitLevels, snapshot.engine.traitMeta).list,
    );
    const unit = resolveUnitStats(
      buildUnitSnapshot(snapshot, 1, 2),
      effects,
      snapshot.engine.statsConfig,
    );

    expect(unit.attack).toBe(110); // FLOOR(55 × 1.8) = 99 → ×1.12 = 110.88 → 110
    expect(unit.critRate).toBeCloseTo(0.12, 6); // 12% 而不是 12
    expect(unit.hp).toBe(1080); // FLOOR(600 × 1.8)
  });

  test('★ probability：用真实概率与单局卡池抽卡，seed 可复现', () => {
    const snapshot = makeSnapshot();
    const pool = createMatchCardPool(snapshot);
    const pickA = weightedPick(snapshot.engine.oddsByLevel[1], pool, createRng(2026).fork('shop'));
    const pickB = weightedPick(snapshot.engine.oddsByLevel[1], pool, createRng(2026).fork('shop'));
    expect(pickA.heroId).toBe(pickB.heroId);
    expect(pickA.cost).toBe(1); // 1 级只有 1 费
  });

  test('★ economy / damage：直接吃配置包算利息与积分', () => {
    const snapshot = makeSnapshot();
    expect(calcInterest(50, snapshot.engine.economyConfig)).toBe(5);
    const income = calcRoundIncome({ goldBefore: 32, winStreak: 3 }, snapshot.engine.economyConfig);
    expect(income).toMatchObject({ base: 5, interest: 3, streakBonus: 1, total: 9 });
    const score = calcScoreDelta({ rank: 1, currentScore: 1000 }, snapshot.engine.scoreConfig);
    expect(score.scoreAfter).toBe(1030);
  });
});

describe('buildUnitSnapshot 棋子组装', () => {
  test('补上 star 与 traitIds', () => {
    const snapshot = makeSnapshot();
    const unit = buildUnitSnapshot(snapshot, 3, 2);
    expect(unit).toMatchObject({ heroId: 3, star: 2, baseHp: 720 });
    expect(unit.traitIds).toEqual([1, 7]);
  });

  test('英雄不存在 / 已停用直接抛错', () => {
    const snapshot = makeSnapshot();
    expect(() => buildUnitSnapshot(snapshot, 999)).toThrow(RangeError);
    expect(() => buildUnitSnapshot(snapshot, 5)).toThrow(/已停用/);
  });
});

describe('createBalanceLoader 缓存', () => {
  /** 造一个假 query：按 SQL 内容返回对应表的行 */
  function fakeQuery(counter) {
    const rows = makeRows();
    const mapping = {
      [BALANCE_QUERIES.traits]: rows.traits,
      [BALANCE_QUERIES.traitLevels]: rows.traitLevels,
      [BALANCE_QUERIES.heroes]: rows.heroes,
      [BALANCE_QUERIES.heroTraits]: rows.heroTraits,
      [BALANCE_QUERIES.cardPool]: rows.cardPool,
      [BALANCE_QUERIES.levels]: rows.levels,
      [BALANCE_QUERIES.shopOdds]: rows.shopOdds,
      [BALANCE_QUERIES.gameConfig]: rows.gameConfig,
    };
    return async (sql) => {
      counter.calls += 1;
      if (!mapping[sql]) throw new Error(`未知 SQL：${sql}`);
      return mapping[sql];
    };
  }

  test('缓存命中只查一次库（8 张表 = 8 次查询）', async () => {
    const counter = { calls: 0 };
    const loader = createBalanceLoader({ query: fakeQuery(counter) });
    const first = await loader.get();
    const second = await loader.get();
    expect(counter.calls).toBe(8);
    expect(second).toBe(first);
    expect(loader.stats().loadCount).toBe(1);
  });

  test('TTL 过期后自动重载', async () => {
    const counter = { calls: 0 };
    let clock = 0;
    const loader = createBalanceLoader({
      query: fakeQuery(counter),
      ttlMs: 1000,
      now: () => clock,
    });
    await loader.get();
    clock = 500;
    await loader.get();
    expect(counter.calls).toBe(8);
    clock = 1001;
    await loader.get();
    expect(counter.calls).toBe(16);
  });

  test('reload 强制刷新（后台改完数值立即生效）', async () => {
    const counter = { calls: 0 };
    const loader = createBalanceLoader({ query: fakeQuery(counter) });
    await loader.get();
    await loader.reload();
    expect(counter.calls).toBe(16);
    expect(loader.stats().loadCount).toBe(2);
  });

  test('并发调用合并为一次查询（避免启动时打爆数据库）', async () => {
    const counter = { calls: 0 };
    const loader = createBalanceLoader({ query: fakeQuery(counter) });
    const [a, b] = await Promise.all([loader.get(), loader.get()]);
    expect(a).toBe(b);
    expect(counter.calls).toBe(8);
  });

  test('加载失败时不会留下半成品缓存（下次请求可重试）', async () => {
    let calls = 0;
    const loader = createBalanceLoader({
      query: async (sql) => {
        calls += 1;
        if (sql === BALANCE_QUERIES.gameConfig) throw new Error('DB 连接中断');
        return [];
      },
    });
    await expect(loader.get()).rejects.toThrow('DB 连接中断');
    expect(loader.peek()).toBeNull();
    expect(calls).toBe(8); // 8 张表都查过，但没有任何结果被缓存
  });
});
