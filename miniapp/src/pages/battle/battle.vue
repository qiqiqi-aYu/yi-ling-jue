<template>
  <!--
    对局页（横屏）· 三栏 + 底部通栏布局
    ┌───────────────────────────────────────────────┐
    │ 左侧栏(状态/羁绊/战报) │ 中间棋盘 │ 右侧预留    │
    │                        │          │            │
    ├───────────────────────────────────────────────┤
    │ 底部固定通栏：商店卡片 + 刷新商店 + 购买经验      │
    └───────────────────────────────────────────────┘
    所有数值均来自 store（后端权威），页面不做任何计算。
  -->
  <view class="battle-page">
    <!--
      左上角返回：用 navigator 内置 navigateBack，不引入任何 JS 事件绑定。
      圆形半透明深色底 + 白色箭头，z-index 高于商店通栏，占位区不与面板重叠。
    -->
    <navigator
      class="back-btn"
      open-type="navigateBack"
      delta="1"
      hover-class="none"
    >
      <text class="back-arrow">←</text>
    </navigator>

    <!-- ============ 无对局兜底 ============ -->
    <view v-if="!store.hasMatch" class="empty-state">
      <text class="empty-text">当前没有进行中的对局，请返回首页点击「开始对局」</text>
    </view>

    <template v-else>
      <!-- ============ 区域 A：左侧栏（纵向堆叠） ============ -->
      <view class="rail rail-left">
        <!-- A1 玩家状态 -->
        <view class="panel panel-status">
          <view class="panel-head">
            <text class="panel-title">对局状态</text>
            <text class="panel-meta">回合 {{ store.round }} · 版本 {{ store.version }}</text>
          </view>
          <view class="panel-body panel-body-flat">
            <player-status
              name="真人玩家"
              :player-index="store.me.playerIndex"
              :hp="store.me.hp"
              :gold="store.me.gold"
              :level="store.me.level"
              :exp="store.me.exp"
              :next-exp="store.me.nextExp"
              :exp-percent="store.me.expPercent"
            />
          </view>
        </view>

        <!-- A2 羁绊面板 -->
        <view class="panel panel-synergy">
          <view class="panel-head">
            <text class="panel-title">羁绊</text>
            <text class="panel-meta">后端聚合</text>
          </view>
          <view class="panel-body">
            <synergy-panel :traits="store.traits" @select="handleTraitSelect" />
          </view>
        </view>

        <!--
          A3 战报：收起时是左栏底部一条侧边条，展开时浮层覆盖上方两块面板。
          内容为「本回合我方英雄输出排行」，由 timeline 在前端聚合，不逐条回放攻击帧。
        -->
        <view class="panel panel-report" :class="{ 'report-open': reportOpen }">
          <view class="panel-head">
            <text class="panel-title">战报</text>
            <text class="panel-meta">本回合输出</text>
          </view>
          <view class="panel-body">
            <view v-if="damageRanking.length > 0" class="dmg-list">
              <view v-for="row in damageRanking" :key="row.uid" class="dmg-row">
                <text class="dmg-rank" :class="{ 'dmg-rank-top': row.rank === 1 }">{{ row.rank }}</text>
                <view class="dmg-main">
                  <view class="dmg-line">
                    <text class="dmg-name">{{ row.name }}</text>
                    <text class="dmg-value">{{ row.damage }}</text>
                  </view>
                  <view class="dmg-track">
                    <view class="dmg-fill" :style="{ width: row.barWidth }" />
                  </view>
                </view>
              </view>
              <view class="dmg-foot">
                <text class="dmg-foot-label">我方总输出</text>
                <text class="dmg-foot-value">{{ myTotalDamage }}</text>
              </view>
            </view>

            <view v-else class="panel-placeholder">
              <text class="panel-placeholder-text">{{ reportEmptyText }}</text>
            </view>
          </view>
        </view>

        <!--
          左下角常驻按钮组：升级（购买经验）+ 战报切换。
          两个按钮都不跟商店弹窗走，商店开合时位置不动。
          禁用原因由后端返回（canBuyExp / buyExpBlockedMessage），前端不比较金币与等级。
        -->
        <view class="left-actions">
          <text
            v-if="!store.me.canBuyExp && store.me.buyExpBlockedMessage"
            class="left-actions-tip"
          >
            {{ store.me.buyExpBlockedMessage }}
          </text>
          <view class="left-actions-row">
            <button
              class="left-btn levelup-btn"
              size="mini"
              :loading="store.loading"
              :disabled="!store.me.canBuyExp"
              @click="handleBuyExp"
            >
              升级
            </button>
            <view class="left-btn report-toggle" @click="handleToggleReport">
              <text class="report-toggle-text">{{ reportOpen ? '收起战报' : '展开战报' }}</text>
            </view>
          </view>
        </view>
      </view>

      <!-- ============ 区域 B：中间棋盘（居中，随商店显隐自适应） ============ -->
      <view class="center">
        <!--
          对手棋盘占位：只做占位容器 + 边框 + 标签，不渲染棋子、不请求对手阵容。
          本轮为纯静态占位，为后续「观战 / 多棋盘预览」预留版位。
        -->
        <view class="rival-strip">
          <view class="rival-board"><text class="rival-label">对手棋盘</text></view>
          <view class="rival-board"><text class="rival-label">对手棋盘</text></view>
          <view class="rival-board"><text class="rival-label">对手棋盘</text></view>
          <view class="rival-board"><text class="rival-label">对手棋盘</text></view>
        </view>

        <!-- 我方主棋盘：占据中间主位 -->
        <view class="board-stage">
          <board-view
            class="board-host"
            :board="store.board"
            :bench="store.bench"
            :rows="store.boardMeta.boardRows"
            :cols="store.boardMeta.boardCols"
            :selected-unit="selectedUnit"
            @select="handleSelectUnit"
            @place="handlePlaceHero"
            @remove="handleRemoveHero"
            @sell="handleSellHero"
          />
        </view>

        <view class="center-actions">
          <button class="battle-button" size="mini" :loading="store.loading" @click="handleBattle">
            发起战斗
          </button>
        </view>
      </view>

      <!-- ============ 区域 C：右侧 8 人对局列表（按血量降序，同血量并列） ============ -->
      <view class="rail rail-right">
        <!--
          固定 8 条：玩家标识 + 当前血量 + 名次。
          数据直接来自 store.players（后端 8 人概览），排序与并列名次都在
          playerRows 里折算，只用于展示，不回写任何状态、不调用接口。
        -->
        <view
          v-for="row in playerRows"
          :key="row.playerIndex"
          class="player-row"
          :class="{ 'player-row-self': row.isSelf, 'player-row-out': row.out }"
        >
          <text class="player-rank">{{ row.rank }}</text>
          <text class="player-label">{{ row.label }}</text>
          <text class="player-hp">{{ row.hpText }}</text>
        </view>

        <!-- 商店切换：风格与战报按钮统一，同一个按钮、同一个位置，只换文字 -->
        <view class="shop-toggle" @click="handleToggleShop">
          <text class="shop-toggle-text">{{ shopOpen ? '收起商店' : '展开商店' }}</text>
        </view>
      </view>

      <!--
        ============ 区域 D：商店弹窗（浮层，不占布局空间） ============
        遮罩只覆盖中间棋盘列：左右两侧的状态栏与 8 人榜单不在遮罩内，
        始终保持清晰可见、可读。点遮罩关闭；点弹窗本体不关闭（@click.stop）。
        弹窗出现时底层棋盘尺寸完全不变，不做任何 padding 联动。
      -->
      <view v-if="shopOpen" class="shop-mask" @click="handleToggleShop">
        <view class="shop-modal" @click.stop>
          <view class="shop-modal-head">
            <text class="shop-modal-title">商店</text>
            <text class="shop-modal-hint">点击卡片买入</text>
          </view>

          <!-- 刷新只在弹窗内：弹窗关闭时按钮随之消失；升级按钮固定在左下角常驻 -->
          <view class="shop-modal-actions">
            <button
              class="shop-refresh-btn"
              size="mini"
              :loading="store.loading"
              @click.stop="handleRefreshShop"
            >
              刷新商店
            </button>
          </view>

          <!-- 商店卡片列表：卡片样式与羁绊名称标签沿用原样 -->
          <view class="shop-list">
            <view
              v-for="(hero, index) in store.shop"
              :key="index"
              class="shop-slot"
              :class="{ 'shop-slot-empty': !hero || !hero.heroId }"
            >
              <shop-card
                class="shop-card-host"
                :hero="hero"
                :locked="hero.locked"
                @select="handleShopSelect"
              />
              <!--
                羁绊名称：文本直接取后端 decorateShop 返回的 traitsText（形如「灵族 · 符师」），
                前端不做 heroId → 羁绊的映射，也不做字符串拼接；空位格没有该字段，不渲染。
              -->
              <text v-if="hero && hero.traitsText" class="shop-trait">{{ hero.traitsText }}</text>
            </view>
            <view v-if="store.shop.length === 0" class="shop-empty">
              <text class="shop-empty-text">当前没有商店数据</text>
            </view>
          </view>
        </view>
      </view>
    </template>
  </view>
