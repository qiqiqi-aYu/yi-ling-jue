<template>
  <view class="battle-page">
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
        <text class="section-meta">后续模块实现</text>
      </view>
      <view class="placeholder board-placeholder">
        <text>棋盘可视化占位</text>
      </view>
    </view>
  </view>
</template>

<script setup>
import { useMatchStore } from '../../store/match.js';

/**
 * 对局主页面（模块 4）。
 * 只做 UI 组装、Store 状态绑定与 emit 事件打印；
 * 不调用 API，不实现购买/部署，不计算任何游戏数值。
 */
const store = useMatchStore();

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

.refresh-button {
  margin: 0;
  padding: 0 20rpx;
  font-size: 22rpx;
  color: #2f6fed;
  background: #ffffff;
  border: 1rpx solid #2f6fed;
  line-height: 1.8;
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
