/**
 * engine/combat.js —— 时间轴制战斗模拟（纯函数）
 *
 * 设计取舍（对应 docs/03 §2.1）：
 *   1. **数值正确优先于动画表现**：内部是固定步长的离散模拟，输出一串带时间戳的关键帧
 *      `timeline`，前端只是「按 t 顺序播血条」，不参与任何数值计算。
 *   2. **完全可复现**：所有随机判定都走注入的 rng（engine/rng.js），
 *      同一 rng 状态 + 同一双方阵容 = 逐帧相同的战报，可写进存档做复盘。
 *   3. **不依赖 db / express / req-res**，只吃普通对象。
 *
 * 技能系统在本项目被裁剪（`hero.skill_desc` 全为空），但羁绊词表里仍有
 * `skillDmgPercent / cdReduce / spellLifesteal / healPercent / critDmgPercent` 等键。
 * 为了让这些羁绊不是「死词条」，这里采用**统一秘技模型**：
 *   - 任何棋子每普攻 `skillEveryAttacks` 次（受 cdReduce 缩减）释放一次「秘技」；
 *   - 秘技伤害 = attack × skillPowerRatio × (1 + skillDmgPercent)，同样参与暴击/减伤；
 *   - 秘技命中后，施法者回复 `秘技伤害 × spellLifesteal`；
 *   - 若施法者带 healPercent，同时治疗己方血量比例最低的存活棋子，量为 `秘技伤害 × healPercent × 0.5`。
 * 这样同一套模型就能让 12 个羁绊的加成都有明确的数值出口，且不需要给 24 个英雄逐个写技能。
 */

/** 模型默认参数：可被 config.combat 覆盖，但不进 game_config（属于「模型」而非「平衡数值」） */
const DEFAULT_COMBAT = {
  /** 单场最大模拟时长（秒），超时按剩余血量比例判定 */
  battleMaxSeconds: 30,
  /** 模拟步长（秒）。0.1 秒一帧，30 秒最多 300 帧，足够精确且开销极低 */
  tickSeconds: 0.1,
  /** 每普攻多少次释放一次秘技 */
  skillEveryAttacks: 4,
  /** 秘技基础倍率（相对攻击力） */
  skillPowerRatio: 1.5,
  /** 护甲减伤系数：减伤率 = armor / (armor + armorK) */
  armorK: 100,
  /** 暴击基础倍率，英雄的 critDmgPercent 会叠加到它上面 */
  critBaseMultiplier: 1.5,
  /** 时间轴最大帧数，超出后只保留关键帧（击杀 / 复生 / 秘技） */
  maxTimelineEntries: 600,
  /** 秘技治疗系数：治疗量 = 秘技伤害 × healPercent × 该系数 */
  healRatio: 0.5,
  /** 默认复生血量比例（羁绊未配置 reviveHpPercent 时兜底） */
  defaultReviveHpPercent: 0.3,
};

/** 血量比例低于该值时视为「残血」，用于魔族条件增伤的兜底阈值 */
const DEFAULT_HP_THRESHOLD = 0.5;

/** 单场模拟的安全阀：防止 attackSpeed 极小导致死循环 */
const MAX_TICKS = 20000;

/**
 * 读取并校验一个数值型配置。
 * @param {Object} source 配置对象
 * @param {string} key 键名
 * @param {number} fallback 缺失时的默认值
 * @param {{min?:number, integer?:boolean}} [range] 取值范围
 * @returns {number} 数值
 */
function readNumber(source, key, fallback, range = {}) {
  const raw = source && source[key] !== undefined ? source[key] : fallback;
  const value = Number(raw);
  if (!Number.isFinite(value)) {
    throw new TypeError(`combat: 配置 ${key} 必须是有限数值，收到 ${raw}`);
  }
  if (range.integer && !Number.isInteger(value)) {
    throw new TypeError(`combat: 配置 ${key} 必须是整数，收到 ${raw}`);
  }
  if (range.min !== undefined && value < range.min) {
    throw new RangeError(`combat: 配置 ${key} 不能小于 ${range.min}，收到 ${value}`);
  }
  return value;
}