</template>

<script setup>
import { computed, ref } from 'vue';
import { useMatchStore } from '../../store/match.js';

/**
 * 对局主页面（横屏改造版）。
 * 只做 UI 组装、Store 状态绑定与事件转发；
 * 不在页面计算棋子位置、星级、卡池、金币或战斗结果。
 * 战报面板仅对后端返回的 timeline 做前端聚合（按英雄累加输出），
 * 不改动事件链路，也不改动 Store / API 的调用方式。
 */
const store = useMatchStore();
const selectedUnit = ref(null);
const reportOpen = ref(false);
/*
 * 商店浮层显隐：默认收起。
 * 商店是浮层，出现时底层棋盘 / 榜单 / 状态栏完全不参与布局变化，
 * 因此这个布尔只控制「弹窗渲不渲染」，不影响任何尺寸与数值。
 */
const shopOpen = ref(false);

/**
 * 战报里「造成伤害」的帧类型。
 * 后端 timeline 的帧类型有 attack / crit / skill / dodge / kill / revive / heal，
 * 其中只有这三种的 value 表示「对目标造成的伤害」：
 *   - dodge 的 value 恒为 0；
 *   - revive 的 value 是复生后的血量；
 *   - heal 的 value 是治疗量，不是输出。
 */
const DAMAGE_FRAME_TYPES = ['attack', 'crit', 'skill'];

/**
 * 本回合「我方英雄输出排行」。
 *
 * 数据来源：后端返回的 timeline（一次战斗的逐帧记录，字段为
 * { t, type, actor, target, value, targetHp }），这里只做按 actor 的累加，
 * 不重放战斗、不推算未发生的伤害，也不改动任何接口。
 *
 * 为什么只统计我方：timeline 里的 actor 是棋子实例 ID（形如 h44_5_0df646dd），
 * 只带座位号、不含英雄 ID，敌方棋子的 uid 在小程序侧无法反查英雄名；
 * 我方棋子可以从 store.board / store.bench 的 uid → name 映射还原真名。
 */
const damageRanking = computed(() => {
  const frames = Array.isArray(store.timeline) ? store.timeline : [];
  if (frames.length === 0) return [];

  // uid → 我方棋子（棋盘 + 备战席）：老棋子可能同英雄多份，按 heroId 合并成一行
  const unitByUid = new Map();
  [...(store.board || []), ...(store.bench || [])].forEach((unit) => {
    if (unit && unit.uid) unitByUid.set(String(unit.uid), unit);
  });

  const acc = new Map();
  frames.forEach((frame) => {
    if (!frame || !DAMAGE_FRAME_TYPES.includes(frame.type)) return;
    const unit = unitByUid.get(String(frame.actor || ''));
    if (!unit) return;                               // 非我方棋子直接跳过
    const damage = Number(frame.value) || 0;
    if (damage <= 0) return;
    // 同一个英雄的不同棋子合并计算；拿不到 heroId 时退回用棋子 uid 作为键
    const key = unit.heroId === undefined || unit.heroId === null
      ? String(unit.uid)
      : `hero-${unit.heroId}`;
    const prev = acc.get(key) || { key, name: unit.name || '未知棋子', damage: 0 };
    prev.damage += damage;
    acc.set(key, prev);
  });

  const rows = [...acc.values()].sort((a, b) => b.damage - a.damage);
  const top = rows.length > 0 ? rows[0].damage : 0;
  return rows.map((row, index) => {
    const damage = Math.round(row.damage);
    return {
      uid: row.key,
      name: row.name,
      damage,
      rank: index + 1,
      // 条形长度按「占最高输出的比例」换算，只用于视觉对比，不参与任何战斗数值
      barWidth: top > 0 ? `${Math.round((row.damage / top) * 100)}%` : '0%',
    };
  });
});

