<template>
  <view class="page">
    <view class="card">
      <text class="title">弈灵诀 · 基础通道</text>
      <text class="subtitle">登录后可直接创建对局进入棋盘，所有数值均由后端 P0 接口返回。</text>

      <view class="row">
        <text class="label">接口地址</text>
        <text class="value">{{ baseUrl }}</text>
      </view>
      <view class="row">
        <text class="label">登录状态</text>
        <text class="value">{{ session.isLoggedIn ? '已登录' : '未登录' }}</text>
      </view>
      <view class="row" v-if="session.isLoggedIn">
        <text class="label">角色</text>
        <text class="value">{{ session.role }}</text>
      </view>

      <button class="button" type="primary" :loading="loading" @click="handleLogin">
        测试玩家登录
      </button>
      <button
        v-if="session.isLoggedIn"
        class="button"
        type="primary"
        :loading="starting"
        @click="handleStartMatch"
      >
        开始对局
      </button>
      <button class="button button-secondary" @click="handleLogout">清除本地会话</button>

      <text v-if="message" class="message">{{ message }}</text>
    </view>
  </view>
</template>

<script setup>
import { ref } from 'vue';
import { onLoad } from '@dcloudio/uni-app';
import { getBaseUrl } from '../../api/request.js';
import { useSessionStore } from '../../store/session.js';
import { useMatchStore } from '../../store/match.js';

const session = useSessionStore();
const matchStore = useMatchStore();
const baseUrl = getBaseUrl();
const loading = ref(false);
const starting = ref(false);
const message = ref('');

onLoad(() => {
  session.restore();
});

async function handleLogin() {
  loading.value = true;
  message.value = '';
  try {
    // 单机课设实现只要求非空 code；openid 与 token 完全由后端返回。
    await session.login('local-dev-code');
    message.value = '登录成功，后端通道可用';
  } catch (err) {
    message.value = err.message || '登录失败';
  } finally {
    loading.value = false;
  }
}

/**
 * 开始对局：建局 → 拉取商店/羁绊/棋盘 → 跳转对局页。
 * 首页只负责按顺序调接口，棋子、金币、卡池等数值一律不在此计算。
 */
async function handleStartMatch() {
  if (starting.value) return;
  if (!session.isLoggedIn) {
    message.value = '请先登录';
    return;
  }
  starting.value = true;
  message.value = '';
  try {
    await matchStore.create({});
    await matchStore.loadShop();
    await matchStore.loadTraits();
    await matchStore.loadBoard();
    message.value = `对局 #${matchStore.matchId} 已创建`;
    uni.navigateTo({ url: '/pages/battle/battle' });
  } catch (err) {
    message.value = (err && err.message) || '创建对局失败';
  } finally {
    starting.value = false;
  }
}

function handleLogout() {
  session.logout();
  // 会话失效后旧对局状态一并清空，避免用旧 token 继续操作。
  matchStore.reset();
  message.value = '本地会话已清除';
}
</script>

<style lang="scss" scoped>
.page {
  padding: 40rpx;
}

.card {
  background: #ffffff;
  border-radius: 24rpx;
  padding: 40rpx;
  box-shadow: 0 8rpx 30rpx rgba(31, 35, 41, 0.06);
}

.title {
  display: block;
  font-size: 40rpx;
  font-weight: 700;
  margin-bottom: 16rpx;
}

.subtitle {
  display: block;
  color: #8a9099;
  font-size: 26rpx;
  line-height: 1.6;
  margin-bottom: 40rpx;
}

.row {
  display: flex;
  justify-content: space-between;
  padding: 20rpx 0;
  border-bottom: 1rpx solid #e5e7eb;
  font-size: 28rpx;
}

.label {
  color: #8a9099;
}

.value {
  color: #1f2329;
  max-width: 70%;
  text-align: right;
  word-break: break-all;
}

.button {
  margin-top: 40rpx;
}

.button-secondary {
  color: #2f6fed;
  background: #ffffff;
  border: 1rpx solid #2f6fed;
}

.message {
  display: block;
  margin-top: 24rpx;
  color: #1f9d55;
  font-size: 26rpx;
}
</style>
