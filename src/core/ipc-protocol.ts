import type { RpcResult } from '@shared/errors'

/**
 * main ↔ core（utilityProcess）之间的消息协议。
 *
 * 用判别联合（kind 字段）区分消息类型，双方 switch 时编译器检查是否穷尽。
 * 所有字段都是可结构化克隆的纯数据。
 */
export type MainToCore =
  | { kind: 'req'; id: number; senderId: number; channel: string; payload: unknown }
  /** 窗口关闭：丢弃该窗口的登录会话。 */
  | { kind: 'drop-session'; senderId: number }
  /** 程序正常退出前：执行按月自动备份等收尾工作，然后回 'shutdown-done'。 */
  | { kind: 'shutdown' }

export type CoreToMain =
  | { kind: 'ready' }
  | { kind: 'res'; id: number; result: RpcResult<unknown> }
  | { kind: 'fatal'; message: string }
  | { kind: 'shutdown-done' }
