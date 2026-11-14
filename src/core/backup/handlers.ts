import { copyFileSync, existsSync, mkdirSync, readdirSync, renameSync, statSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { writeOpLog } from '../audit'
import { openDatabase } from '../db/connection'
import { latestSchemaVersion } from '../db/migrate'
import { ensure } from '../domain/errors'
import { handler } from '../rpc'
import { backupDir, vacuumInto } from './auto'

function stamp(): string {
  const d = new Date()
  const p = (n: number) => n.toString().padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
}

export const backupHandlers = {
  /**
   * 手动备份（设计文档 11.4）。
   * - 未指定路径：写入 dataDir/backups，便于列表与恢复；
   * - 指定路径：直接 VACUUM INTO 用户选择的位置（“备份到…”）。
   */
  'backup:create': handler('backup:create', 'owner', (ctx, input) => {
    const dir = backupDir(ctx.core.dataDir)
    mkdirSync(dir, { recursive: true })
    const file = input.filePath?.trim() || join(dir, `manual-${stamp()}.db`)
    vacuumInto(ctx.core.db, file)
    writeOpLog(ctx.core.db, ctx.session.userId, 'backup.create', { file }, null, ctx.core.clock.now())
    return { filePath: file }
  }),

  'backup:list': handler('backup:list', 'owner', (ctx) => {
    const dir = backupDir(ctx.core.dataDir)
    if (!existsSync(dir)) return []
    return readdirSync(dir)
      .filter((f) => f.endsWith('.db'))
      .map((name) => {
        const path = join(dir, name)
        const st = statSync(path)
        return { name, path, size: st.size, mtime: st.mtime.toISOString() }
      })
      .sort((a, b) => (a.mtime < b.mtime ? 1 : -1))
  }),

  /**
   * 恢复：完整性检查 → 版本不高于当前 → 先备份当前库 → 替换文件。
   * 调用方必须随后 relaunch：本 handler 会关闭当前连接，进程内已无法继续访问库。
   */
  'backup:restore': handler('backup:restore', 'owner', (ctx, input) => {
    ensure(existsSync(input.filePath), 'NOT_FOUND', { type: 'backup', path: input.filePath })
    const probe = openDatabase(input.filePath)
    try {
      const check = probe.pragma('integrity_check', { simple: true }) as string
      ensure(check === 'ok', 'VALIDATION_FAILED', { check }, '备份文件校验失败')
      const ver = probe.pragma('user_version', { simple: true }) as number
      ensure(ver <= latestSchemaVersion(), 'VALIDATION_FAILED', { ver }, '备份版本高于当前程序，请先升级程序')
    } finally {
      probe.close()
    }

    const live = join(ctx.core.dataDir, 'erp.db')
    const dir = backupDir(ctx.core.dataDir)
    mkdirSync(dir, { recursive: true })
    vacuumInto(ctx.core.db, join(dir, `pre-restore-${stamp()}.db`))
    writeOpLog(
      ctx.core.db,
      ctx.session.userId,
      'backup.restore',
      { from: input.filePath },
      null,
      ctx.core.clock.now(),
    )

    ctx.core.db.close()
    for (const f of [live + '-wal', live + '-shm']) if (existsSync(f)) unlinkSync(f)
    const tmp = live + '.restoring'
    if (existsSync(tmp)) unlinkSync(tmp)
    copyFileSync(input.filePath, tmp)
    if (existsSync(live)) unlinkSync(live)
    renameSync(tmp, live)
    return { ok: true as const }
  }),
}

export const oplogHandlers = {
  'oplog:list': handler('oplog:list', 'owner', (ctx, input) => {
    const db = ctx.core.db
    const rows = db
      .prepare(
        `SELECT o.id, COALESCE(u.display_name, u.username, '') AS userName, o.action, o.detail,
                o.created_at AS createdAt, o.doc_id AS docId
         FROM op_log o
         LEFT JOIN user u ON u.id = o.user_id
         ORDER BY o.id DESC
         LIMIT ? OFFSET ?`,
      )
      .all(input.pageSize, (input.page - 1) * input.pageSize) as {
      id: number
      userName: string
      action: string
      detail: string
      createdAt: string
      docId: number | null
    }[]
    const total = (db.prepare('SELECT COUNT(*) AS n FROM op_log').get() as { n: number }).n
    return { rows, total }
  }),
}
