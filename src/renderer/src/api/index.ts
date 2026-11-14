import type { Channel, InputOf, OutputOf } from '@shared/contracts'
import { ERROR_MESSAGES, type RpcError } from '@shared/errors'

/**
 * 页面访问业务进程的唯一入口（设计文档 11.2：页面只调用 api/ 中的封装，不直接调用 window.api）。
 *
 * - 类型由 shared/contracts 推导：传错参数、读错返回字段都在编译期报错；
 * - 失败统一抛 ApiError，页面用 try/catch 或全局提示处理，不用到处判断 ok。
 */
export class ApiError extends Error {
  readonly code: RpcError['code']
  readonly details: Record<string, unknown> | undefined

  constructor(err: RpcError) {
    super(err.message || ERROR_MESSAGES[err.code])
    this.name = 'ApiError'
    this.code = err.code
    this.details = err.details
  }
}

export async function call<C extends Channel>(channel: C, input: InputOf<C>): Promise<OutputOf<C>> {
  const r = await window.api.invoke(channel, input)
  if (!r.ok) throw new ApiError(r.error)
  return r.data as OutputOf<C>
}

export const shellApi = (): Window['api']['shell'] => window.api.shell