/** 排行里所有英雄的伤害合计（已按整数取整后相加，避免出现 0.30000000000000004） */
const myTotalDamage = computed(() =>
  damageRanking.value.reduce((sum, row) => sum + row.damage, 0));

/** 空态文案：有战报但没输出 vs 还没打过 */
const reportEmptyText = computed(() =>
  (Array.isArray(store.timeline) && store.timeline.length > 0)
    ? '本回合我方没有造成伤害'
    : '发起战斗后显示本回合输出');

/**
 * 右侧 8 人对局列表：名次 + 玩家标识 + 当前血量。
 *
 * 数据源是 store.players —— 后端详情接口返回的 8 条玩家概览，字段为
 * { playerIndex, isAi, hp, level, eliminated, rank, unitCount }。
 * 对局进行中后端不给 rank（库里为 NULL），所以名次在这里按血量实时折算：
 * 血量降序，同血量并列，并列后下一个名次跳号（1、1、3）。
 * 这只是展示排序，不参与战斗结算，也不回写 Store。
 */
const playerRows = computed(() => {
  const players = Array.isArray(store.players) ? store.players : [];

  // 详情还没加载回来时先占满 8 行，保证右侧栏高度不塌、布局不跳
  if (players.length === 0) {
    return Array.from({ length: 8 }, (_, index) => ({
      playerIndex: index,
      isSelf: index === 0,
      label: index === 0 ? '我' : `AI ${index}`,
      rank: index + 1,
      hpText: '--',
      out: false,
    }));
  }

  const rows = players
    .map((player) => {
      const playerIndex = Number(player.playerIndex) || 0;
      return {
        playerIndex,
        isSelf: playerIndex === 0,           // 座位 0 是真人，其余为 AI
        isAi: Boolean(player.isAi),
        hp: Number(player.hp) || 0,
        out: Boolean(player.eliminated) || Number(player.hp) <= 0,
      };
    })
    .sort((a, b) => {
      if (b.hp !== a.hp) return b.hp - a.hp;              // 血量从高到低
      if (a.isSelf !== b.isSelf) return a.isSelf ? -1 : 1; // 同血量时自己在前，便于一眼找到
      return a.playerIndex - b.playerIndex;                // 其余按座位号，保证顺序稳定
    });

  let rank = 0;
  let prevHp = null;
  return rows.map((row, index) => {
    if (prevHp === null || row.hp !== prevHp) {
      rank = index + 1;                       // 血量变化才更新名次，并列后自动跳号
      prevHp = row.hp;
    }
    return {
      ...row,
      rank,
      label: row.isSelf ? '我' : (row.isAi ? `AI ${row.playerIndex}` : `玩家 ${row.playerIndex}`),
      hpText: String(row.hp),
    };
  });
});

/** 刷新商店：只调用 Store 动作，成功后由 Store 重新拉取后端权威状态 */
async function handleRefreshShop() {
  try {
    await store.refreshShop();
    console.log('[battle] shop refreshed');
  } catch (err) {
    console.log('[battle] refresh failed:', store.error);
  }
}

/** 购买棋子：slotNo 直接取后端返回的商店格编号，不在前端推导 */
async function handleShopSelect(hero) {
  if (!hero || hero.slotNo === undefined) return;
  try {
    await store.buyHero(hero.slotNo);
    console.log('[battle] hero bought:', hero.slotNo);
  } catch (err) {
    console.log('[battle] buy failed:', store.error);
  }
}

function handleTraitSelect(trait) {
  console.log('[battle] trait select:', trait);
}

/**
 * 购买经验：金币与经验的增减完全由后端计算。
 * 禁用状态只读后端返回的 canBuyExp，前端不比较金币与等级。
 */
async function handleBuyExp() {
  try {
    await store.buyExp();
    console.log('[battle] exp bought');
  } catch (err) {
    console.log('[battle] buy exp failed:', store.error);
  }
}

/** 备战棋子选中只作为 UI 状态，不改动棋子或金币 */
function handleSelectUnit(unit) {
  selectedUnit.value = unit;
  console.log('[battle] unit selected:', unit && unit.uid);
}

/** 放置：目标格子由棋盘组件抛出，棋子 uid 直接使用后端返回值 */
async function handlePlaceHero(payload) {
  if (!payload || !payload.unit) return;
  try {
    await store.placeHero(payload.unit, payload.target);
    console.log('[battle] hero placed:', payload.unit.uid);
  } catch (err) {
    console.log('[battle] place failed:', store.error);
  }
}

/** 撤下：location=2 由后端决定备战席落位 */
async function handleRemoveHero(unit) {
  try {
    await store.placeHero(unit, { location: 2 });
    console.log('[battle] hero removed:', unit.uid);
  } catch (err) {
    console.log('[battle] remove failed:', store.error);
  }
}

async function handleSellHero(unit) {
  try {
    await store.sellHero(unit.uid);
    console.log('[battle] hero sold:', unit.uid);
  } catch (err) {
    console.log('[battle] sell failed:', store.error);
  }
}

/** 发起战斗：只触发 Store 动作，战报由后端 timeline 提供 */
async function handleBattle() {
  try {
    await store.fightRound(store.round);
    console.log('[battle] round fought:', store.round);
  } catch (err) {
    console.log('[battle] fight failed:', store.error);
  }
}

/** 仅控制面板展开/收起，不参与战斗计算 */
function handleToggleReport() {
  reportOpen.value = !reportOpen.value;
}

/** 仅控制商店面板展开/收起，不参与任何数值与接口 */
function handleToggleShop() {
  shopOpen.value = !shopOpen.value;
}
</script>

