import Database from 'better-sqlite3'

export type DB = Database.Database

/**
 * 打开数据库并设置连接级参数（设计文档 6.1）。
 *
 * - foreign_keys = ON：SQLite 默认关闭外键检查，必须每个连接显式打开；
 * - journal_mode = WAL：读写互不阻塞，崩溃恢复更可靠，单写者场景下写入性能也更好；
 * - synchronous = NORMAL：WAL 模式下的推荐值，断电最多丢最后一个事务，但不会损坏库，
 *   比 FULL 少一次 fsync，过账响应更快；
 * - busy_timeout = 5000：备份（VACUUM INTO）等操作短暂持锁时，写请求等待而不是立即报 SQLITE_BUSY；
 * - temp_store = MEMORY：窗口函数、排序产生的临时数据放内存，单店数据量下更快。
 *
 * @param file 数据库文件路径；测试传 ':memory:' 得到独立的内存库
 */
export function openDatabase(file: string): DB {
  const db = new Database(file)
  db.pragma('foreign_keys = ON')
  if (file !== ':memory:') db.pragma('journal_mode = WAL')
  db.pragma('synchronous = NORMAL')
  db.pragma('busy_timeout = 5000')
  db.pragma('temp_store = MEMORY')
  return db
}
