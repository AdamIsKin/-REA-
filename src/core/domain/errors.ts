import { ERROR_MESSAGES, type ErrorCode } from '@shared/errors'

/**
 * 业务错误：用例中任何违反业务规则的情况都抛它。
 *
 * 用异常而不是返回值传播业务错误：过账是一长串步骤（校验 → 写流水 → 时间线检查 → 成本重算），
 * 任一步失败都必须让 `db.transaction` 感知到并整体回滚，抛异常是最直接、不会被漏处理的方式。
 * rpc 层统一捕获并转换成 `{ ok: false, error }`。
 */
export class BizError extends Error {
  readonly code: ErrorCode
  readonly details: Record<string, unknown> | undefined

  constructor(code: ErrorCode, details?: Record<string, unknown>, message?: string) {
    super(message ?? ERROR_MESSAGES[code])
    this.name = 'BizError'
    this.code = code
    this.details = details
  }
}

/** 断言工具：条件不成立时抛出指定业务错误，让用例代码读起来像规则清单。 */
export function ensure(
  cond: unknown,
  code: ErrorCode,
  details?: Record<string, unknown>,
  message?: string,
): asserts cond {
  if (!cond) throw new BizError(code, details, message)
}
