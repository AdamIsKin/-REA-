import type { DB } from './db/connection'
import { SessionStore, type CoreContext } from './context'
import type { Clock } from './domain/clock'
import { createDispatcher, handler, type HandlerMap } from './rpc'
import { authHandlers } from './auth/handlers'
import { inventoryHandlers } from './inventory/handlers'
import { masterdataHandlers } from './masterdata/handlers'
import { backupHandlers, oplogHandlers } from './backup/handlers'
import { queryHandlers } from './query/handlers'
import { currentSchemaVersion } from './db/migrate'

export interface CreateCoreOptions {
  db: DB
  clock: Clock
  dataDir: string
  appVersion: string
}

/**
 * 组装业务进程：把各模块的处理器合并成完整的 HandlerMap 并生成分发函数。
 *
 * 与 index.ts（进程入口）分离：测试直接调用 createCore 拿到 dispatch，
 * 在内存库上走完整的“校验 → 鉴权 → 用例”链路，不需要启动 Electron 进程。
 */
export function createCore(opts: CreateCoreOptions) {
  const core: CoreContext = { ...opts, sessions: new SessionStore() }

  const handlers: HandlerMap = {
    'system:info': handler('system:info', 'user', (ctx) => ({
      appVersion: ctx.core.appVersion,
      schemaVersion: currentSchemaVersion(ctx.core.db),
      dataDir: ctx.core.dataDir,
      sqliteVersion: (ctx.core.db.prepare('SELECT sqlite_version() AS v').get() as { v: string }).v,
    })),
    ...authHandlers,
    ...masterdataHandlers,
    ...inventoryHandlers,
    ...queryHandlers,
    ...backupHandlers,
    ...oplogHandlers,
  }

  return { core, dispatch: createDispatcher(core, handlers) }
}
