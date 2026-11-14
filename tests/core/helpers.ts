import type { Channel, InputOf, OutputOf } from '@shared/contracts'
import type { ErrorCode, RpcResult } from '@shared/errors'
import { createCore } from '../../src/core/app'
import type { CoreContext } from '../../src/core/context'
import { openDatabase, type DB } from '../../src/core/db/connection'
import { migrate } from '../../src/core/db/migrate'
import { fixedClock, type Clock } from '../../src/core/domain/clock'

/** 测试中的两个“窗口”：老板和店员各占一个 senderId，会话互不影响。 */
export const OWNER = 1
export const CLERK = 2

/**
 * 每个测试一个独立的内存数据库（设计文档第 14 节），走完整的 dispatch 链路：
 * zod 校验 → 鉴权 → 用例 → 事务，测的就是页面实际调用的那条路径。
 */
export function setup(today = '2026-11-14'): TestEnv {
  const db = openDatabase(':memory:')
  migrate(db)
  const clock = fixedClock(today)
  const { core, dispatch } = createCore({ db, clock, dataDir: '', appVersion: 'test' })

  function call<C extends Channel>(sender: number, channel: C, input: InputOf<C>): OutputOf<C> {
    const r = dispatch(sender, channel, input)
    if (!r.ok) throw Object.assign(new Error(`${r.error.code}: ${r.error.message}`), { rpc: r.error })
    return r.data as OutputOf<C>
  }

  /** 期望失败并返回错误详情，便于断言错误码和 details。 */
  function fail<C extends Channel>(sender: number, channel: C, input: InputOf<C>) {
    const r = dispatch(sender, channel, input)
    if (r.ok) throw new Error(`期望 ${channel} 失败，实际成功`)
    return r.error as FailInfo
  }

  call(OWNER, 'auth:setupOwner', { username: 'boss', password: 'boss123' })
  call(OWNER, 'user:create', { username: 'clerk', role: 'clerk', password: 'clerk123' })
  call(CLERK, 'auth:login', { username: 'clerk', password: 'clerk123' })

  return { db, core, clock, dispatch, call, fail }
}

export interface FailInfo {
  code: ErrorCode
  message: string
  details?: Record<string, unknown>
}

export interface TestEnv {
  db: DB
  core: CoreContext
  clock: Clock
  dispatch: (sender: number, channel: unknown, payload: unknown) => RpcResult<unknown>
  call<C extends Channel>(sender: number, channel: C, input: InputOf<C>): OutputOf<C>
  fail<C extends Channel>(sender: number, channel: C, input: InputOf<C>): FailInfo
}

/** R23：生成 n 个唯一串号，供测试单据数量=串号个数。 */
export function sns(prefix: string, n: number): string[] {
  return Array.from({ length: n }, (_, i) => `${prefix}${i + 1}`)
}
