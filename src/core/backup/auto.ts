import { existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import type { CoreContext } from '../context'
import type { DB } from '../db/connection'
import { log } from '../log'

/**
 * 自动备份（设计文档 11.4 / D27）。
 *
 * - 迁移前：有迁移要执行时先备份当前库，保留最近 5 份；
 * - 按月：每个自然月第一次正常退出时备份一次，默认保留最近 5 份（setting `backup.keepMonthly` 可改）。
 *
 * 备份用 `VACUUM INTO`：SQLite 在一个读事务里把整个库写成一个新的、紧凑的文件，
 * 结果是某一时刻的一致快照（不受 WAL 中未检查点数据影响），而直接复制 .db 文件在 WAL 模式下可能缺数据。
 */
const KEEP_PRE_MIGRATE = 5
const DEFAULT_KEEP_MONTHLY = 5

export const backupDir = (dataDir: string): string => join(dataDir, 'backups')

/** 文件名中的时间戳：本地时间、只含数字和横线，按字符串排序即按时间排序。 */
function stamp(d = new Date()): string {
  const p = (n: number) => n.toString().padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
}

/** 把当前库完整导出到 file；目标文件已存在时 VACUUM INTO 会失败，所以调用方须保证文件名唯一。 */
export function vacuumInto(db: DB, file: string): void {
  db.prepare('VACUUM INTO ?').run(file)
}

/** 只保留同一前缀下最新的 keep 份；文件名含时间戳，字典序即时间序，O(n log n) 排序后删除尾部。 */
export function prune(dir: string, prefix: string, keep: number): void {
  const files = readdirSync(dir)
    .filter((f) => f.startsWith(prefix) && f.endsWith('.db'))
    .sort()
  for (const f of files.slice(0, Math.max(0, files.length - keep))) rmSync(join(dir, f))
}

export function backupBeforeMigrate(db: DB, dataDir: string, fromVersion: number): void {
  // 版本 0 是全新的空库，没有需要保护的数据。
  if (fromVersion === 0) return
  const dir = backupDir(dataDir)
  mkdirSync(dir, { recursive: true })
  const file = join(dir, `pre-migrate-v${fromVersion}-${stamp()}.db`)
  vacuumInto(db, file)
  prune(dir, 'pre-migrate-', KEEP_PRE_MIGRATE)
  log('info', `迁移前备份完成 ${file}`)
}

/** 退出前任务：按月自动备份。 */
export function runShutdownTasks(core: CoreContext): void {
  const { db, dataDir, clock } = core
  const month = clock.today().slice(0, 7)
  const get = db.prepare('SELECT value FROM setting WHERE key = ?')
  const last = (get.get('backup.lastMonthly') as { value: string } | undefined)?.value
  if (last === month) return

  // 没有任何用户说明系统还没初始化，没有业务数据，不必备份。
  const hasUser = db.prepare('SELECT 1 FROM user LIMIT 1').get()
  if (!hasUser) return

  const keepRaw = (get.get('backup.keepMonthly') as { value: string } | undefined)?.value
  const keep = Math.max(1, Number.parseInt(keepRaw ?? '', 10) || DEFAULT_KEEP_MONTHLY)

  const dir = backupDir(dataDir)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  const file = join(dir, `monthly-${month}-${stamp()}.db`)
  vacuumInto(db, file)
  prune(dir, 'monthly-', keep)
  db.prepare(
    `INSERT INTO setting (key, value) VALUES ('backup.lastMonthly', ?)
     ON CONFLICT (key) DO UPDATE SET value = excluded.value`,
  ).run(month)
  log('info', `月度自动备份完成 ${file}`)
}