<style lang="scss" scoped>
/* ============================================================
 * 金铲铲风格深色皮肤 · 纯样式层
 * ------------------------------------------------------------
 * 约束：
 *   1. 布局体系仍为 vw / vh，尺寸与上一版完全一致；
 *   2. 不新增 / 删除事件，不改 Store 与 API 调用；
 *   3. 五段子组件源码零改动，全部通过 :deep() 覆盖。
 * ============================================================ */
$bottom-strip: 5.4vh;   // 左下角常驻按钮组（升级 + 战报）占用的底部条带
$gap: 1.2vh;            // 模块之间的间距
$top-strip: 5.6vh;      // 左上角返回按钮预留的顶部条带
$notch: 6vw;            // 左侧刘海/摄像头黑块的避让宽度（横屏时摄像头在左边缘，约 50px）

$card-bg: rgba(17, 25, 42, 0.74);
$card-border: rgba(120, 160, 220, 0.14);
$gold: #d9a94a;
$gold-light: #f0c674;
$text-main: #e8eefc;
$text-sub: #8296b6;

/* ---------------- 根容器：100vw × 100vh，横向 flex ---------------- */
.battle-page {
  position: relative;
  display: flex;
  flex-direction: row;
  width: 100vw;
  height: 100vh;
  overflow: hidden;                       // 禁止页面滚动
  box-sizing: border-box;
  padding-left: env(safe-area-inset-left);
  padding-right: env(safe-area-inset-right);
  background: radial-gradient(circle at 50% 30%, #1b2b46 0%, #101a2e 44%, #05080f 100%);
}

/* ---------------- 左上角返回按钮 ---------------- */
.back-btn {
  position: absolute;
  top: 1.1vh;
  /* 与左栏一起右移，避免被模拟器左上角的摄像头黑块压住；env() 让真机刘海位再让一档 */
  left: $notch;
  left: calc(env(safe-area-inset-left) + #{$notch});
  z-index: 60;                            // 高于商店通栏(20)，确保最顶层
  display: flex;
  align-items: center;
  justify-content: center;
  width: 4vh;
  height: 4vh;
  border-radius: 50%;
  box-sizing: border-box;
  background: rgba(10, 16, 28, 0.66);
  border: 1px solid rgba(255, 255, 255, 0.20);
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.45);
}

.back-arrow {
  font-size: 18px;
  line-height: 1;
  color: #ffffff;
  font-weight: 600;
}

/* ---------------- 通用面板容器：每块独立深色卡面 ---------------- */
.panel {
  position: relative;
  display: flex;
  flex-direction: column;
  min-height: 0;
  padding: 0.8vh 0.5vw;
  box-sizing: border-box;
  background: $card-bg;
  border: 1px solid $card-border;
  border-radius: 10px;
  box-shadow:
    0 3px 14px rgba(0, 0, 0, 0.42),
    inset 0 1px 0 rgba(255, 255, 255, 0.05);
}

.panel + .panel {
  margin-top: $gap;
}

.panel-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-shrink: 0;
  margin-bottom: 0.5vh;
  padding: 0 0.15vw 0.45vh;
  border-bottom: 1px solid rgba(255, 255, 255, 0.07);
}

.panel-title {
  padding-left: 6px;
  font-size: 14px;
  font-weight: 600;
  line-height: 1.1;
  color: $text-main;
  letter-spacing: 0.6px;
  border-left: 2px solid $gold;
}

.panel-meta {
  font-size: 10px;
  color: #6f82a3;
}

/*
 * 左下角常驻按钮组：升级（购买经验）+ 战报切换，横排贴左栏底部。
 * 用绝对定位挂在左栏上，所以战报浮层开合、商店弹窗开合都不会让它移动。
 */
.left-actions {
  position: absolute;
  left: 0.7vw;
  right: 0.7vw;
  bottom: 1vh;
  z-index: 45;                            // 高于战报浮层(40)，保证浮层打开时仍可点击
}

/* 禁用原因（金币不足 / 已满级）：贴在按钮组上方的小字，不占按钮行高度 */
.left-actions-tip {
  position: absolute;
  left: 0;
  right: 0;
  bottom: calc(100% + 0.3vh);
  font-size: 9px;
  line-height: 1.2;
  text-align: center;
  color: #ffd9a0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  pointer-events: none;
}

.left-actions-row {
  display: flex;
  flex-direction: row;
  align-items: stretch;
}

/* 两个按钮等宽，高度一致 */
.left-btn {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  width: auto;                            // 覆盖小程序 button 默认 100% 宽度
  min-width: 0;
  height: 3.4vh;
  margin: 0;
  padding: 0 6px;
  box-sizing: border-box;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 600;
  line-height: 1;
  letter-spacing: 0.3px;
  white-space: nowrap;
}

/* 去掉微信 button 自带 ::after 边框，避免与自定义描边叠加 */
.left-btn::after {
  border: none;
}

/* 升级：金色常驻，禁用时灰化（禁用原因由后端 canBuyExp 决定） */
.levelup-btn {
  margin-right: 0.5vw;
  color: #2a1f0c;
  background: linear-gradient(180deg, #e2b45c, #b8862f);
  border: 1px solid rgba(255, 220, 150, 0.55);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.35),
    0 2px 10px rgba(180, 130, 40, 0.22);
}

.levelup-btn[disabled] {
  color: #9aa3b6;
  background: rgba(66, 72, 88, 0.55);
  border-color: rgba(255, 255, 255, 0.08);
  box-shadow: none;
  opacity: 0.45;
}

/* 战报切换：冷色胶囊，与商店切换按钮同款 */
.report-toggle {
  color: #a9d4ff;
  background: rgba(80, 130, 210, 0.22);
  border: 1px solid rgba(140, 190, 255, 0.40);
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.35);
}

.report-toggle-text {
  font-size: 11px;
  font-weight: 600;
  line-height: 1;
  color: #a9d4ff;
  letter-spacing: 0.4px;
  white-space: nowrap;
}

.panel-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;                       // 面板内部滚动，页面本身不滚动
}

.panel-body-flat {
  flex: 0 0 auto;
  overflow: visible;
}

.panel-placeholder {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  min-height: 4vh;
  border: 1px dashed rgba(140, 165, 205, 0.18);
  border-radius: 8px;
}

.panel-placeholder-text {
  font-size: 11px;
  color: #5b6d8c;
}

