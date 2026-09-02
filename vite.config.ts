import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig, loadEnv} from 'vite';

export default defineConfig(({mode}) => {
  // 第三个参数传 '' 表示不要求 VITE_ 前缀 —— BASE_PATH 只在构建时用，
  // 不需要注入到客户端代码里，所以不加前缀。
  const env = loadEnv(mode, process.cwd(), '');

  return {
    // 产物里资源路径的前缀。
    //
    // 从 .env 读，而不是只认命令行的 BASE_PATH=xxx —— 后者每次构建都要记得传，
    // 忘了传的症状是白屏，而浏览器报的错（"MIME type ('text/html')"）跟真实
    // 原因完全不沾：资源请求落到了域名根目录，被别的服务用它的 index.html
    // 应答了。放进 .env 每台机器配一次就行，构建命令回归 npm run build。
    //
    //   部署在子域名根目录（推荐）：留空或 /
    //   部署在子路径：            BASE_PATH=/atoshi-staking/   ← 首尾都要有斜杠
    //
    // 命令行仍然可以临时覆盖：BASE_PATH=/xxx/ npm run build
    base: process.env.BASE_PATH || env.BASE_PATH || '/',

    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modifyâfile watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
