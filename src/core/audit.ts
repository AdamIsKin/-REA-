import type { DB } from './db/connection'
import { defineStatements } from './db/statements'

/**
 * 操作日志（R22：所有写操作记录操作日志；D26：店员维护基础资料须留痕，记录修改前后的值）。
 * 语句按连接预编译并缓存（见 defineStatements），高频写日志不重复解析 SQL。
 */
const sql = defineStatements({
  insert: 'INSERT INTO op_log (user_id, action, doc_id, detail, created_at) VALUES (?, ?, ?, ?, ?)',
})

export function writeOpLog(
  db: DB,
  userId: number | null,
  action: string,
  detail: Record<string, unknown> = {},
  docId: number | null = null,
  now: string = new Date().toISOString(),
): void {
  sql(db).insert.run(userId, action, docId, JSON.stringify(detail), now)
}

/**
 * 计算两份记录的差异，只记录真正变化的字段，日志更小也更容易阅读。
 * 返回 { 字段: [旧值, 新值] }；无变化返回空对象。
 */
export function diff<T extends object>(before: T, after: T): Record<string, [unknown, unknown]> {
  const out: Record<string, [unknown, unknown]> = {}
  for (const k of Object.keys(after) as (keyof T)[]) {
    if (before[k] !== after[k]) out[k as string] = [before[k], after[k]]
  }
  return out
}
