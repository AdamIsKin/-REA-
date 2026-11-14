import type { SessionInfo } from '@shared/dto'
import type { DB } from './db/connection'
import type { Clock } from './domain/clock'

/**
 * 登录会话：只存在业务进程内存中，程序关闭即失效（设计文档第 9 节）。
 *
 * 以窗口（webContents id）为键：页面拿不到也伪造不了身份，
 * main 进程转发请求时附带的 senderId 来自 Electron 的 IPC 事件，页面无法篡改。
 */
export class SessionStore {
  private readonly bySender = new Map<number, SessionInfo>()

  get(senderId: number): SessionInfo | null {
    return this.bySender.get(senderId) ?? null
  }

  set(senderId: number, session: SessionInfo): void {
    this.bySender.set(senderId, session)
  }

  drop(senderId: number): void {
    this.bySender.delete(senderId)
  }

  /** 用户被停用、角色被修改后，立即让该用户的所有会话失效，避免继续持有旧权限。 */
  dropUser(userId: number): void {
    for (const [sender, s] of this.bySender) if (s.userId === userId) this.bySender.delete(sender)
  }
}

/** 业务进程级依赖，整个进程生命周期内只有一份。 */
export interface CoreContext {
  db: DB
  clock: Clock
  sessions: SessionStore
  dataDir: string
  appVersion: string
}

/** 单次请求的上下文。 */
export interface RequestContext {
  core: CoreContext
  senderId: number
  session: SessionInfo | null
}

/** 经过鉴权的请求上下文：handler 声明 access 为 user / owner 时，session 一定非空。 */
export interface AuthedContext extends RequestContext {
  session: SessionInfo
}
