import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';

export default defineConfig(() => {
  return {
    // 产物里资源路径的前缀。
    //
    // 默认 '/'：部署在独立域名/子域名的根目录（推荐）。
    // 挂在子路径下时必须在构建时指定，例如
    //   BASE_PATH=/staking/ npm run build
    // 不指定的话产物里是绝对路径 /assets/xxx.js，浏览器会去域名根目录找，
    // 拿到的是别的服务的 404。
    // 注意首尾都要有斜杠。
    base: process.env.BASE_PATH || '/',

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
