<template>
  <view class="shop-card" :class="{ selected, disabled }" @click="handleSelect">
    <view class="top">
      <text class="name">{{ hero.name || '空位' }}</text>
      <text class="cost">费用 {{ hero.cost === undefined ? '-' : hero.cost }}</text>
    </view>

    <view class="body">
      <text class="meta">星级 {{ hero.star === undefined ? '-' : hero.star }}</text>
      <text class="meta">余量 {{ hero.remainingInPool === undefined ? '-' : hero.remainingInPool }}</text>
    </view>

    <text v-if="locked" class="locked">已锁定</text>
  </view>
</template>

<script setup>
/**
 * ShopCard · 纯展示组件。
 * 只渲染后端返回的商店棋子数据；点击只向上 emit，不在组件内购买、扣金或改卡池。
 */
const props = defineProps({
  hero: {
    type: Object,
    default: () => ({}),
  },
  selected: {
    type: Boolean,
    default: false,
  },
  disabled: {
    type: Boolean,
    default: false,
  },
  locked: {
    type: Boolean,
    default: false,
  },
});

const emit = defineEmits(['select']);

function handleSelect() {
  emit('select', props.hero);
}
</script>

<style lang="scss" scoped>
.shop-card {
  min-height: 150rpx;
  padding: 18rpx;
  background: #ffffff;
  border-radius: 16rpx;
  border: 2rpx solid #e5e7eb;
  box-sizing: border-box;
}

.shop-card.selected {
  border-color: #2f6fed;
}

.shop-card.disabled {
  opacity: 0.5;
}

.top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 14rpx;
}

.name {
  font-size: 28rpx;
  font-weight: 600;
  color: #1f2329;
}

.cost {
  font-size: 22rpx;
  color: #c58b12;
}

.body {
  display: flex;
  flex-direction: column;
}

.meta {
  font-size: 22rpx;
  color: #8a9099;
  line-height: 1.6;
}

.locked {
  display: block;
  margin-top: 10rpx;
  font-size: 20rpx;
  color: #2f6fed;
}
</style>
