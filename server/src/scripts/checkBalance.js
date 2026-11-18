'use strict';

/**
 * src/scripts/checkBalance.js —— 配置加载自检脚本（课设演示 / 部署后验收用）
 * =============================================================================
 * 运行：cd server && npm run config:check
 *
 * 做三件事：
 *   1. 从 MySQL 读取全部平衡配置，打印条数与配置指纹（version）
 *   2. 校验结果：概率和、羁绊覆盖、卡池总量（校验不通过会直接抛错）
 *   3. 用真实配置跑一遍 engine 冒烟：抽卡 / 羁绊 / 星级属性 / 利息 / 积分
 * =============================================================================
 */

const {
  loadBalance,
  createMatchCardPool,
  buildUnitSnapshot,
} = require('../config/balance.loader');
const { closePool } = require('../config/db');
const { computeTraits, collectActiveEffects } = require('../engine/synergy');
const { resolveUnitStats, resolveTeamStats, applyEnemyAura } = require('../engine/stats');
const { simulateBattle } = require('../engine/combat');
const { weightedPick } = require('../engine/probability');
const { calcInterest, calcRoundIncome } = require('../engine/economy');
const { calcScoreDelta } = require('../engine/damage');
const { createRng } = require('../engine/rng');

/**
 * 打印一行分隔与小标题。
 * @param {string} title 标题
 * @returns {void}
 */
function section(title) {
  console.log(`\n=== ${title} ===`);
}

async function main() {
  // silent：告警由本脚本统一排版打印，避免与加载器日志重复
  const balance = await loadBalance({ force: true, silent: true });

  section('配置概况');
  console.log(`配置指纹 version : ${balance.version}`);
  console.log(`加载时间         : ${balance.loadedAt}`);
  console.log(`羁绊 trait       : ${balance.traits.list.length} 条（种族 ${balance.traits.races.length} / 职业 ${balance.traits.classes.length}）`);
  console.log(`羁绊档位         : ${balance.traitLevels.list.length} 条`);
  console.log(`英雄 hero        : ${balance.heroes.list.length} 个（启用 ${balance.heroes.list.filter((h) => h.enabled === 1).length}）`);
  console.log(`英雄羁绊关联     : ${[...balance.heroTraits.values()].reduce((sum, list) => sum + list.length, 0)} 条`);
  console.log(`卡池总量         : ${balance.cardPool.total} 张`);
  console.log(`等级配置         : ${balance.levels.list.length} 级`);
  console.log(`全局参数         : ${Object.keys(balance.gameConfig.raw).length} 项`);

  if (balance.warnings.length > 0) {
    section('配置告警（不阻塞启动，但建议处理）');
    balance.warnings.forEach((warning) => console.log(`- ${warning}`));
  }

  section('engine 冒烟：抽卡（9 级概率，seed 固定可复现）');
  const oddsLevel9 = balance.odds.byLevel[9];
  console.log('9 级概率         :', JSON.stringify(oddsLevel9));
  const cards = createMatchCardPool(balance);
  console.log(`单局卡池         : ${cards.length} 种英雄，合计 ${cards.reduce((sum, card) => sum + card.remaining, 0)} 张`);
  const rng = createRng(20261116).fork('shop');
  const pick = weightedPick(oddsLevel9, cards, rng);
  console.log(`抽卡结果         : heroId=${pick.heroId}，${pick.cost} 费，剩余 ${pick.remainingBefore} 张，实际概率 ${(pick.effectiveProbability * 100).toFixed(2)}%`);

  section('engine 冒烟：羁绊统计');
  const board = [1, 9, 15, 17].map((heroId) => buildUnitSnapshot(balance, heroId, 2));
  console.log('上阵阵容         :', board.map((unit) => unit.name).join('、'));
  const traits = computeTraits(board, balance.engine.traitLevels, balance.engine.traitMeta);
  traits.list
    .filter((trait) => trait.heroCount > 0)
    .forEach((trait) => {
      const levelText = trait.activeLevel > 0 ? `激活 ${trait.activeLevel} 档` : '未激活';
      const needText = trait.need === null ? '已满档' : `还差 ${trait.need} 个到 ${trait.nextLevel} 档`;
      console.log(`- ${trait.name}：${trait.heroCount} 人，${levelText}，${needText}`);
    });

  section('engine 冒烟：星级与羁绊属性');
  const effects = collectActiveEffects(traits.list);
  board.forEach((unit) => {
    const stats = resolveUnitStats(unit, effects, balance.engine.statsConfig);
    console.log(
      `- ${stats.name} ${stats.star} 星：血 ${stats.hp} / 攻 ${stats.attack} / 攻速 ${stats.attackSpeed} / 暴击 ${(stats.critRate * 100).toFixed(0)}% / 生效羁绊 [${stats.appliedTraitIds.join(',')}]`,
    );
  });

  section('engine 冒烟：战斗模拟（seed 可复现，时间轴可回放）');
  const awayBoard = [2, 7, 14, 19].map((heroId) => buildUnitSnapshot(balance, heroId, 2));
  const homeTeam = resolveTeamStats(board, effects, balance.engine.statsConfig);
  const awayTraits = computeTraits(awayBoard, balance.engine.traitLevels, balance.engine.traitMeta);
  const awayTeam = resolveTeamStats(
    awayBoard,
    collectActiveEffects(awayTraits.list),
    balance.engine.statsConfig,
  );
  // 双方光环互相作用（敌方减甲 / 减攻速），再进模拟
  const homeUnits = applyEnemyAura(homeTeam.units, awayTeam.aura);
  const awayUnits = applyEnemyAura(awayTeam.units, homeTeam.aura);
  const battle = simulateBattle({
    teamA: homeUnits,
    teamB: awayUnits,
    rng: createRng(20261118).fork('battle'),
    config: balance.engine.combatConfig,
  });
  console.log(`对阵             : ${homeUnits.map((unit) => unit.name).join('、')}  vs  ${awayUnits.map((unit) => unit.name).join('、')}`);
  console.log(
    `结果             : ${battle.result}（${battle.durationSeconds}s，存活 A${battle.survivors.A} / B${battle.survivors.B}，超时 ${battle.timedOut}）`,
  );
  console.log(`时间轴           : ${battle.timeline.length} 帧，首帧 ${JSON.stringify(battle.timeline[0])}`);

  section('engine 冒烟：经济与积分');
  const income = calcRoundIncome({ goldBefore: 32, winStreak: 3 }, balance.engine.economyConfig);
  console.log(`32 金、3 连胜    : 基础 ${income.base} + 利息 ${income.interest} + 连胜 ${income.streakBonus} = ${income.total}`);
  console.log(`利息（50 金封顶）: ${calcInterest(50, balance.engine.economyConfig)}`);
  const score = calcScoreDelta({ rank: 1, currentScore: 1000 }, balance.engine.scoreConfig);
  console.log(`第 1 名积分      : 1000 → ${score.scoreAfter}（${score.delta > 0 ? '+' : ''}${score.delta}）`);

  console.log('\n配置加载与 engine 冒烟通过。');
}

main()
  .catch((err) => {
    console.error('\n配置自检失败：');
    console.error(err.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closePool();
  });
