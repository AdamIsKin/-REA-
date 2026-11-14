import { globSync } from 'node:fs'
import { resolve } from 'node:path'
import { defineConfig } from 'vite'

/**
 * 核心单元测试的构建配置。
 *
 * 测试也走 Vite 构建，而不是用 ts 加载器直接跑源码：
 * core 依赖 `import.meta.glob('…?raw')` 内联迁移 SQL，只有 Vite 能处理，
 * 走同一套构建保证测试和正式运行加载的是同一份迁移脚本。
 * 产物由 Electron 自带的 Node 执行（ELECTRON_RUN_AS_NODE=1），与正式运行使用同一个 better-sqlite3 二进制。
 */
const entries = Object.fromEntries(
  globSync('tests/**/*.test.ts').map((f) => [
    f
      .replace(/\\/g, '/')
      .replace(/^tests\//, '')
      .replace(/\.ts$/, ''),
    resolve(__dirname, f),
  ]),
)

export default defineConfig({
  resolve: { alias: { '@shared': resolve(__dirname, 'src/shared') } },
  build: {
    ssr: true,
    outDir: 'out/tests',
    emptyOutDir: true,
    target: 'node24',
    minify: false,
    sourcemap: true,
    rolldownOptions: {
      input: entries,
      external: [/^node:/, 'better-sqlite3'],
      output: { format: 'es', entryFileNames: '[name].mjs', chunkFileNames: '_chunks/[name]-[hash].mjs' },
    },
  },
})