/* ---------------- 区域 A：左侧栏 ---------------- */
.rail-left {
  position: relative;                     // 战报展开浮层的定位基准
  display: flex;
  flex-direction: column;
  flex: 0 0 21vw;
  width: 21vw;
  min-width: 0;
  /*
   * 左栏整体右移一档：横屏模拟器左上角会盖一块摄像头黑块，
   * 直接把「对局状态」的血量 / 金币与羁绊首行文字压掉。
   * 只加外边距，不动内部比例 —— 玩家状态栏依旧收缩、羁绊依旧吃掉剩余高度。
   */
  margin-left: $notch;
  // 顶部留出返回按钮的高度，避免遮挡「对局状态」标题；底部留出常驻按钮组
  padding: $top-strip 0.7vw $bottom-strip;
  box-sizing: border-box;
  overflow: hidden;
}

/* 玩家状态：压缩纵向占用，把高度让给羁绊 */
.panel-status {
  flex: 0 0 auto;
  padding: 0.6vh 0.45vw;
}

/* 羁绊：吃掉剩余全部高度 */
.panel-synergy {
  flex: 1 1 auto;
  min-height: 0;
}

/*
 * 战报：
 *   收起时 → 左栏底部一条侧边条，只留标题行，右侧浮着「展开战报」按钮；
 *   展开时 → 绝对定位铺满左栏内容区（含顶部返回条以下），浮在
 *            玩家状态与羁绊之上，z-index 高于左栏内其他面板。
 * 两种状态下按钮都由 .report-toggle 固定在同一坐标，不随面板移动。
 */
.panel-report {
  flex: 0 0 auto;
  padding-top: 0.55vh;
  padding-bottom: 0.55vh;
}

.panel-report .panel-head {
  margin-bottom: 0;
  padding-bottom: 0;
  border-bottom: none;
}

/* 收起态侧边条太窄，副标题让位给右侧按钮 */
.panel-report .panel-meta {
  display: none;
}

.panel-report .panel-body {
  display: none;                          // 收起态不显示内容区
}

.panel-report.report-open {
  position: absolute;
  top: $top-strip;
  bottom: $bottom-strip;
  left: 0.7vw;
  right: 0.7vw;
  z-index: 40;
  margin-top: 0;
  padding: 0.8vh 0.5vw;
  background: rgba(13, 20, 34, 0.97);
  border-color: rgba(140, 190, 255, 0.30);
  box-shadow:
    0 12px 34px rgba(0, 0, 0, 0.72),
    inset 0 1px 0 rgba(255, 255, 255, 0.06);
}

.panel-report.report-open .panel-head {
  margin-bottom: 0.5vh;
  padding-bottom: 0.45vh;
  border-bottom: 1px solid rgba(255, 255, 255, 0.07);
}

.panel-report.report-open .panel-meta {
  display: block;
}

/* 底部给固定的展开按钮让出 4.2vh，最后一行和合计行不会被按钮盖住 */
.panel-report.report-open .panel-body {
  display: block;
  flex: 1;
  min-height: 0;
  padding-bottom: 4.2vh;
  box-sizing: border-box;
}

/* ---------------- 区域 B：中间棋盘 ---------------- */
.center {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
  /*
   * 商店改成浮层后，底部不再有通栏占位，棋盘直接铺到贴近屏幕下沿。
   * 这里只留一格间距；屏幕高度变化时棋盘尺寸只跟视口有关，不随商店开合变化。
   */
  padding: 0.8vh 0.5vw $gap;
  box-sizing: border-box;
  overflow: hidden;
}

.board-stage {
  display: flex;
  align-items: stretch;                   // 关键：让棋盘宿主节点撑满，不再被内容高度决定
  justify-content: center;
  flex: 1;
  min-height: 0;
  width: 100%;
}

/*
 * 棋盘宿主节点：自定义组件 <board-view> 默认高度是 auto，
 * 组件内部的 height:100% 会失效，导致空格子被撑成一条细带。
 * 这里显式接管宿主高度，棋盘才能真正铺满中栏。
 */
.board-host {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
  min-height: 0;
  width: 100%;
  height: 100%;
}

.center-actions {
  display: flex;
  justify-content: center;
  flex-shrink: 0;
  padding-top: 0.4vh;
}

/* ---------------- 对手棋盘占位条 ---------------- */
/*
 * 本轮只做占位容器 + 边框 + 标签，不渲染棋子、不请求对手阵容数据。
 * 4 个占位框横排在中栏顶部，为后续「观战 / 多棋盘预览」预留版位；
 * 我方主棋盘仍占据下方绝大部分空间（board-stage flex:1）。
 */
.rival-strip {
  display: flex;
  flex-direction: row;
  flex-shrink: 0;
  gap: 0.6vw;
  margin-bottom: 0.8vh;
}

.rival-board {
  flex: 1;
  min-width: 0;
  height: 8vh;
  box-sizing: border-box;
  border: 1px dashed rgba(120, 160, 220, 0.22);
  border-radius: 8px;
  background: rgba(13, 20, 34, 0.42);
  display: flex;
  align-items: center;
  justify-content: center;
}

.rival-label {
  font-size: 10px;
  color: #4e617f;
  letter-spacing: 0.5px;
}

