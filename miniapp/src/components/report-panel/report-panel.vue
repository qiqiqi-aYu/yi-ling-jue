<template>
  <view class="report-panel">
    <view v-for="(frame, index) in timeline" :key="index" class="frame-row">
      <view class="frame-head">
        <text class="time">{{ frame.t }}s</text>
        <text class="type">{{ frame.type }}</text>
      </view>
      <view class="frame-body">
        <text class="actor">{{ frame.actor }}</text>
        <text class="arrow">→</text>
        <text class="target">{{ frame.target }}</text>
      </view>
      <view class="frame-meta">
        <text>数值 {{ frame.value === undefined ? '-' : frame.value }}</text>
        <text>目标血量 {{ frame.targetHp === undefined ? '-' : frame.targetHp }}</text>
      </view>
    </view>

    <view v-if="timeline.length === 0" class="empty">
      <text>暂无战报帧</text>
    </view>
  </view>
</template>

<script setup>
/**
 * ReportPanel · 纯展示组件。
 * 只渲染后端返回的 timeline 战斗帧；不做动画、不重放战斗、不计算伤害或血量。
 */
defineProps({
  timeline: {
    type: Array,
    default: () => [],
  },
});
</script>

<style lang="scss" scoped>
.report-panel {
  max-height: 600rpx;
  overflow-y: auto;
  background: #ffffff;
  border-radius: 16rpx;
  border: 1rpx solid #e5e7eb;
}

.frame-row {
  padding: 18rpx 24rpx;
  border-bottom: 1rpx solid #f0f1f3;
}

.frame-head {
  display: flex;
  justify-content: space-between;
  margin-bottom: 10rpx;
}

.time {
  font-size: 22rpx;
  color: #8a9099;
}

.type {
  font-size: 22rpx;
  color: #2f6fed;
}

.frame-body {
  display: flex;
  align-items: center;
  margin-bottom: 8rpx;
  font-size: 26rpx;
  color: #1f2329;
}

.arrow {
  margin: 0 16rpx;
  color: #8a9099;
}

.frame-meta {
  display: flex;
  gap: 24rpx;
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
