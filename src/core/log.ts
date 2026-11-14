import { appendFileSync, existsSync, mkdirSync, renameSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'

/**
 * 运行日志：写入数据目录 logs/core.log，按大小轮转（设计文档 11.3）。
 *
 * 用同步追加写：业务进程本身就是同步模型（better-sqlite3），日志量很小（只记错误和关键事件），
 * 同步写保证进程崩溃前最后一条错误一定落盘，这比异步写省下的几微秒更重要。
 * 轮转策略：超过 MAX_BYTES 时 core.log → core.1.log → … → core.{KEEP}.log，最旧的删除，
 * 总占用有上界 (KEEP + 1) × MAX_BYTES。
 */
const MAX_BYTES = 1024 * 1024
const KEEP = 3

let logDir: string | null = null

export function initLog(dir: string): void {
  logDir = join(dir, 'logs')
  if (!existsSync(logDir)) mkdirSync(logDir, { recursive: true })
}

function rotate(file: string): void {
  if (!existsSync(file) || statSync(file).size < MAX_BYTES) return
  const dir = logDir!
  const oldest = join(dir, `core.${KEEP}.log`)
  if (existsSync(oldest)) rmSync(oldest)
  for (let i = KEEP - 1; i >= 1; i--) {
    const src = join(dir, `core.${i}.log`)
    if (existsSync(src)) renameSync(src, join(dir, `core.${i + 1}.log`))
  }
  renameSync(file, join(dir, 'core.1.log'))
}

export function log(level: 'info' | 'warn' | 'error', message: string, extra?: unknown): void {
  const line = `${new Date().toISOString()} [${level}] ${message}${
    extra === undefined ? '' : ' ' + (extra instanceof Error ? (extra.stack ?? extra.message) : JSON.stringify(extra))
  }\n`
  if (!logDir) {
    // 测试或日志未初始化时退化为标准错误输出。
    process.stderr.write(line)
    return
  }
  try {
    const file = join(logDir, 'core.log')
    rotate(file)
    appendFileSync(file, line)
  } catch {
    process.stderr.write(line)
  }
}
