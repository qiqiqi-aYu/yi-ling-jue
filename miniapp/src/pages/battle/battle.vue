<template>
  <view class="battle-page">
    <view v-if="!store.hasMatch" class="placeholder">
      <text>当前没有进行中的对局，请返回首页点击「开始对局」</text>
    </view>

    <view class="section">
      <view class="section-title">
        <text>对局状态</text>
        <text class="section-meta">回合 {{ store.round }} · 版本 {{ store.version }}</text>
      </view>
      <player-status
        name="真人玩家"
        :player-index="store.me.playerIndex"
        :hp="store.me.hp"
        :gold="store.me.gold"
        :level="store.me.level"
      />
    </view>

    <view class="section">
      <view class="section-title">
        <text>商店</text>
        <button class="refresh-button" size="mini" :loading="store.loading" @click="handleRefreshShop">
          刷新商店
        </button>
      </view>
      <view class="shop-grid">
        <shop-card
          v-for="(hero, index) in store.shop"
          :key="index"
          :hero="hero"
          :locked="hero.locked"
          @select="handleShopSelect"
        />
      </view>
      <view v-if="store.shop.length === 0" class="placeholder">
        <text>当前没有商店数据</text>
      </view>
    </view>

    <view class="section">
      <view class="section-title">
        <text>羁绊</text>
        <text class="section-meta">来自后端聚合状态</text>
      </view>
      <synergy-panel :traits="store.traits" @select="handleTraitSelect" />
    </view>

    <view class="section">
      <view class="section-title">
        <text>棋盘</text>
        <button class="battle-button" size="mini" :loading="store.loading" @click="handleBattle">
          发起战斗
        </button>
      </view>
      <board-view
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

    <view class="section">
      <view class="section-title">
        <text>战报时间轴</text>
        <button class="report-button" size="mini" @click="handleToggleReport">
          {{ reportOpen ? '收起' : '展开' }}
        </button>
      </view>
      <report-panel v-if="reportOpen" :timeline="store.timeline" />
    </view>
  </view>
</template>

<script setup>
import { ref } from 'vue';
import { useMatchStore } from '../../store/match.js';

/**
 * 对局主页面（模块 7）。
 * 只做 UI 组装、Store 状态绑定与事件转发；
 * 不在页面计算棋子位置、星级、卡池、金币或战斗结果。
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
.battle-page {
  min-height: 100vh;
  padding: 24rpx;
  box-sizing: border-box;
}

.section {
  margin-bottom: 28rpx;
}

.section-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 14rpx;
  font-size: 28rpx;
  font-weight: 600;
  color: #1f2329;
}

.section-meta {
  font-size: 22rpx;
  font-weight: 400;
  color: #8a9099;
}

.refresh-button,
.battle-button,
.report-button {
  margin: 0;
  padding: 0 20rpx;
  font-size: 22rpx;
  background: #ffffff;
  line-height: 1.8;
}

.refresh-button {
  color: #2f6fed;
  border: 1rpx solid #2f6fed;
}

.battle-button {
  color: #d92b2b;
  border: 1rpx solid #d92b2b;
}

.report-button {
  color: #1f9d55;
  border: 1rpx solid #1f9d55;
}

.shop-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16rpx;
}

.placeholder {
  padding: 48rpx 24rpx;
  text-align: center;
  background: #ffffff;
  border: 1rpx dashed #d7dae0;
  border-radius: 16rpx;
  color: #8a9099;
  font-size: 24rpx;
}

.board-placeholder {
  min-height: 260rpx;
  display: flex;
  align-items: center;
  justify-content: center;
}
</style>
