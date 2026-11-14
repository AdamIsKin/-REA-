/**
 * 业务错误码（设计文档第 10 节）。
 *
 * 用 `as const` 对象而不是 TS enum：
 * - enum 会生成运行时代码且不能被 type-only 导入擦除，renderer 只需要类型和中文提示即可；
 * - 对象字面量 + `keyof typeof` 同样能得到穷尽的联合类型，switch 漏分支时编译器会报错。
 */
export const ErrorCode = {
  AUTH_REQUIRED: 'AUTH_REQUIRED',
  FORBIDDEN: 'FORBIDDEN',
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  NOT_FOUND: 'NOT_FOUND',
  CODE_DUPLICATE: 'CODE_DUPLICATE',
  DOC_STATE_INVALID: 'DOC_STATE_INVALID',
  DATE_IN_FUTURE: 'DATE_IN_FUTURE',
  STOCK_NEGATIVE: 'STOCK_NEGATIVE',
  SERIAL_COUNT_MISMATCH: 'SERIAL_COUNT_MISMATCH',
  SERIAL_DUPLICATE_IN_DOC: 'SERIAL_DUPLICATE_IN_DOC',
  SERIAL_NOT_AVAILABLE: 'SERIAL_NOT_AVAILABLE',
  SERIAL_CONFLICT: 'SERIAL_CONFLICT',
  RETURN_QTY_EXCEEDED: 'RETURN_QTY_EXCEEDED',
  RETURN_SERIAL_NOT_IN_ORIGINAL: 'RETURN_SERIAL_NOT_IN_ORIGINAL',
  DOC_REFERENCED: 'DOC_REFERENCED',
  ITEM_SERIAL_FLAG_LOCKED: 'ITEM_SERIAL_FLAG_LOCKED',
  INTERNAL: 'INTERNAL',
} as const

export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode]

/** 页面按错误码显示的默认中文提示；具体的商品、日期等信息放在 details 里由页面拼接。 */
export const ERROR_MESSAGES: Readonly<Record<ErrorCode, string>> = {
  AUTH_REQUIRED: '请先登录',
  FORBIDDEN: '没有权限执行此操作',
  VALIDATION_FAILED: '输入内容不正确',
  NOT_FOUND: '记录不存在',
  CODE_DUPLICATE: '编码或条码重复',
  DOC_STATE_INVALID: '单据当前状态不允许此操作',
  DATE_IN_FUTURE: '业务日期不能晚于今天',
  STOCK_NEGATIVE: '库存不足：某个时刻库存会变为负数',
  SERIAL_COUNT_MISMATCH: '串号个数与数量不一致',
  SERIAL_DUPLICATE_IN_DOC: '单据内串号重复',
  SERIAL_NOT_AVAILABLE: '串号当时不在该仓库',
  SERIAL_CONFLICT: '串号已在库，不能重复入库',
  RETURN_QTY_EXCEEDED: '退货数量超过可退数量',
  RETURN_SERIAL_NOT_IN_ORIGINAL: '退货串号不属于原单',
  DOC_REFERENCED: '单据已被退货单引用，请先反过账退货单',
  ITEM_SERIAL_FLAG_LOCKED: '商品已有库存流水，不能修改串号管理设置',
  INTERNAL: '程序内部错误',
}

/** 跨进程传输的错误结构；details 必须是可结构化克隆的纯数据。 */
export interface RpcError {
  code: ErrorCode
  message: string
  details?: Record<string, unknown>
}

/** 统一返回格式（设计文档 5.2）：判别联合，调用方用 `ok` 收窄类型。 */
export type RpcResult<T> = { ok: true; data: T } | { ok: false; error: RpcError }
