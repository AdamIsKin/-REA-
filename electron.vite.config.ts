import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import vue from '@vitejs/plugin-vue'

// 三方共用的别名：shared 只放纯 TS（无 Node / DOM 依赖），所以 main、core、renderer 都可以安全引用。
const alias = { '@shared': resolve(__dirname, 'src/shared') }

export default defineConfig({
  main: {
    resolve: { alias },
    build: {
      // main 构建同时打出业务进程（core）入口：两者都是 Node 环境，共用一套外置依赖规则，
      // better-sqlite3 这类原生模块保持 external，由 electron-builder 按 Electron ABI 重编。
      rolldownOptions: {
        input: {
          index: resolve(__dirname, 'src/main/index.ts'),
          core: resolve(__dirname, 'src/core/index.ts'),
        },
      },
    },
  },
  preload: {
    resolve: { alias },
  },
  renderer: {
    resolve: {
      alias: { ...alias, '@renderer': resolve(__dirname, 'src/renderer/src') },
    },
    plugins: [vue()],
  },
})
