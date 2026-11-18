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
  </view>
</template>

<script setup>
/**
 * PlayerStatus · 纯展示组件。
 * 只渲染父组件传入的血量 / 金币 / 等级，不调用接口、不缓存状态、不计算数值。
 */
defineProps({
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
});
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
</style>
