/**
 * 业务进程入口（Electron utilityProcess）。
 *
 * 为什么不放在主进程：better-sqlite3 是同步调用，一次成本重算可能占用线程几十毫秒，
 * 放在主进程会卡住窗口事件和菜单（设计文档 4.3）。utilityProcess 是独立的 Node 进程，
 * 卡住它只影响业务请求排队，不影响界面响应。
 *
 * 启动参数：argv[2] = 数据目录（main 传入 app.getPath('userData')），argv[3] = 程序版本。
 */
import { join } from 'node:path'
import { mkdirSync } from 'node:fs'
import { openDatabase } from './db/connection'
import { migrate } from './db/migrate'
import { systemClock } from './domain/clock'
import { createCore } from './app'
import { initLog, log } from './log'
import type { CoreToMain, MainToCore } from './ipc-protocol'
import { backupBeforeMigrate, runShutdownTasks } from './backup/auto'

const port = process.parentPort
const send = (msg: CoreToMain): void => port.postMessage(msg)

function main(): void {
  const dataDir = process.argv[2]
  const appVersion = process.argv[3] ?? '0.0.0'
  if (!dataDir) throw new Error('缺少数据目录参数')
  mkdirSync(dataDir, { recursive: true })
  initLog(dataDir)

  const dbFile = join(dataDir, 'erp.db')
  const db = openDatabase(dbFile)
  const version = migrate(db, (from) => backupBeforeMigrate(db, dataDir, from))
  log('info', `业务进程启动 schema=${version} db=${dbFile}`)

  const { core, dispatch } = createCore({ db, clock: systemClock, dataDir, appVersion })

  port.on('message', (e) => {
    const msg = e.data as MainToCore
    switch (msg.kind) {
      case 'req':
        send({ kind: 'res', id: msg.id, result: dispatch(msg.senderId, msg.channel, msg.payload) })
        break
      case 'drop-session':
        core.sessions.drop(msg.senderId)
        break
      case 'shutdown':
        try {
          runShutdownTasks(core)
        } catch (err) {
          log('error', '退出前任务失败', err)
        }
        // 关闭前做一次 WAL 检查点，把 -wal 文件合并回主库，备份或拷贝单个 .db 文件即完整。
        try {
          db.pragma('wal_checkpoint(TRUNCATE)')
          db.close()
        } catch (err) {
          log('error', '关闭数据库失败', err)
        }
        send({ kind: 'shutdown-done' })
        break
    }
  })

  send({ kind: 'ready' })
}

try {
  main()
} catch (err) {
  log('error', '业务进程启动失败', err)
  send({ kind: 'fatal', message: err instanceof Error ? err.message : String(err) })
}