/**
 * 合并默认模型参数与调用方覆盖项。
 * @param {Object} [config] 通常是 balance.loader 产出的 `snapshot.engine.combatConfig`
 * @returns {Object} 完整模型参数
 */
function resolveModel(config) {
  const source = (config && config.combat) || config || {};
  const model = {
    battleMaxSeconds: readNumber(source, 'battleMaxSeconds', DEFAULT_COMBAT.battleMaxSeconds, { min: 1 }),
    tickSeconds: readNumber(source, 'tickSeconds', DEFAULT_COMBAT.tickSeconds, { min: 0.01 }),
    skillEveryAttacks: readNumber(source, 'skillEveryAttacks', DEFAULT_COMBAT.skillEveryAttacks, {
      min: 1,
      integer: true,
    }),
    skillPowerRatio: readNumber(source, 'skillPowerRatio', DEFAULT_COMBAT.skillPowerRatio, { min: 0 }),
    armorK: readNumber(source, 'armorK', DEFAULT_COMBAT.armorK, { min: 0 }),
    critBaseMultiplier: readNumber(source, 'critBaseMultiplier', DEFAULT_COMBAT.critBaseMultiplier, { min: 1 }),
    maxTimelineEntries: readNumber(source, 'maxTimelineEntries', DEFAULT_COMBAT.maxTimelineEntries, {
      min: 1,
      integer: true,
    }),
    healRatio: readNumber(source, 'healRatio', DEFAULT_COMBAT.healRatio, { min: 0 }),
    defaultReviveHpPercent: readNumber(source, 'defaultReviveHpPercent', DEFAULT_COMBAT.defaultReviveHpPercent, {
      min: 0,
    }),
  };
  return model;
}

/**
 * 把引擎输给的棋子快照整理成模拟所需的运行态。
 *
 * 入参来自 `stats.resolveTeamStats` 的 products，字段可能不全（例如测试里只给 hp/attack），
 * 因此这里统一补默认值，避免后续到处写 `|| 0`。
 *
 * @param {Object[]} units 棋子列表
 * @param {'A'|'B'} side 阵营
 * @param {Object} model 模型参数
 * @returns {Object[]} 运行态棋子
 * @throws {TypeError} 入参不是数组 / 缺少必要属性
 * @throws {RangeError} uid 重复
 */
