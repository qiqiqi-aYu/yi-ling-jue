<template>
  <view class="synergy-panel">
    <view
      v-for="(trait, index) in traits"
      :key="trait.traitId || index"
      class="trait-row"
      @click="handleSelect(trait)"
    >
      <view class="trait-main">
        <text class="name">{{ trait.name }}</text>
        <text class="count">英雄 {{ trait.heroCount === undefined ? '-' : trait.heroCount }}</text>
      </view>

      <view class="trait-levels">
        <text class="level">已激活 {{ trait.activeLevel === undefined ? '-' : trait.activeLevel }} 档</text>
        <text class="next">下一档 {{ trait.nextLevel === undefined ? '-' : trait.nextLevel }}</text>
        <text class="need">还差 {{ trait.need === undefined ? '-' : trait.need }}</text>
      </view>
    </view>

    <view v-if="traits.length === 0" class="empty">
      <text>暂无羁绊数据</text>
    </view>
  </view>
</template>

<script setup>
/**
 * SynergyPanel · 纯展示组件。
 * 羁绊计数、档位和下一档需求均来自后端；组件不统计、不排序、不推算。
 */
const props = defineProps({
  traits: {
    type: Array,
    default: () => [],
  },
});

const emit = defineEmits(['select']);

function handleSelect(trait) {
  emit('select', trait);
}
</script>

<style lang="scss" scoped>
.synergy-panel {
  background: #ffffff;
  border-radius: 16rpx;
  border: 1rpx solid #e5e7eb;
  overflow: hidden;
}

.trait-row {
  padding: 20rpx 24rpx;
  border-bottom: 1rpx solid #f0f1f3;
}

.trait-main {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 10rpx;
}

.name {
  font-size: 28rpx;
  font-weight: 600;
  color: #1f2329;
}

.count {
  font-size: 22rpx;
  color: #2f6fed;
}

.trait-levels {
  display: flex;
  flex-direction: row;
  gap: 20rpx;
}

.level,
.next,
.need {
  font-size: 22rpx;
  color: #8a9099;
}

.empty {
  padding: 40rpx 24rpx;
  text-align: center;
  font-size: 24rpx;
  color: #8a9099;
}
</style>
