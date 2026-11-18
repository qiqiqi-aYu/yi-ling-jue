'use strict';

import { defineStore } from 'pinia';
import { miniappLogin } from '../api/auth.js';
import { clearToken, getToken, setToken } from '../api/request.js';
import { ROLE, SESSION_STORAGE_KEY } from '../utils/constants.js';

/**
 * 会话状态：只保存登录产物与角色，不承载对局数值。
 */
export const useSessionStore = defineStore('session', {
  state: () => ({
    token: getToken(),
    role: '',
    openid: '',
    username: '',
    restored: false,
  }),

  getters: {
    isPlayer: (state) => state.role === ROLE.PLAYER,
    isLoggedIn: (state) => Boolean(state.token),
  },

  actions: {
    /** 从本地缓存恢复会话（不重新请求后端） */
    restore() {
      try {
        const cached = uni.getStorageSync(SESSION_STORAGE_KEY) || {};
        this.token = cached.token || getToken();
        this.role = cached.role || '';
        this.openid = cached.openid || '';
        this.username = cached.username || '';
      } catch (err) {
        this.token = getToken();
      }
      this.restored = true;
    },

    /** 使用一次性 code 登录，结果完全来自后端 */
    async login(code) {
      const data = await miniappLogin(code);
      this.token = data.token;
      this.role = data.role;
      this.openid = data.openid || '';
      this.username = data.username || '';
      setToken(this.token);
      try {
        uni.setStorageSync(SESSION_STORAGE_KEY, {
          token: this.token,
          role: this.role,
          openid: this.openid,
          username: this.username,
        });
      } catch (err) {
        // 缓存失败不影响本次会话。
      }
      this.restored = true;
      return data;
    },

    logout() {
      this.token = '';
      this.role = '';
      this.openid = '';
      this.username = '';
      clearToken();
      try {
        uni.removeStorageSync(SESSION_STORAGE_KEY);
      } catch (err) {
        // 忽略存储清理失败。
      }
    },
  },
});
