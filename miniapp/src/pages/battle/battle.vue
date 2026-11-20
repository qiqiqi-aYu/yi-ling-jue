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

        <!-- A3 战报时间轴：收起时为侧边条；展开时由 report-open 类浮层覆盖上方两块面板 -->
        <view class="panel panel-report" :class="{ 'report-open': reportOpen }">
          <view class="panel-head">
            <text class="panel-title">战报</text>
            <text class="panel-toggle" @click="handleToggleReport">
              {{ reportOpen ? '收起' : '展开' }}
            </text>
          </view>
          <view class="panel-body">
            <report-panel v-if="reportOpen" :timeline="store.timeline" />
            <view v-else class="panel-placeholder">
              <text class="panel-placeholder-text">战报已收起</text>
            </view>
          </view>
        </view>
      </view>

      <!-- ============ 区域 B：中间棋盘（居中） ============ -->
      <view class="center">
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

      <!-- ============ 区域 C：右侧对手区（其余 7 名玩家，静态占位） ============ -->
      <view class="rail rail-right">
        <!-- 占位槽：暂不接入数据，仅预留 7 个版位，竖向排布 -->
        <view class="opponent-slot"><text class="opponent-hint">玩家 2</text></view>
        <view class="opponent-slot"><text class="opponent-hint">玩家 3</text></view>
        <view class="opponent-slot"><text class="opponent-hint">玩家 4</text></view>
        <view class="opponent-slot"><text class="opponent-hint">玩家 5</text></view>
        <view class="opponent-slot"><text class="opponent-hint">玩家 6</text></view>
        <view class="opponent-slot"><text class="opponent-hint">玩家 7</text></view>
        <view class="opponent-slot"><text class="opponent-hint">玩家 8</text></view>
      </view>

      <!-- ============ 区域 D：底部固定通栏商店 ============ -->
      <view class="shop-bar">
        <!-- D1 操作按钮列 -->
        <view class="shop-actions">
          <button
            class="shop-action-btn refresh-button"
            size="mini"
            :loading="store.loading"
            @click="handleRefreshShop"
          >
            刷新商店
          </button>
          <button
            class="shop-action-btn exp-button"
            size="mini"
            :loading="store.loading"
            :disabled="!store.me.canBuyExp"
            @click="handleBuyExp"
          >
            购买经验
          </button>
          <!-- 禁用原因由后端返回，前端不比较金币与等级 -->
          <text v-if="!store.me.canBuyExp && store.me.buyExpBlockedMessage" class="exp-tip">
            {{ store.me.buyExpBlockedMessage }}
          </text>
        </view>

        <!-- D2 商店卡片列表 -->
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
    </template>
  </view>
</template>

<script setup>
import { ref } from 'vue';
import { useMatchStore } from '../../store/match.js';

/**
 * 对局主页面（横屏改造版）。
 * 只做 UI 组装、Store 状态绑定与事件转发；
 * 不在页面计算棋子位置、星级、卡池、金币或战斗结果。
 * 本轮仅调整样式与视觉质感，事件链路与 Store / API 调用保持原样。
 */
const store = useMatchStore();
const selectedUnit = ref(null);
const reportOpen = ref(false);

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
$shop-h: 24vh;          // 底部商店通栏高度
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