function normalizeTeam(units, side, model) {
  if (!Array.isArray(units)) {
    throw new TypeError(`combat: team${side} 必须是棋子数组`);
  }
  const seen = new Set();
  return units.map((unit, index) => {
    if (!unit || typeof unit !== 'object') {
      throw new TypeError(`combat: team${side}[${index}] 必须是对象`);
    }
    const uid = unit.uid !== undefined ? unit.uid : unit.instanceId !== undefined ? unit.instanceId : `${side}${index}`;
    if (seen.has(uid)) {
      throw new RangeError(`combat: 同一阵营内 uid 重复（${uid}），无法定位战报`);
    }
    seen.add(uid);

    const maxHp = Number(unit.maxHp !== undefined ? unit.maxHp : unit.hp);
    if (!Number.isFinite(maxHp) || maxHp <= 0) {
      throw new TypeError(`combat: 棋子 ${uid} 的 hp/maxHp 必须是正数，收到 ${unit.hp}/${unit.maxHp}`);
    }
    // 允许「带伤入场」：显式给了 hp 就按它作为起始血量，否则满血
    const currentHp = Number(unit.hp !== undefined ? unit.hp : maxHp);
    if (!Number.isFinite(currentHp) || currentHp <= 0) {
      throw new TypeError(`combat: 棋子 ${uid} 的起始血量必须为正数，收到 ${unit.hp}`);
    }
    const attack = Number(unit.attack !== undefined ? unit.attack : 0);
    if (!Number.isFinite(attack) || attack < 0) {
      throw new TypeError(`combat: 棋子 ${uid} 的 attack 必须是非负数，收到 ${unit.attack}`);
    }
    const attackSpeed = Number(unit.attackSpeed !== undefined ? unit.attackSpeed : 1);
    if (!Number.isFinite(attackSpeed) || attackSpeed < 0) {
      throw new TypeError(`combat: 棋子 ${uid} 的 attackSpeed 必须是非负数，收到 ${unit.attackSpeed}`);
    }

    const dynamic = unit.dynamic || {};
    return {
      uid,
      side,
      heroId: unit.heroId,
      name: unit.name,
      star: unit.star || 1,
      row: Number.isInteger(unit.row) ? unit.row : null,
      col: Number.isInteger(unit.col) ? unit.col : null,

      hp: Math.min(currentHp, maxHp),
      maxHp,
      attack,
      attackSpeed,
      armor: Number(unit.armor) || 0,
      magicResist: Number(unit.magicResist) || 0,
      dodge: clamp01(Number(unit.dodge) || 0),
      critRate: clamp01(Number(unit.critRate) || 0),
      critDmgPercent: Number(unit.critDamagePercent) || 0,
      skillDmgPercent: Number(unit.skillDmgPercent) || 0,
      cdReduce: clamp01(Number(unit.cdReduce) || 0),
      spellLifesteal: Number(unit.spellLifesteal) || 0,
      healPercent: Number(unit.healPercent) || 0,

      hpThreshold:
        dynamic.hpThreshold !== undefined && dynamic.hpThreshold > 0
          ? dynamic.hpThreshold
          : DEFAULT_HP_THRESHOLD,
      lowHpDmgPercent: Number(dynamic.lowHpDamagePercent) || 0,
      reviveChance: clamp01(Number(dynamic.reviveChance) || 0),
      reviveHpPercent:
        dynamic.reviveHpPercent !== undefined && dynamic.reviveHpPercent > 0
          ? dynamic.reviveHpPercent
          : model.defaultReviveHpPercent,

      alive: true,
      revived: false,
      attacksDone: 0,
      /** 距离下次普攻的剩余秒数：先等一个完整攻击间隔，双方首击同时 */
      timer: attackSpeed > 0 ? 1 / attackSpeed : Number.POSITIVE_INFINITY,
      damageDealt: 0,
      damageTaken: 0,
    };
  });
}

/**
 * 把数值夹在 [0,1]，用于概率类属性。
 * @param {number} value 原值
 * @returns {number} 夹取后的值
 */
