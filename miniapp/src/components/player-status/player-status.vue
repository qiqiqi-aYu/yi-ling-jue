<template>
  <view class="player-status">
    <view class="head">
      <text class="name">{{ name }}</text>
      <text class="seat">座位 {{ playerIndex }}</text>
    </view>

    <view class="stats">
      <view class="stat">
        <text class="label">血量</text>
        <text class="value hp">{{ hp }}</text>
      </view>
      <view class="stat">
        <text class="label">金币</text>
        <text class="value gold">{{ gold }}</text>
      </view>
      <view class="stat">
        <text class="label">等级</text>
        <text class="value">{{ level }}</text>
      </view>
    </view>

    <view class="exp">
      <view class="exp-head">
        <text class="exp-label">经验</text>
        <text class="exp-value">{{ expText }}</text>
      </view>
      <view class="exp-track">
        <view class="exp-fill" :style="{ width: expPercent + '%' }"></view>
      </view>
    </view>
  </view>
</template>

<script setup>
import { computed } from 'vue';

/**
 * PlayerStatus · 纯展示组件。
 * 只渲染父组件传入的血量 / 金币 / 等级 / 经验，不调用接口、不缓存状态、不计算数值。
 * 经验条宽度直接取后端返回的 expPercent（整数百分比），前端不做 exp ÷ nextExp 之类的换算，
 * 也就不存在「前端自行判断能否升级」的可能。
 */
const props = defineProps({
  name: {
    type: String,
    default: '',
  },
  playerIndex: {
    type: [Number, String],
    default: 0,
  },
  hp: {
    type: [Number, String],
    default: 0,
  },
  gold: {
    type: [Number, String],
    default: 0,
  },
  level: {
    type: [Number, String],
    default: 0,
  },
  exp: {
    type: [Number, String],
    default: 0,
  },
  /** 升到下一级所需经验；null 表示已满级 */
  nextExp: {
    type: [Number, String],
    default: null,
  },
  /** 后端算好的经验条百分比（0~100） */
  expPercent: {
    type: [Number, String],
    default: 0,
  },
});

/** 经验文案：满级由 nextExp 为 null 判定，不做阈值比较 */
const expText = computed(() => (
  props.nextExp === null || props.nextExp === undefined
    ? '已满级'
    : `${props.exp} / ${props.nextExp}`
));
</script>

<style lang="scss" scoped>
.player-status {
  padding: 20rpx 24rpx;
  background: #ffffff;
  border-radius: 16rpx;
  border: 1rpx solid #e5e7eb;
}

.head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 16rpx;
}

.name {
  font-size: 30rpx;
  font-weight: 600;
  color: #1f2329;
}

.seat {
  font-size: 22rpx;
  color: #8a9099;
}

.stats {
  display: flex;
  flex-direction: row;
}

.stat {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
}

.label {
  font-size: 22rpx;
  color: #8a9099;
  margin-bottom: 6rpx;
}

.value {
  font-size: 32rpx;
  font-weight: 700;
  color: #1f2329;
}

.hp {
  color: #d92b2b;
}

.gold {
  color: #c58b12;
}

.exp {
  margin-top: 18rpx;
}

.exp-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8rpx;
}

.exp-label {
  font-size: 22rpx;
  color: #8a9099;
}

.exp-value {
  font-size: 22rpx;
  color: #4e5969;
}

.exp-track {
  width: 100%;
  height: 10rpx;
  border-radius: 999rpx;
  background: #eef0f3;
  overflow: hidden;
}

.exp-fill {
  height: 100%;
  border-radius: 999rpx;
  background: linear-gradient(90deg, #4a7cf0, #6aa6ff);
  transition: width 0.2s ease;
}
</style>
