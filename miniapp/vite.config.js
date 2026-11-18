import { defineConfig } from 'vite';
import uniPlugin from '@dcloudio/vite-plugin-uni';

// Node ESM 与 Vite CJS 互操作时，默认导出可能包一层 default。
const uni = uniPlugin.default || uniPlugin;

// 仅做 UniApp 构建配置；不含任何游戏数值逻辑。
export default defineConfig({
  plugins: [uni()],
});
