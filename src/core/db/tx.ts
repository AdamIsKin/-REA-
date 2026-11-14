import type { DB } from './connection'

/**
 * 事务封装（设计文档 11.1：一个业务用例对应一个事务，用例内部不能再开事务）。
 *
 * better-sqlite3 的 `db.transaction(fn)` 是同步的，整段过账在一个调用栈内完成，
 * 期间不会有其他请求插入执行（业务进程是单线程），因此不存在并发读写同一行的竞态。
 * 抛出任何异常都会整体回滚 —— 时间线检查、成本重算失败时“不留下任何数据”（测试场景 8）靠的就是这一点。
 *
 * 用 WeakSet 记录“正在事务中”的连接：嵌套调用说明有用例在内部又开了事务，
 * 属于编码错误，直接抛出，而不是像 better-sqlite3 默认那样悄悄降级为 SAVEPOINT，
 * 否则内层失败只回滚一半，会破坏“过账要么全成要么全不成”的保证。
 */
const active = new WeakSet<DB>()

export function inTransaction<T>(db: DB, fn: () => T): T {
  if (active.has(db)) throw new Error('禁止嵌套事务：用例内部不能再开事务')
  active.add(db)
  try {
    // immediate：开始时就拿写锁，避免先读后写时因锁升级失败而报 SQLITE_BUSY。
    return db.transaction(fn).immediate()
  } finally {
    active.delete(db)
  }
}

/** 断言当前在事务中；库存、成本等只能在事务内调用的底层函数在入口处调用它，防止被误用。 */
export function assertInTransaction(db: DB): void {
  if (!db.inTransaction) throw new Error('此操作必须在事务中执行')
}
