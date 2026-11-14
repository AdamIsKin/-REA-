import { randomUUID } from 'node:crypto'
import { ZodError } from 'zod'
import { isChannel, schemas, type Channel, type OutputOf, type ParsedOf } from '@shared/contracts'
import { ERROR_MESSAGES, type RpcResult } from '@shared/errors'
import type { AuthedContext, CoreContext, RequestContext } from './context'
import { BizError } from './domain/errors'
import { log } from './log'

/**
 * 访问级别：
 * - public：无需登录（登录、首次创建老板、查询登录状态）；
 * - user：任何已登录用户；
 * - owner：仅老板（R21）。
 */
export type Access = 'public' | 'user' | 'owner'

type Ctx<A extends Access> = A extends 'public' ? RequestContext : AuthedContext

export interface Handler<C extends Channel, A extends Access = Access> {
  access: A
  run(ctx: Ctx<A>, input: ParsedOf<C>): OutputOf<C>
}

/** 每个通道必须且只能有一个处理器；漏注册任何通道都会在类型检查阶段报错。 */
export type HandlerMap = { [C in Channel]: Handler<C> }

/** 定义处理器的辅助函数：让 TS 根据 access 推导 ctx 的类型（owner/user 下 session 非空）。 */
export function handler<C extends Channel, A extends Access>(
  _channel: C,
  access: A,
  run: (ctx: Ctx<A>, input: ParsedOf<C>) => OutputOf<C>,
): Handler<C, A> {
  return { access, run }
}

/** 把 zod 的问题列表压平成“字段路径 → 中文原因”，页面可以直接标红对应输入框。 */
function zodDetails(err: ZodError): Record<string, unknown> {
  return {
    fields: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
  }
}

/**
 * 请求分发入口（设计文档 5.2 第 4 步）：zod 校验 → 检查登录和权限 → 调用用例 → 生成统一返回。
 *
 * 校验放在鉴权之前还是之后？这里先鉴权后校验：未登录的请求不应得到任何关于参数结构的反馈，
 * 也避免为无权限请求做无用的解析工作。
 */
export function createDispatcher(core: CoreContext, handlers: HandlerMap) {
  return function dispatch(senderId: number, channel: unknown, payload: unknown): RpcResult<unknown> {
    try {
      if (!isChannel(channel)) {
        return fail('VALIDATION_FAILED', { channel: String(channel) }, '未知的请求通道')
      }
      const h = handlers[channel] as Handler<Channel>
      const session = core.sessions.get(senderId)

      if (h.access !== 'public') {
        if (!session) return fail('AUTH_REQUIRED')
        if (h.access === 'owner' && session.role !== 'owner') {
          return fail('FORBIDDEN', { required: 'owner' })
        }
      }

      const parsed = schemas[channel].safeParse(payload ?? {})
      if (!parsed.success) return fail('VALIDATION_FAILED', zodDetails(parsed.error))

      const ctx: RequestContext = { core, senderId, session }
      // 类型安全由 handler() 和 HandlerMap 在定义处保证；这里是唯一的动态分派点。
      const data = (h.run as (c: RequestContext, i: unknown) => unknown)(ctx, parsed.data)
      return { ok: true, data: data ?? null }
    } catch (err) {
      if (err instanceof BizError) {
        return {
          ok: false,
          error: { code: err.code, message: err.message, ...(err.details && { details: err.details }) },
        }
      }
      if (err instanceof ZodError) return fail('VALIDATION_FAILED', zodDetails(err))
      // 非预期错误：记录完整堆栈，只把日志编号返回页面，不泄露内部细节。
      const logId = randomUUID().slice(0, 8)
      log('error', `请求失败 channel=${String(channel)} logId=${logId}`, err)
      return fail('INTERNAL', { logId })
    }
  }
}

function fail(
  code: keyof typeof ERROR_MESSAGES,
  details?: Record<string, unknown>,
  message?: string,
): RpcResult<never> {
  return { ok: false, error: { code, message: message ?? ERROR_MESSAGES[code], ...(details && { details }) } }
}