/* ---------------- 区域 C：右侧 8 人对局列表（竖向） ---------------- */
.rail-right {
  display: flex;
  flex-direction: column;
  flex: 0 0 14vw;
  width: 14vw;
  min-width: 0;
  box-sizing: border-box;
  overflow: hidden;
  // 横屏时顶部可能压到挖孔 / 状态栏，左右也可能被圆角裁切，这里统一让出安全区；
  // 顶部留白与左栏标题对齐（$top-strip），避免两栏顶端错位
  padding-top: calc(#{$top-strip} + env(safe-area-inset-top));
  padding-right: calc(0.5vw + env(safe-area-inset-right));
  padding-bottom: calc(#{$gap} + 4.4vh);  // 底部留出「展开/收起商店」按钮的高度
  padding-left: 0.5vw;
}

.player-row {
  display: flex;
  align-items: center;
  flex: 1 1 0;                            // 8 条等分剩余高度，不撑高右栏
  min-height: 0;
  margin-bottom: 0.5vh;
  padding: 0 0.3vw;
  box-sizing: border-box;
  border: 1px solid rgba(120, 160, 220, 0.10);
  border-left: 2px solid rgba(120, 170, 255, 0.26);
  border-radius: 6px;
  background: rgba(16, 24, 40, 0.55);
}

.player-row:last-child {
  margin-bottom: 0;
}

/* 自己（真人）条目：提高底色亮度与左侧描边，形成高亮但不刺眼 */
.player-row-self {
  border-color: rgba(150, 200, 255, 0.48);
  border-left-width: 3px;
  border-left-color: #7fb6ff;
  background: rgba(70, 120, 200, 0.34);
  box-shadow: inset 0 0 12px rgba(90, 150, 240, 0.24);
}

/* 已淘汰：整条淡化，血量回到 0 仍留在榜单里 */
.player-row-out {
  opacity: 0.45;
}

.player-rank {
  flex: 0 0 auto;
  min-width: 11px;
  font-size: 9px;
  line-height: 1.2;
  text-align: center;
  color: #6d80a0;                          // 名次用灰色小字，不与血量抢视线
}

.player-label {
  flex: 1 1 auto;
  min-width: 0;
  padding-left: 0.3vw;
  font-size: 10px;
  line-height: 1.2;
  color: #b9c8e0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.player-row-self .player-label {
  font-weight: 600;
  color: #dceaff;
}

.player-hp {
  flex: 0 0 auto;
  padding-left: 0.2vw;
  font-size: 11px;
  line-height: 1.2;
  font-weight: 600;
  text-align: right;
  color: #ff6b6b;                          // 血量红色数字
}

.player-row-self .player-hp {
  color: #ff8a8a;
}

/*
 * 商店【展开商店 / 收起商店】：与战报按钮同款胶囊，挂在右栏底部。
 * 同一个按钮、同一个位置，只换文字，绑定 shopOpen 一个布尔变量。
 */
.shop-toggle {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  align-self: stretch;
  margin-top: 0.6vh;
  height: 3.2vh;
  box-sizing: border-box;
  background: rgba(80, 130, 210, 0.22);
  border: 1px solid rgba(140, 190, 255, 0.40);
  border-radius: 999px;
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.35);
}

.shop-toggle-text {
  font-size: 11px;
  font-weight: 600;
  line-height: 1;
  color: #a9d4ff;
  letter-spacing: 0.4px;
  white-space: nowrap;
}

/* ---------------- 区域 D：商店弹窗（浮层，不占布局空间） ---------------- */
/*
 * 遮罩只覆盖中间棋盘列：left 让开左栏（6vw 外边距 + 21vw 宽度），right 让开右栏 14vw。
 * 所以左右两侧的状态栏与 8 人榜单不会被压暗，底层棋盘尺寸也不会因弹窗开合而变化。
 */
.shop-mask {
  position: absolute;
  left: calc(#{$notch} + 21vw);
  right: 14vw;
  top: 0;
  bottom: 0;
  z-index: 60;                            // 高于棋盘与玩家榜单
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(4, 8, 16, 0.62);
}

/* 弹窗本体：尺寸固定，不随内容或底层布局变化 */
.shop-modal {
  display: flex;
  flex-direction: column;
  width: 58vw;
  height: 54vh;
  padding: 1.2vh 0.6vw;
  box-sizing: border-box;
  border: 1px solid rgba(140, 190, 255, 0.26);
  border-radius: 14px;
  background: rgba(13, 20, 34, 0.97);
  box-shadow:
    0 16px 40px rgba(0, 0, 0, 0.75),
    inset 0 1px 0 rgba(255, 255, 255, 0.06);
}

/* 标题行：与战报面板的头部保持同一套视觉 */
.shop-modal-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  flex-shrink: 0;
  padding-bottom: 0.8vh;
  border-bottom: 1px solid rgba(255, 255, 255, 0.07);
}

.shop-modal-title {
  font-size: 13px;
  font-weight: 600;
  color: $text-main;
  letter-spacing: 0.5px;
}

.shop-modal-hint {
  font-size: 9px;
  color: #6d80a0;
}

.shop-modal-actions {
  display: flex;
  flex-shrink: 0;
  justify-content: flex-end;
  padding: 0.9vh 0;
}

/* 刷新商店：只在弹窗内出现，弹窗关闭时按钮一并消失 */
.shop-refresh-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 38%;
  height: 3.8vh;
  margin: 0;
  padding: 0 10px;
  box-sizing: border-box;
  font-size: 12px;
  font-weight: 600;
  line-height: 1;
  color: #bcd8ff;
  background: rgba(38, 48, 70, 0.85);
  border: 1px solid rgba(120, 170, 255, 0.34);
  border-radius: 8px;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.08);
}

.shop-refresh-btn::after {
  border: none;
}

/* ---------------- 商店卡片列表 ---------------- */
.shop-list {
  display: flex;
  flex-direction: row;
  align-items: stretch;
  flex: 1;
  min-height: 0;
  min-width: 0;
  padding-bottom: 0.4vh;                  // 给卡片内的羁绊文字带留一点呼吸
}

.shop-slot {
  position: relative;                     // 羁绊名称条的定位基准（叠在卡面内下沿）
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
  margin-right: 0.7vw;
}

.shop-slot:last-child {
  margin-right: 0;
}

/*
 * 自定义组件宿主节点默认 height:auto，组件内部的 flex / height:100% 链条会断
 * （和棋盘 board-host 同一个坑）。这里给宿主显式接管高度，
 * 卡片才能撑满「格子高度 - 羁绊文字带高度」，而不是缩成内容高度。
 */
.shop-card-host {
  display: flex;
  flex-direction: column;
  flex: 1 1 auto;
  min-height: 0;
  width: 100%;
}

/*
 * 羁绊名称条：叠在卡面内部的下沿（绝对定位，不参与卡片的纵向排布）。
 * 有棋子的格子才渲染该节点，所有卡片高度因此仍然一致，下沿齐平。
 */
.shop-trait {
  position: absolute;
  left: 0.2vw;
  right: 0.2vw;
  bottom: 0.5vh;
  font-size: 9px;
  line-height: 1.25;
  text-align: center;
  color: #9dc0f0;
  letter-spacing: 0.2px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  pointer-events: none;                   // 文字不抢卡片的点击事件
}