function clamp01(value) {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

/**
 * 计算护甲减伤后的实际伤害。
 *
 * 减伤率 = armor / (armor + armorK)，armor=0 时无减伤；
 * 当前 15 表设计里 hero 没有护甲列，护甲只可能来自旧词表羁绊（如 `armor:30`），
 * 因此这里保留完整公式但实际多为 0，属于「口径先立住、数值后补」。
 *
 * @param {number} rawDamage 原始伤害
 * @param {number} armor 目标护甲
 * @param {number} armorK 减伤系数
 * @returns {number} 至少 1 的整数伤害
 */
function mitigate(rawDamage, armor, armorK) {
  if (!Number.isFinite(rawDamage) || rawDamage <= 0) return 0;
  const value = armor > 0 ? rawDamage * (1 - armor / (armor + armorK)) : rawDamage;
  return Math.max(1, Math.round(value));
}

/**
 * 选择攻击目标：先按棋盘曼哈顿距离取最近，同距离取血量最低，再同则取 uid 较小者。
 *
 * 用「最近 + 残血优先 + uid 兜底」而不是随机选取，是为了让战报在复盘时可解释；
 * 真正需要随机的地方（暴击 / 闪避 / 复生）才消耗 rng。
 *
 * @param {Object} attacker 攻击者
 * @param {Object[]} enemies 敌方运行态棋子
 * @returns {Object|undefined} 目标
 */
function chooseTarget(attacker, enemies) {
  const alive = enemies.filter((unit) => unit.alive !== false);
  if (alive.length === 0) return undefined;

  const distance = (unit) => {
    if (attacker.row === null || unit.row === null) return 0;
    return Math.abs(attacker.row - unit.row) + Math.abs(attacker.col - unit.col);
  };

  return alive.reduce((best, unit) => {
    if (!best) return unit;
    const dBest = distance(best);
    const dUnit = distance(unit);
    if (dUnit !== dBest) return dUnit < dBest ? unit : best;
    if (unit.hp !== best.hp) return unit.hp < best.hp ? unit : best;
    return String(unit.uid) < String(best.uid) ? unit : best;
  }, undefined);
}

/**
 * 写入时间轴（带总量上限，超出后只保留关键事件，避免 JSON 列膨胀）。
 * @param {Object} ctx 模拟上下文
 * @param {Object} frame 帧数据
 * @returns {void}
 */
function pushFrame(ctx, frame) {
  if (ctx.timeline.length < ctx.model.maxTimelineEntries) {
    ctx.timeline.push(frame);
    return;
  }
  // 已达上限：丢弃普通攻击帧，但保留击杀 / 复生 / 秘技这类关键帧
  if (frame.type === 'kill' || frame.type === 'revive' || frame.type === 'skill') {
    ctx.timeline.push(frame);
    ctx.truncated = true;
  }
}

/**
 * 模拟一次战斗。
 *
 * @param {Object} input 入参
 * @param {Object[]} input.teamA A 方棋子（通常是真人，结果以 A 视角表达）
 * @param {Object[]} input.teamB B 方棋子
 * @param {Object} input.rng 随机源（engine/rng.js 实例，必须提供 next / chance）
 * @param {Object} [input.config] 模型参数（`snapshot.engine.combatConfig`）
 * @param {number} [config] 兼容第二参数写法
 * @returns {{
 *   result: 'win'|'lose'|'draw',
 *   winner: 'A'|'B'|null,
 *   timedOut: boolean,
 *   durationSeconds: number,
 *   survivors: {A:number, B:number},
 *   survivorUids: {A:Array, B:Array},
 *   totalDamage: {A:number, B:number},
 *   timeline: Object[],
 *   timelineTruncated: boolean
 * }} 战报
 * @throws {TypeError} 入参不合法
 */
function simulateBattle(input) {
  if (!input || typeof input !== 'object') {
    throw new TypeError('combat.simulateBattle: 入参必须是对象');
  }
  const { teamA, teamB, rng } = input;
  if (!rng || typeof rng.chance !== 'function' || typeof rng.next !== 'function') {
    throw new TypeError('combat.simulateBattle: 必须传入 engine/rng.js 的随机源实例');
  }

  const model = resolveModel(input.config);
  const unitsA = normalizeTeam(teamA, 'A', model);
  const unitsB = normalizeTeam(teamB, 'B', model);
  const all = [...unitsA, ...unitsB];
  const uidSet = new Set(unitsA.map((unit) => String(unit.uid)));
  for (const unit of unitsB) {
    if (uidSet.has(String(unit.uid))) {
      throw new RangeError(`combat: 双方 uid 冲突（${unit.uid}），战报无法区分施法者`);
    }
  }

  /** 先手方由种子决定：同一 tick 内同时行动时按先手方优先，避免固定偏向 A 方 */
  const firstSide = rng.chance(0.5) ? 'A' : 'B';

  const ctx = {
    model,
    rng,
    timeline: [],
    truncated: false,
    time: 0,
    firstSide,
    /** 供秘技治疗定位「己方最残血的棋子」 */
    allies: { A: unitsA, B: unitsB },
  };

  // 任一方为空阵容 = 直接判负，不消耗模拟时间
  if (unitsA.length === 0 || unitsB.length === 0) {
    const winner = unitsA.length === 0 && unitsB.length === 0 ? null : unitsA.length === 0 ? 'B' : 'A';
    return buildReport(ctx, all, 0, false, winner);
  }

  const dt = model.tickSeconds;
  const order = buildActionOrder(all, firstSide);
  let ticks = 0;

  while (ctx.time < model.battleMaxSeconds && ticks < MAX_TICKS) {
    ticks += 1;
    ctx.time = round2(ctx.time + dt);

    for (const unit of order) {
      if (!unit.alive) continue;
      const enemies = unit.side === 'A' ? unitsB : unitsA;
      if (!enemies.some((enemy) => enemy.alive)) break;

      unit.timer = round2(unit.timer - dt);
      // attackSpeed 极端高时一个 tick 内可能多次出手，用 while 保证不丢攻击
      let guard = 0;
      while (unit.timer <= 0 && unit.alive && guard < 32) {
        guard += 1;
        act(unit, enemies, ctx);
        const interval = unit.attackSpeed > 0 ? 1 / unit.attackSpeed : Number.POSITIVE_INFINITY;
        unit.timer = round2(unit.timer + interval);
        if (!Number.isFinite(unit.timer)) break;
      }
    }

    if (!hasAlive(unitsA) || !hasAlive(unitsB)) break;
  }

  const timedOut = hasAlive(unitsA) && hasAlive(unitsB);
  let winner;
  if (timedOut) {
    // 超时：比较双方剩余血量比例之和，高者胜；完全相同判平局
    const ratioA = hpRatioSum(unitsA);
    const ratioB = hpRatioSum(unitsB);
    winner = ratioA === ratioB ? null : ratioA > ratioB ? 'A' : 'B';
  } else {
    const aliveA = unitsA.some((unit) => unit.alive);
    const aliveB = unitsB.some((unit) => unit.alive);
    winner = aliveA && !aliveB ? 'A' : aliveB && !aliveA ? 'B' : null;
  }

  return buildReport(ctx, all, ctx.time, timedOut, winner);
}

/**
 * 组帧顺序：先手方整体优先，阵营内按 uid 升序，保证同一 tick 的结算顺序可复现。
 * @param {Object[]} units 全部棋子
 * @param {'A'|'B'} firstSide 先手方
 * @returns {Object[]} 排序后的棋子
 */
function buildActionOrder(units, firstSide) {
  const rank = (unit) => (unit.side === firstSide ? 0 : 1);
  return units.slice().sort((a, b) => {
    const bySide = rank(a) - rank(b);
    if (bySide !== 0) return bySide;
    return String(a.uid) < String(b.uid) ? -1 : String(a.uid) > String(b.uid) ? 1 : 0;
  });
}

/**
 * 单次出手：判定普攻 / 秘技，再走命中流程。
 * @param {Object} attacker 攻击者
 * @param {Object[]} enemies 敌方
 * @param {Object} ctx 模拟上下文
 * @returns {void}
 */
function act(attacker, enemies, ctx) {
  const target = chooseTarget(attacker, enemies);
  if (!target) return;

  attacker.attacksDone += 1;
  // cdReduce 缩短秘技间隔：4 次 × (1 - 0.25) = 3 次
  const every = Math.max(1, Math.round(ctx.model.skillEveryAttacks * (1 - attacker.cdReduce)));
  const isSkill = attacker.attacksDone % every === 0;
  const base = isSkill ? attacker.attack * ctx.model.skillPowerRatio * (1 + attacker.skillDmgPercent) : attacker.attack;
  // 攻击力为 0（例如纯肉盾）不产生任何战报帧，避免时间轴被 0 伤害灌满
  if (base <= 0) return;

  const applied = strike(attacker, target, base, isSkill ? 'skill' : 'attack', ctx);
  if (!applied || applied.damage <= 0) return;

  // 秘技命中后的吸血 / 治疗
  if (isSkill) {
    if (attacker.spellLifesteal > 0) {
      const heal = Math.floor(applied.damage * attacker.spellLifesteal);
      healUnit(attacker, heal, ctx);
    }
    if (attacker.healPercent > 0) {
      const ally = lowestHpAlly(attacker, ctx);
      if (ally) {
        const heal = Math.floor(applied.damage * attacker.healPercent * ctx.model.healRatio);
        healUnit(ally, heal, ctx);
      }
    }
  }
}

/**
 * 命中结算：闪避 → 暴击 → 残血增伤 → 护甲减伤 → 扣血 → 击杀 / 复生。
 *
 * @param {Object} attacker 攻击者
 * @param {Object} target 目标
 * @param {number} baseDamage 基础伤害
 * @param {'attack'|'skill'} type 伤害类型
 * @param {Object} ctx 模拟上下文
 * @returns {{damage:number, crit:boolean, dodged:boolean}|null} 结算结果；目标已死返回 null
 */
function strike(attacker, target, baseDamage, type, ctx) {
  if (!target.alive) return null;

  // 闪避：只有普攻可被闪避，秘技必中（否则高闪避会让法系完全哑火）
  if (type === 'attack' && target.dodge > 0 && ctx.rng.chance(target.dodge)) {
    pushFrame(ctx, {
      t: ctx.time,
      actor: attacker.uid,
      target: target.uid,
      type: 'dodge',
      value: 0,
      targetHp: Math.round(target.hp),
    });
    return { damage: 0, crit: false, dodged: true };
  }

  let damage = baseDamage;
  let crit = false;
  if (attacker.critRate > 0 && ctx.rng.chance(attacker.critRate)) {
    crit = true;
    // 暴击倍率 = 1.5 + critDmgPercent（剑修第 4 档的 critDmgPercent:20 → 1.7 倍）
    damage *= ctx.model.critBaseMultiplier + attacker.critDmgPercent;
  }
  // 魔族：对残血目标额外伤害
  if (attacker.lowHpDmgPercent > 0 && target.hp / target.maxHp <= attacker.hpThreshold) {
    damage *= 1 + attacker.lowHpDmgPercent;
  }
  damage = mitigate(damage, target.armor, ctx.model.armorK);

  target.hp -= damage;
  target.damageTaken += damage;
  attacker.damageDealt += damage;

  pushFrame(ctx, {
    t: ctx.time,
    actor: attacker.uid,
    target: target.uid,
    type: crit ? 'crit' : type,
    value: damage,
    targetHp: Math.max(0, Math.round(target.hp)),
  });

  if (target.hp <= 0) {
    kill(target, ctx);
  }
  return { damage, crit, dodged: false };
}

/**
 * 处理阵亡：先判定冥灵复生（每场仅一次），失败才真正死亡。
 * @param {Object} target 目标
 * @param {Object} ctx 模拟上下文
 * @returns {void}
 */
function kill(target, ctx) {
  if (!target.revived && target.reviveChance > 0 && ctx.rng.chance(target.reviveChance)) {
    target.revived = true;
    target.hp = Math.max(1, Math.floor(target.maxHp * target.reviveHpPercent));
    pushFrame(ctx, {
      t: ctx.time,
      actor: target.uid,
      target: target.uid,
      type: 'revive',
      value: target.hp,
      targetHp: Math.round(target.hp),
    });
    return;
  }

  target.hp = 0;
  target.alive = false;
  pushFrame(ctx, {
    t: ctx.time,
    actor: target.uid,
    target: target.uid,
    type: 'kill',
    value: 0,
    targetHp: 0,
  });
}

/**
 * 治疗一个单位（不超过血量上限），血量有变化才写帧。
 * @param {Object} unit 目标
 * @param {number} amount 治疗量
 * @param {Object} ctx 模拟上下文
 * @returns {void}
 */
function healUnit(unit, amount, ctx) {
  if (!unit.alive || !Number.isFinite(amount) || amount <= 0) return;
  const before = unit.hp;
  unit.hp = Math.min(unit.maxHp, unit.hp + amount);
  const healed = Math.round(unit.hp - before);
  if (healed <= 0) return;
  pushFrame(ctx, {
    t: ctx.time,
    actor: unit.uid,
    target: unit.uid,
    type: 'heal',
    value: healed,
    targetHp: Math.round(unit.hp),
  });
}

/**
 * 找施法者阵营中血量比例最低的存活单位（不含自己）。
 * @param {Object} caster 施法者
 * @param {Object} ctx 模拟上下文
 * @returns {Object|undefined} 目标
 */
function lowestHpAlly(caster, ctx) {
  const allies = ctx.allies ? ctx.allies[caster.side] : undefined;
  if (!allies) return undefined;
  return allies
    .filter((unit) => unit.alive && unit.uid !== caster.uid)
    .reduce((best, unit) => {
      if (!best) return unit;
      const ratio = unit.hp / unit.maxHp;
      const bestRatio = best.hp / best.maxHp;
      if (ratio !== bestRatio) return ratio < bestRatio ? unit : best;
      return String(unit.uid) < String(best.uid) ? unit : best;
    }, undefined);
}

/**
 * 判断某阵营是否还有存活棋子。
 * @param {Object[]} units 棋子
 * @returns {boolean} 是否存活
 */
function hasAlive(units) {
  return units.some((unit) => unit.alive);
}

/**
 * 阵营剩余血量比例之和（超时判定用）。
 * @param {Object[]} units 棋子
 * @returns {number} 0~队伍人数的比例和，保留 4 位小数避免浮点抖动
 */
function hpRatioSum(units) {
  const sum = units.reduce((acc, unit) => acc + (unit.alive ? unit.hp / unit.maxHp : 0), 0);
  return Math.round(sum * 10000) / 10000;
}

/**
 * 两位小数取整（时间轴上的 t 需要整洁，避免 12.300000000000001）。
 * @param {number} value 原值
 * @returns {number} 两位小数
 */
function round2(value) {
  return Math.round(value * 100) / 100;
}

/**
 * 组装最终战报。
 * @param {Object} ctx 模拟上下文
 * @param {Object[]} all 全部棋子
 * @param {number} duration 战斗时长（秒）
 * @param {boolean} timedOut 是否超时
 * @param {'A'|'B'|null} winner 胜方
 * @returns {Object} 战报
 */
function buildReport(ctx, all, duration, timedOut, winner) {
  const survivorsA = all.filter((unit) => unit.side === 'A' && unit.alive).map((unit) => unit.uid);
  const survivorsB = all.filter((unit) => unit.side === 'B' && unit.alive).map((unit) => unit.uid);
  const result = winner === 'A' ? 'win' : winner === 'B' ? 'lose' : 'draw';

  return {
    result,
    winner,
    timedOut,
    durationSeconds: round2(duration),
    survivors: { A: survivorsA.length, B: survivorsB.length },
    survivorUids: { A: survivorsA, B: survivorsB },
    totalDamage: {
      A: all.filter((unit) => unit.side === 'A').reduce((acc, unit) => acc + unit.damageDealt, 0),
      B: all.filter((unit) => unit.side === 'B').reduce((acc, unit) => acc + unit.damageDealt, 0),
    },
    timeline: ctx.timeline,
    timelineTruncated: ctx.truncated,
  };
}

module.exports = {
  simulateBattle,
  // 以下导出供单测与调试使用，业务代码不应依赖
  resolveModel,
  mitigate,
  chooseTarget,
  DEFAULT_COMBAT,
};
