<template>
  <view class="board-view">
    <view class="board-grid">
      <view v-for="row in rows" :key="'row-' + row" class="board-row">
        <view
          v-for="col in cols"
          :key="'col-' + col"
          class="cell"
          @click="handlePlace(row - 1, col - 1)"
        >
          <template v-for="unit in board" :key="unit.uid">
            <view
              v-if="unit.row === row - 1 && unit.col === col - 1"
              class="unit"
              @click.stop="handleRemove(unit)"
            >
              <text class="unit-name">{{ unit.name }}</text>
              <text class="unit-star">星级 {{ unit.star }}</text>
              <button class="sell-button" size="mini" @click.stop="handleSell(unit)">出售</button>
            </view>
          </template>
        </view>
      </view>
    </view>

    <view class="bench">
      <text class="bench-title">备战席</text>
      <view class="bench-list">
        <view
          v-for="unit in bench"
          :key="unit.uid"
          class="bench-unit"
          :class="{ selected: selectedUnit && selectedUnit.uid === unit.uid }"
          @click="handleSelect(unit)"
        >
          <text class="unit-name">{{ unit.name }}</text>
          <text class="unit-star">星级 {{ unit.star }}</text>
        </view>
        <view v-if="bench.length === 0" class="bench-empty">
          <text>备战席为空</text>
        </view>
      </view>
    </view>
  </view>
</template>

<script setup>
/**
 * BoardView · 纯展示棋盘组件。
 * 只渲染后端返回的 board / bench；不计算星级、位置、金币或卡池。
 * 交互以事件抛出：select（选中备战棋子）、place（放置到格子）、remove（撤下）、sell（出售）。
 */
const props = defineProps({
  board: {
    type: Array,
    default: () => [],
  },
  bench: {
    type: Array,
    default: () => [],
  },
  rows: {
    type: [Number, String],
    default: 0,
  },
  cols: {
    type: [Number, String],
    default: 0,
  },
  selectedUnit: {
    type: Object,
    default: null,
  },
});

const emit = defineEmits(['select', 'place', 'remove', 'sell']);

function handleSelect(unit) {
  emit('select', unit);
}

function handlePlace(row, col) {
  emit('place', {
    unit: props.selectedUnit,
    target: { location: 1, row, col },
  });
}

function handleRemove(unit) {
  emit('remove', unit);
}

function handleSell(unit) {
  emit('sell', unit);
}
</script>

<style lang="scss" scoped>
.board-view {
  background: #ffffff;
  border-radius: 16rpx;
  padding: 20rpx;
  border: 1rpx solid #e5e7eb;
}

.board-row {
  display: flex;
  flex-direction: row;
}

.cell {
  flex: 1;
  min-height: 100rpx;
  margin: 4rpx;
  border: 1rpx dashed #d7dae0;
  border-radius: 10rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
}

.unit,
.bench-unit {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  width: 100%;
  padding: 8rpx 0;
}

.unit-name {
  font-size: 20rpx;
  color: #1f2329;
  text-align: center;
}

.unit-star {
  font-size: 18rpx;
  color: #8a9099;
  margin-top: 4rpx;
}

.sell-button {
  margin-top: 6rpx;
  padding: 0 8rpx;
  font-size: 16rpx;
  color: #d92b2b;
  border: 1rpx solid #d92b2b;
  background: #ffffff;
  line-height: 1.5;
}

.bench {
  margin-top: 24rpx;
}

.bench-title {
  display: block;
  font-size: 24rpx;
  color: #1f2329;
  margin-bottom: 12rpx;
}

.bench-list {
  display: flex;
  flex-direction: row;
  flex-wrap: wrap;
}

.bench-unit {
  width: 20%;
  min-height: 110rpx;
  margin-bottom: 12rpx;
  border: 1rpx solid #e5e7eb;
  border-radius: 10rpx;
  box-sizing: border-box;
}

.bench-unit.selected {
  border-color: #2f6fed;
}

.bench-empty {
  padding: 20rpx;
  font-size: 22rpx;
  color: #8a9099;
}
</style>