.shop-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  flex: 1;
  border: 1px dashed rgba(140, 165, 205, 0.25);
  border-radius: 8px;
}

.shop-empty-text {
  font-size: 12px;
  color: #6d7a90;
}

/* ---------------- 发起战斗 ---------------- */
.battle-button {
  margin: 0;
  padding: 0 30px;
  font-size: 13px;
  font-weight: 600;
  line-height: 2.3;
  letter-spacing: 1px;
  color: #fff4f2;
  background: linear-gradient(180deg, #e04a42, #a8201f);
  border: 1px solid rgba(255, 150, 140, 0.55);
  border-radius: 10px;
  box-shadow:
    0 0 16px rgba(224, 74, 66, 0.42),
    inset 0 1px 0 rgba(255, 255, 255, 0.28);
}

.battle-button::after {
  border: none;
}

/* ---------------- 兜底空态 ---------------- */
.empty-state {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
}

.empty-text {
  font-size: 14px;
  color: #8fa0bf;
}

/* ============================================================
 * 以下 :deep() 仅在本页生效，统一把子组件的浅色皮肤换成深色，
 * 并把组件内部的 rpx 尺寸收敛到横屏可容纳的范围。
 * 组件源文件本身未做任何修改。
 * ============================================================ */

/* ---------------- 玩家状态 ---------------- */
.panel-status :deep(.player-status) {
  padding: 0;
  background: transparent;
  border: none;
  border-radius: 0;
}

.panel-status :deep(.name) {
  font-size: 13px;
  color: $text-main;
}

.panel-status :deep(.seat) {
  font-size: 10px;
  color: #7e90ad;
}

.panel-status :deep(.value) {
  font-size: 16px;
  color: $text-main;
}

.panel-status :deep(.label),
.panel-status :deep(.exp-label) {
  font-size: 11px;
  color: $text-sub;
}

.panel-status :deep(.exp-value) {
  font-size: 11px;
  color: #b9c6dd;
}

.panel-status :deep(.hp) {
  color: #ff6b6b;
}

.panel-status :deep(.gold) {
  color: $gold-light;
}

.panel-status :deep(.stats) {
  margin-top: 0.2vh;
}

/* 组件内 rpx 外边距在横屏会被放大 1.125 倍，这里统一压缩为像素级 */
.panel-status :deep(.head) {
  margin-bottom: 0.2vh;
}

.panel-status :deep(.label) {
  margin-bottom: 0;
}

.panel-status :deep(.exp-head) {
  margin-bottom: 1px;
}

.panel-status :deep(.exp) {
  margin-top: 0.4vh;
}

.panel-status :deep(.exp-track) {
  height: 4px;
  background: rgba(255, 255, 255, 0.10);
}

.panel-status :deep(.exp-fill) {
  background: linear-gradient(90deg, #c8963c, #f2c96b);
}

/* ---------------- 羁绊面板 ---------------- */
.panel-synergy :deep(.synergy-panel) {
  background: transparent;
  border: none;
  border-radius: 0;
}

.panel-synergy :deep(.trait-row) {
  padding: 6px 8px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
}

.panel-synergy :deep(.trait-main) {
  margin-bottom: 2px;
}

.panel-synergy :deep(.trait-levels) {
  gap: 8px;
}

.panel-synergy :deep(.trait-row:last-child) {
  border-bottom: none;
}

.panel-synergy :deep(.name) {
  font-size: 13px;
  color: #dbe7f8;
}

.panel-synergy :deep(.count) {
  font-size: 11px;
  color: #7fb6ff;
}

.panel-synergy :deep(.level),
.panel-synergy :deep(.next),
.panel-synergy :deep(.need) {
  font-size: 10px;
  color: #8a9bb8;
}

.panel-synergy :deep(.empty) {
  padding: 16px 8px;
  font-size: 11px;
  color: #5b6d8c;
}

/* ---------------- 战报：本回合我方输出排行 ---------------- */
/* 排行是本页自己的标记，不走 :deep；子组件 report-panel 已不再参与渲染 */
.dmg-list {
  display: flex;
  flex-direction: column;
}

.dmg-row {
  display: flex;
  align-items: center;
  padding: 0.55vh 0;
}

.dmg-row + .dmg-row {
  border-top: 1px solid rgba(255, 255, 255, 0.06);
}

/* 名次：纯文字，不发散，避免 text 节点上做背景块 */
.dmg-rank {
  flex: 0 0 14px;
  width: 14px;
  margin-right: 6px;
  font-size: 11px;
  font-weight: 700;
  line-height: 1.2;
  text-align: center;
  color: #7e90ad;
}

.dmg-rank-top {
  color: $gold-light;
}

.dmg-main {
  flex: 1;
  min-width: 0;
}

.dmg-line {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
}

/* 英雄名过长时省略，不允许撑破左栏 */
.dmg-name {
  flex: 0 1 auto;
  min-width: 0;
  font-size: 12px;
  font-weight: 600;
  line-height: 1.25;
  color: #e8eefc;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.dmg-value {
  flex: 0 0 auto;
  margin-left: 6px;
  font-size: 12px;
  font-weight: 700;
  line-height: 1.25;
  color: $gold-light;
}

.dmg-track {
  height: 3px;
  margin-top: 3px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.08);
  overflow: hidden;
}

.dmg-fill {
  height: 100%;
  border-radius: 999px;
  background: linear-gradient(90deg, #4a7cf0, #7fb6ff);
}

.dmg-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 0.6vh;
  padding-top: 0.5vh;
  border-top: 1px solid rgba(140, 190, 255, 0.18);
}

.dmg-foot-label {
  font-size: 10px;
  color: #8ea3c4;
}

.dmg-foot-value {
  font-size: 12px;
  font-weight: 700;
  color: #ffd27a;
}

/* ---------------- 棋盘：4×7 固定网格，铺满中栏，备战席贴底 ---------------- */
.board-stage :deep(.board-view) {
  display: flex;
  flex-direction: column;
  flex: 1;                                // 配合宿主节点撑满中栏可用区域
  min-height: 0;
  width: 100%;
  height: 100%;
  padding: 0.6vh 0.5vw;
  box-sizing: border-box;
  border-radius: 12px;
  background: rgba(11, 18, 30, 0.56);
  border: 1px solid rgba(120, 160, 220, 0.16);
  box-shadow: inset 0 0 26px rgba(40, 90, 160, 0.10);
  overflow: hidden;
}

/* 网格：4 行等高，行高由容器决定，与是否有棋子无关 */
.board-stage :deep(.board-grid) {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
}

.board-stage :deep(.board-row) {
  display: flex;
  flex-direction: row;
  flex: 1 1 0;                            // 4 行严格等分，不被内容撑高/压扁
  min-height: 0;
}

/* 每个格子是独立容器：细网格线 + 极淡底色，空格子也保留完整框架 */
.board-stage :deep(.cell) {
  flex: 1 1 0;                            // 7 列严格等分
  display: flex;
  align-items: center;
  justify-content: center;
  min-width: 0;
  min-height: 0;
  margin: 1px;
  box-sizing: border-box;
  border: 1px solid rgba(198, 212, 236, 0.16);
  border-radius: 5px;
  background: rgba(255, 255, 255, 0.025);
  overflow: hidden;
}

/* 棋子：深色卡面，垂直规整排布，去掉原来的白色悬浮块 */
.board-stage :deep(.unit) {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
  padding: 1px 2px;
  box-sizing: border-box;
  overflow: hidden;
  border-radius: 4px;
  border: 1px solid rgba(150, 195, 255, 0.34);
  background: linear-gradient(180deg, rgba(52, 80, 132, 0.95), rgba(30, 48, 82, 0.95));
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.12);
}

