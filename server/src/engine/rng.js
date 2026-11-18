'use strict';

/**
 * engine/rng.js —— 可注入 seed 的伪随机数发生器（PRNG）
 * =============================================================================
 * 设计目标
 *   1. 可复现：同一个 seed + 同一串调用顺序 => 完全相同的随机序列，
 *      因此「战斗结果」「商店抽卡结果」都能用 seed 复算并写进单测。
 *   2. 零依赖：不引入 seedrandom 等第三方库，算法用 mulberry32（32 位状态，
 *      周期 2^32，统计性质足够本项目的抽卡 / 战斗模拟），便于课设逐行讲解。
 *   3. 可存档：暴露 state 读写，配合 match_snapshot 可在任意时刻冻结随机流。
 *
 * 重要约定
 *   - engine 内部**禁止**调用 Math.random()，所有随机性必须来自本模块，
 *     否则同 seed 无法复算（battle_log.seed 的唯一价值就在这里）。
 *   - 随机数的「消耗顺序」也是结果的一部分：先抽费用档、再抽具体英雄；
 *     改动消耗顺序等价于改变数值结果，必须同步更新单测。
 * =============================================================================
 */

/** 2^32，用于把浮点随机数归一化到 [0,1) */
const TWO_POW_32 = 4294967296;
/** BigInt 的低 32 位掩码 */
const MASK_32 = 0xffffffffn;
/** 32 位无符号上界 */
const UINT32_MAX = 0xffffffff;

/** mulberry32 的状态递推步长 */
const MULBERRY_STEP = 0x6d2b79f5;

/**
 * 32 位雪崩混合（splitmix32 的 finalizer）。
 * 作用：把「1、2、3 这类过于规整的种子」打散，避免相邻种子产生高度相关的序列。
 * @param {number} x 任意 32 位整数
 * @returns {number} 混合后的 32 位无符号整数
 */
function mix32(x) {
  let v = x >>> 0;
  v = (v + 0x9e3779b9) >>> 0;
  v = Math.imul(v ^ (v >>> 16), 0x21f0aaad) >>> 0;
  v = Math.imul(v ^ (v >>> 15), 0x735a2d97) >>> 0;
  return (v ^ (v >>> 15)) >>> 0;
}

/**
 * 字符串哈希（xmur3 变体），把 "battle-1-3" 这类业务字符串变成稳定种子。
 * @param {string} str 输入字符串
 * @returns {number} 32 位无符号整数
 */
function hashString(str) {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i += 1) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  return (h ^= h >>> 16) >>> 0;
}

/**
 * 把任意长度整数（含 battle_log.seed 的 BIGINT 范围）折叠成 32 位种子。
 * 折叠方式：低 32 位 XOR 高 32 位，再做一次雪崩混合，保证高低位都参与。
 * @param {bigint} value 任意整数
 * @returns {number} 32 位无符号整数
 */
function foldBigIntSeed(value) {
  const lo = value & MASK_32;
  const hi = (value >> 32n) & MASK_32;
  return mix32(Number((lo ^ hi) & MASK_32));
}

/**
 * 把外部传入的 seed 规范化成 32 位无符号整数。
 * 支持 number / bigint / 数字字符串（mysql2 取 BIGINT 常返回字符串）/ 普通字符串。
 * @param {number|bigint|string} seed 原始种子
 * @returns {number} 32 位无符号整数种子
 * @throws {TypeError} seed 为空或类型不支持
 */
function normalizeSeed(seed) {
  if (seed === undefined || seed === null || seed === '') {
    throw new TypeError('rng: seed 不能为空，战斗与抽卡必须显式传入种子');
  }

  if (typeof seed === 'number') {
    if (!Number.isFinite(seed)) {
      throw new TypeError(`rng: seed 必须是有限数值，收到 ${seed}`);
    }
    // 非整数（如 0.5）不当作数值种子，退化为字符串哈希，仍然保持确定性
    if (!Number.isInteger(seed)) {
      return mix32(hashString(String(seed)));
    }
    return foldBigIntSeed(BigInt(seed));
  }

  if (typeof seed === 'bigint') {
    return foldBigIntSeed(seed);
  }

  if (typeof seed === 'string') {
    const trimmed = seed.trim();
    if (/^[+-]?\d+$/.test(trimmed)) {
      // 数字字符串按整数解析，保证 "881337212" 与 881337212 得到同一个种子
      return foldBigIntSeed(BigInt(trimmed));
    }
    return mix32(hashString(trimmed));
  }

  throw new TypeError(`rng: 不支持的 seed 类型 ${typeof seed}`);
}

/**
 * 创建随机数发生器实例。
 *
 * 用法（战斗）：
 *   const rng = createRng(battleLog.seed).fork('battle');
 *   rng.nextInt(1, 6);            // 掷骰
 *   rng.pick(['a', 'b']);         // 等概率取一个
 *   rng.weightedIndex([2, 1, 1]); // 按权重取下标
 *
 * @param {number|bigint|string} seed 种子
 * @returns {object} 发生器实例（详见下方各方法的 JSDoc）
 */