/* 战报【展开/收起】固定在所在区块右上角 */
.panel-toggle {
  position: absolute;
  top: 0.9vh;
  right: 0.45vw;
  z-index: 3;
  padding: 0.25vh 8px;
  font-size: 10px;
  line-height: 1.5;
  color: #a9d4ff;
  background: rgba(80, 130, 210, 0.20);
  border: 1px solid rgba(140, 190, 255, 0.38);
  border-radius: 999px;
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
  // 顶部留出返回按钮的高度，避免遮挡「对局状态」标题
  padding: $top-strip 0.7vw calc(#{$shop-h} + #{$gap});
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
 *   收起时 → 左栏底部一条侧边条，只留标题行与【展开】按钮；
 *   展开时 → 绝对定位铺满左栏内容区（含顶部返回条以下），浮在
 *            玩家状态与羁绊之上，z-index 高于左栏内其他面板。
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

.panel-report .panel-body {
  display: none;                          // 收起态不显示内容区
}

.panel-report.report-open {
  position: absolute;
  top: $top-strip;
  bottom: calc(#{$shop-h} + #{$gap});
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

.panel-report.report-open .panel-body {
  display: block;
  flex: 1;
  min-height: 0;
}

/* ---------------- 区域 B：中间棋盘 ---------------- */
.center {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
  padding: 0.8vh 0.5vw calc(#{$shop-h} + #{$gap});
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

/* ---------------- 区域 C：右侧 7 名对手（竖向） ---------------- */
.rail-right {
  display: flex;
  flex-direction: column;
  flex: 0 0 14vw;
  width: 14vw;
  min-width: 0;
  padding: $gap 0.6vw calc(#{$shop-h} + #{$gap});
  box-sizing: border-box;
  overflow: hidden;
}

.opponent-slot {
  display: flex;
  align-items: center;
  justify-content: flex-start;
  flex: 1 1 0;                            // 7 格等分剩余高度
  min-height: 0;
  margin-bottom: $gap;
  padding: 0 0.45vw;
  box-sizing: border-box;
  border: 1px solid rgba(120, 160, 220, 0.12);
  border-left: 2px solid rgba(120, 170, 255, 0.30);
  border-radius: 8px;
  background: rgba(16, 24, 40, 0.55);
}

.opponent-slot:last-child {
  margin-bottom: 0;
}

.opponent-hint {
  font-size: 11px;
  color: #5f7396;
}

/* ---------------- 区域 D：底部固定通栏商店 ---------------- */
.shop-bar {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 20;
  display: flex;
  flex-direction: row;
  align-items: stretch;
  height: $shop-h;
  padding: 1vh 1vw 1.2vh;                 // 底部多留一档，给卡片下方的羁绊文字带留呼吸空间
  box-sizing: border-box;
  overflow: hidden;
  background: rgba(0, 0, 0, 0.60);        // 半透明黑底
  border-top: 1px solid rgba(255, 255, 255, 0.12);
}

.shop-actions {
  position: relative;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: stretch;
  flex: 0 0 12.5vw;
  width: 12.5vw;
  padding-right: 0.8vw;
  box-sizing: border-box;
}

/* ---------------- 底部按钮通用形态 ---------------- */
.shop-action-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  margin: 0;
  padding: 0 4px;
  height: 7.2vh;
  font-size: 12px;
  line-height: 1.2;
  box-sizing: border-box;
  border-radius: 8px;
}

/* 去掉微信 button 自带的 ::after 边框，避免与自定义描边叠加 */
.shop-action-btn::after {
  border: none;
}

/* 刷新商店：冷色描边按钮 */
.refresh-button {
  color: #bcd8ff;
  background: rgba(38, 48, 70, 0.85);
  border: 1px solid rgba(120, 170, 255, 0.34);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.08);
}

/*
 * 购买经验：标准金色按钮。
 * 高度固定为 8.8vh，底部留 2.8vh 内边距，用来承载禁用原因文案；
 * 文案是紧跟按钮的兄弟节点，用负外边距把它拉进按钮下沿内，
 * 从而在不改动模板结构的前提下实现「提示文字在按钮内部」。
 */
.exp-button {
  margin-top: 0.9vh;
  height: 8.8vh;
  padding: 0 4px 2.8vh;
  font-weight: 600;
  color: #2a1f0c;
  background: linear-gradient(180deg, #e2b45c, #b8862f);
  border: 1px solid rgba(255, 220, 150, 0.55);
  border-radius: 8px;
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.35),
    0 2px 12px rgba(180, 130, 40, 0.22);
}

/* 金币不足 / 已满级：整体灰化，透明度 0.4 */
.exp-button[disabled] {
  color: #9aa3b6;
  background: rgba(66, 72, 88, 0.55);
  border-color: rgba(255, 255, 255, 0.08);
  box-shadow: none;
  opacity: 0.4;
}

.exp-tip {
  position: relative;
  z-index: 2;
  margin-top: -2.8vh;
  height: 2.8vh;
  line-height: 2.8vh;
  font-size: 9px;
  font-weight: 600;
  color: #ffe6ae;
  text-align: center;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  pointer-events: none;                   // 文案不抢按钮点击
}

.exp-button[disabled] + .exp-tip {
  color: #9aa3b6;
}

/* ---------------- 商店卡片列表 ---------------- */
.shop-list {
  display: flex;
  flex-direction: row;
  align-items: stretch;
  flex: 1;
  min-width: 0;
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

/* ---------------- 战报面板 ---------------- */
.panel-report :deep(.report-panel) {
  max-height: none;
  height: 100%;
  background: transparent;
  border: none;
  border-radius: 0;
}

.panel-report :deep(.frame-row) {
  padding: 5px 8px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
}

.panel-report :deep(.frame-head) {
  margin-bottom: 2px;
}

.panel-report :deep(.frame-body) {
  margin-bottom: 1px;
  font-size: 11px;
  color: #d8e3f5;
}

.panel-report :deep(.frame-meta) {
  gap: 8px;
  font-size: 10px;
  color: #7e90ad;
}

.panel-report :deep(.frame-row:last-child) {
  border-bottom: none;
}

.panel-report :deep(.time) {
  font-size: 10px;
  color: #7e90ad;
}

.panel-report :deep(.type) {
  font-size: 10px;
  color: #7fb6ff;
}

.panel-report :deep(.arrow) {
  color: #5f7396;
}

.panel-report :deep(.empty) {
  padding: 16px 8px;
  font-size: 11px;
  color: #5b6d8c;
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