.board-stage :deep(.unit-name) {
  max-width: 100%;
  font-size: 11px;
  font-weight: 600;
  line-height: 1.15;
  color: #eef4ff;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.board-stage :deep(.unit-star) {
  margin-top: 1px;
  font-size: 9px;
  line-height: 1.15;
  color: #ffd27a;
}

/* 出售按钮：小号暗红胶囊，替代原先的白色方块 */
.board-stage :deep(.sell-button) {
  min-height: 0;
  height: auto;
  margin-top: 2px;
  padding: 0 5px;
  font-size: 9px;
  line-height: 1.35;
  color: #ffc9c9;
  background: rgba(120, 32, 36, 0.85);
  border: 1px solid rgba(255, 130, 130, 0.42);
  border-radius: 4px;
}

.board-stage :deep(.sell-button::after) {
  border: none;
}

/* 备战席：贴在棋盘容器内部下沿，与棋格之间用一条细线分隔 */
.board-stage :deep(.bench) {
  flex-shrink: 0;
  margin-top: 0.6vh;
  padding-top: 0.5vh;
  border-top: 1px solid rgba(140, 185, 245, 0.14);
}

.board-stage :deep(.bench-title) {
  display: block;
  margin-bottom: 0.4vh;
  font-size: 11px;
  color: #8ea3c4;
}

/* 9 个备战位排成一行（原来 20% 会被折成两行，挤占棋盘高度） */
.board-stage :deep(.bench-list) {
  flex-wrap: nowrap;
}

.board-stage :deep(.bench-unit) {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  width: 10.8%;
  min-height: 0;
  height: 5vh;
  margin: 0 0.2% 0 0;
  padding: 0 2px;
  box-sizing: border-box;
  border: 1px solid rgba(150, 185, 235, 0.20);
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.04);
}

/* 备战席格子更矮，字号单独收一档，保证「名称 + 星级」两行不溢出 */
.board-stage :deep(.bench-unit .unit-name) {
  font-size: 9px;
}

.board-stage :deep(.bench-unit .unit-star) {
  font-size: 8px;
  margin-top: 0;
}

.board-stage :deep(.bench-unit.selected) {
  border-color: #5b9dff;
  background: rgba(70, 120, 200, 0.22);
  box-shadow: 0 0 8px rgba(91, 157, 255, 0.55);
}

.board-stage :deep(.bench-empty) {
  padding: 4px;
  font-size: 10px;
  color: #5b6d8c;
}

/* ---------------- 商店卡片：深色半透明卡面 ---------------- */
.shop-slot :deep(.shop-card) {
  display: flex;
  flex-direction: column;
  justify-content: center;
  flex: 1 1 auto;                         // 高度由格子剩余空间决定（下方留出羁绊文字带）
  height: auto;
  min-height: 0;
  padding: 0.7vh 0.45vw 3.4vh;            // 底部内边距专门留给羁绊名称条
  box-sizing: border-box;
  border-radius: 10px;
  border: 1px solid rgba(255, 255, 255, 0.10);
  /* 下沿略亮一档，作为卡片与羁绊文字带的视觉分隔 */
  border-bottom-color: rgba(150, 190, 255, 0.26);
  background: rgba(40, 40, 60, 0.75);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.07),
    inset 0 -10px 18px rgba(0, 0, 0, 0.35);
}

.shop-slot :deep(.shop-card.selected) {
  border-color: rgba(120, 180, 255, 0.60);
  box-shadow:
    0 0 10px rgba(90, 150, 255, 0.38),
    inset 0 1px 0 rgba(255, 255, 255, 0.10);
}

/* 空位卡片：透明度 0.35，明显弱于有英雄的卡片 */
.shop-slot-empty :deep(.shop-card) {
  opacity: 0.35;
  border-style: dashed;
  border-color: rgba(255, 255, 255, 0.10);
  background: rgba(28, 28, 44, 0.55);
  box-shadow: none;
}

.shop-slot :deep(.top) {
  margin-bottom: 3px;
}

.shop-slot :deep(.name) {
  font-size: 13px;
  font-weight: 600;
  line-height: 1.2;
  color: #f2f6ff;
}

.shop-slot :deep(.cost) {
  font-size: 10px;
  line-height: 1.2;
  color: $gold-light;
}

/*
 * 卡片内原本是「星级」「余量」上下两行，横屏卡片高度有限，
 * 这里改成同一行左右分布，把纵向空间让给下方新增的羁绊文字带。
 */
.shop-slot :deep(.body) {
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
}

.shop-slot :deep(.meta) {
  font-size: 10px;
  line-height: 1.25;
  white-space: nowrap;
  color: #b6c4dc;
}

.shop-slot :deep(.locked) {
  margin-top: 2px;
  font-size: 9px;
  color: #8fd0ff;
}
</style>