function createRng(seed) {
  const seed32 = normalizeSeed(seed);
  /** 用对象包裹状态，保证 getState / setState 读写的是同一份数据 */
  const holder = { value: seed32 };
  let draws = 0;

  /**
   * mulberry32 单步：先推进状态，再用状态算出 [0,1) 的浮点数。
   * @returns {number} [0,1) 均匀分布随机数
   */
  const next = () => {
    holder.value = (holder.value + MULBERRY_STEP) >>> 0;
    let t = holder.value;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    draws += 1;
    return ((t ^ (t >>> 14)) >>> 0) / TWO_POW_32;
  };

  return {
    /** 规范化后的 32 位种子 */
    seed: seed32,
    /** 已消耗的随机数个数，便于日志与单测断言「随机流是否被多消费」 */
    get draws() {
      return draws;
    },
    /** 当前 32 位状态（存档用） */
    get state() {
      return holder.value;
    },

    next,

    /**
     * 取 [min, max] 闭区间整数。
     * @param {number} min 下界（含）
     * @param {number} max 上界（含）
     * @returns {number} 整数
     */
    nextInt(min, max) {
      if (!Number.isInteger(min) || !Number.isInteger(max)) {
        throw new TypeError(`rng.nextInt: 参数必须是整数，收到 ${min},${max}`);
      }
      if (min > max) {
        throw new RangeError(`rng.nextInt: min(${min}) 不能大于 max(${max})`);
      }
      return min + Math.floor(next() * (max - min + 1));
    },

    /**
     * 以 probability 的概率返回 true。
     * p<=0 恒 false、p>=1 恒 true，且**不消耗**随机数，
     * 这样「概率为 0 的分支」不会因为多烧一个随机数而改变后续结果。
     * @param {number} probability 0~1
     * @returns {boolean}
     */
    chance(probability) {
      if (typeof probability !== 'number' || Number.isNaN(probability)) {
        throw new TypeError(`rng.chance: probability 必须是数值，收到 ${probability}`);
      }
      if (probability <= 0) return false;
      if (probability >= 1) return true;
      return next() < probability;
    },

    /**
     * 等概率取一个元素。
     * @param {Array} list 数组
     * @returns {*} 元素；空数组返回 undefined
     */
    pick(list) {
      if (!Array.isArray(list)) {
        throw new TypeError('rng.pick: 入参必须是数组');
      }
      if (list.length === 0) return undefined;
      return list[Math.floor(next() * list.length)];
    },

    /**
     * 按权重取下标（轮盘赌）。
     * 权重为 0 / 负数的项不会被选中；总权重为 0 时返回 -1，由调用方决定如何降级。
     * @param {number[]} weights 非负权重数组
     * @returns {number} 命中的下标，无有效权重返回 -1
     */
    weightedIndex(weights) {
      if (!Array.isArray(weights)) {
        throw new TypeError('rng.weightedIndex: 入参必须是数组');
      }
      let total = 0;
      for (const w of weights) {
        if (typeof w !== 'number' || !Number.isFinite(w) || w < 0) {
          throw new RangeError(`rng.weightedIndex: 权重必须是非负有限数，收到 ${w}`);
        }
        total += w;
      }
      if (total <= 0) return -1;

      let roll = next() * total;
      for (let i = 0; i < weights.length; i += 1) {
        roll -= weights[i];
        // 末尾用 i === len-1 兜住浮点误差（roll 可能残留极小正数）
        if (roll < 0 || i === weights.length - 1) return i;
      }
      return weights.length - 1;
    },

    /**
     * Fisher–Yates 洗牌，返回新数组（不修改入参）。
     * @param {Array} list 原数组
     * @returns {Array} 洗牌后的新数组
     */
    shuffle(list) {
      if (!Array.isArray(list)) {
        throw new TypeError('rng.shuffle: 入参必须是数组');
      }
      const result = list.slice();
      for (let i = result.length - 1; i > 0; i -= 1) {
        const j = Math.floor(next() * (i + 1));
        const tmp = result[i];
        result[i] = result[j];
        result[j] = tmp;
      }
      return result;
    },

    /**
     * 从当前 seed 派生一条独立的随机流（**不消耗**父流状态）。
     * 一局对局只有一个 matchSeed，但战斗 / AI 决策 / 商店刷新需要互不干扰，
     * 用 fork('battle')、fork('shop') 隔离子流后，各自都能独立复现。
     * @param {string|number} label 子流标签
     * @returns {object} 新的发生器实例
     */
    fork(label) {
      const extra = mix32(hashString(String(label)));
      return createRng(mix32((seed32 ^ extra) >>> 0));
    },

    /**
     * 恢复随机流状态（读档续算用）。
     * @param {number} nextState 之前通过 rng.state 取到的 32 位状态
     * @returns {void}
     */
    setState(nextState) {
      if (!Number.isInteger(nextState) || nextState < 0 || nextState > UINT32_MAX) {
        throw new RangeError(`rng.setState: 状态必须是 0~${UINT32_MAX} 的整数`);
      }
      holder.value = nextState >>> 0;
    },
  };
}

/**
 * 由「种子 + 存档状态」还原随机流，读档后继续推进结果与不中断时完全一致。
 * @param {number|bigint|string} seed 原种子
 * @param {number} state 存档中的 32 位状态
 * @returns {object} 发生器实例
 */
function restoreRng(seed, state) {
  const rng = createRng(seed);
  rng.setState(state);
  return rng;
}

module.exports = {
  createRng,
  restoreRng,
  normalizeSeed,
  /** 派生一个稳定的子种子，便于把「对局种子 + 用途」写进日志 */
  deriveSeed: (seed, label) => createRng(seed).fork(label).seed,
  hashString,
};
