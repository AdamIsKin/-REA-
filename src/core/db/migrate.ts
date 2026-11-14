import type { DB } from './connection'

export interface Migration {
  version: number
  name: string
  sql: string
}

/**
 * 迁移文件在构建期由 Vite 以纯文本内联（`?raw`），所以打包后不需要额外拷贝 .sql 资源，
 * 测试构建同样走 Vite，行为与正式运行一致。
 * 文件名必须是 `NNN_name.sql`，NNN 即目标 schema 版本号。
 */
const files = import.meta.glob<string>('../migrations/*.sql', {
  query: '?raw',
  import: 'default',
  eager: true,
})

/** 解析并按版本号排序；版本号必须从 1 开始连续，缺号或重号说明迁移文件被误删或误命名，直接拒绝启动。 */
export function loadMigrations(): Migration[] {
  const list = Object.entries(files).map(([path, sql]) => {
    const m = /\/(\d{3})_([\w-]+)\.sql$/.exec(path)
    if (!m) throw new Error(`迁移文件名不合法：${path}`)
    return { version: Number(m[1]), name: m[2]!, sql }
  })
  list.sort((a, b) => a.version - b.version)
  list.forEach((mig, i) => {
    if (mig.version !== i + 1) throw new Error(`迁移版本不连续：期望 ${i + 1}，实际 ${mig.version}`)
  })
  return list
}

export const latestSchemaVersion = (): number => loadMigrations().length

export const currentSchemaVersion = (db: DB): number => db.pragma('user_version', { simple: true }) as number

/**
 * 依次执行版本号大于 `PRAGMA user_version` 的迁移。
 *
 * - 每个迁移单独一个事务，并在同一事务里更新 user_version：要么整份迁移生效且版本前进，要么都不生效；
 * - 数据库版本高于程序支持的版本（用旧程序打开新库）时拒绝启动，防止旧代码误写新结构；
 * - `beforeMigrate` 在真正有迁移要执行时才调用，用于迁移前自动备份（设计文档 11.4）。
 *
 * @returns 执行后的 schema 版本
 */
export function migrate(db: DB, beforeMigrate?: (fromVersion: number) => void): number {
  const migrations = loadMigrations()
  const from = currentSchemaVersion(db)
  const latest = migrations.length
  if (from > latest) {
    throw new Error(`数据库版本 ${from} 高于程序支持的版本 ${latest}，请升级程序`)
  }
  if (from === latest) return from

  beforeMigrate?.(from)
  for (const mig of migrations) {
    if (mig.version <= from) continue
    db.transaction(() => {
      db.exec(mig.sql)
      // user_version 不支持参数绑定；version 来自文件名解析出的整数，不存在注入风险。
      db.pragma(`user_version = ${mig.version}`)
    })()
  }
  // 外键是在事务内建立的，迁移结束后做一次完整性检查，尽早暴露迁移脚本本身的错误。
  const violations = db.pragma('foreign_key_check') as unknown[]
  if (violations.length > 0) throw new Error(`迁移后外键检查失败：${JSON.stringify(violations)}`)
  return latest
}
