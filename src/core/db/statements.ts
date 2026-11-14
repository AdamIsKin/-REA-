import type { Statement } from 'better-sqlite3'
import type { DB } from './connection'

/**
 * 预编译语句集合（设计文档 11.1：SQL 集中在各模块语句文件里，预编译后复用，禁止拼接字符串）。
 *
 * 用法：
 *   const sql = defineStatements({ byId: 'SELECT * FROM item WHERE id = ?' })
 *   sql(db).byId.get(1)
 *
 * - 懒编译：首次访问某条语句时才 prepare，没用到的语句不产生开销；
 * - 按连接缓存（WeakMap<DB, …>）：同一连接上同一语句只编译一次，连接回收后缓存自动释放；
 * - 返回的对象带每个键的类型，拼错语句名会在编译期报错。
 */
export function defineStatements<K extends string>(defs: Record<K, string>): (db: DB) => Record<K, Statement> {
  const cache = new WeakMap<DB, Partial<Record<K, Statement>>>()
  return (db: DB) => {
    let compiled = cache.get(db)
    if (!compiled) {
      compiled = {}
      cache.set(db, compiled)
    }
    const target = compiled
    return new Proxy(target as Record<K, Statement>, {
      get(t, key: string) {
        const k = key as K
        let s = t[k]
        if (!s) {
          const text = defs[k]
          if (text === undefined) throw new Error(`未定义的语句：${key}`)
          s = db.prepare(text)
          t[k] = s
        }
        return s
      },
    })
  }
}
