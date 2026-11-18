import { createSSRApp } from 'vue';
import { createPinia } from 'pinia';
import App from './App.vue';
import PlayerStatus from './components/player-status/player-status.vue';
import ShopCard from './components/shop-card/shop-card.vue';
import SynergyPanel from './components/synergy-panel/synergy-panel.vue';
import BoardView from './components/board-view/board-view.vue';
import ReportPanel from './components/report-panel/report-panel.vue';

/**
 * UniApp Vue3 应用入口。
 * Pinia 只保存会话与后续对局视图状态，不进行任何数值计算。
 * 基础展示组件在这里全局注册，页面后续只负责传 props 与接收 emit。
 */
export function createApp() {
  const app = createSSRApp(App);
  app.use(createPinia());
  app.component('player-status', PlayerStatus);
  app.component('shop-card', ShopCard);
  app.component('synergy-panel', SynergyPanel);
  app.component('board-view', BoardView);
  app.component('report-panel', ReportPanel);
  return { app };
}
