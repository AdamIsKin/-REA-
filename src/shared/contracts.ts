/**
 * IPC 通道契约：通道名 → 入参 zod 结构 + 出参类型。
 *
 * 设计要点：
 * 1. “单一事实来源”：core 用这里的 schema 做运行时校验，renderer 用 `z.input<>` 推导调用参数类型，
 *    两端不会出现字段名或类型漂移。
 * 2. 入参中的“元”字符串在 schema 的 transform 里解析为分（设计文档 11.1：元只在业务进程中解析），
 *    所以 renderer 传 '12.50'，core 用例拿到的已是 Cents 1250。
 * 3. renderer 只 `import type`，zod 运行时不会进入页面包。
 * 4. 权限要求不放在这里，而放在 core 的处理器注册表（rpc.ts），因为权限是服务端的安全决策，
 *    页面隐藏按钮只是便利（设计文档 5.3）。
 */
import { z } from 'zod'
import { parseYuan, type Cents } from './money'
import type { AuthStatus, ItemRow, PartnerRow, SessionInfo, SystemInfo, UserRow, WarehouseRow } from './dto'

// ───────────────────────────── 通用片段 ─────────────────────────────

const id = z.number().int().positive()
const text = (max: number) => z.string().trim().max(max)
const requiredText = (max: number) => z.string().trim().min(1, '不能为空').max(max)
const code = requiredText(32).regex(/^[\w\-.]+$/, '编码只能包含字母、数字、下划线、横线和点')

/** “元”字符串 → 非负的分。 */
export const yuanNonNegative = z.string().transform((s, ctx): Cents => {
  const v = parseYuan(s)
  if (v === null || v < 0) {
    ctx.addIssue({ code: 'custom', message: '金额格式不正确（最多两位小数，不能为负）' })
    return z.NEVER
  }
  return v
})

const password = z.string().min(6, '密码至少 6 位').max(64)

// ───────────────────────────── 通道定义 ─────────────────────────────

export const schemas = {
  // —— 系统 ——
  'system:info': z.object({}),

  // —— 登录与会话 ——
  'auth:status': z.object({}),
  'auth:setupOwner': z.object({
    username: requiredText(32),
    displayName: text(32).default(''),
    password,
  }),
  'auth:login': z.object({ username: requiredText(32), password: z.string().min(1).max(64) }),
  'auth:logout': z.object({}),
  'auth:changePassword': z.object({ oldPassword: z.string().min(1).max(64), newPassword: password }),

  // —— 用户管理（老板） ——
  'user:list': z.object({}),
  'user:create': z.object({
    username: requiredText(32),
    displayName: text(32).default(''),
    role: z.enum(['owner', 'clerk']),
    password,
  }),
  'user:update': z.object({
    id,
    displayName: text(32),
    role: z.enum(['owner', 'clerk']),
    enabled: z.boolean(),
  }),
  'user:resetPassword': z.object({ id, password }),

  // —— 基础资料 ——
  'warehouse:list': z.object({ includeDisabled: z.boolean().default(false) }),
  'warehouse:save': z.object({
    id: id.optional(),
    code,
    name: requiredText(64),
    remark: text(255).default(''),
    enabled: z.boolean().default(true),
  }),

  'item:list': z.object({
    keyword: text(64).default(''),
    includeDisabled: z.boolean().default(false),
    page: z.number().int().min(1).default(1),
    pageSize: z.number().int().min(1).max(500).default(50),
  }),
  'item:get': z.object({ id }),
  /** 扫码枪录入：按条码或编码精确查找，用于单据录入时快速定位商品。 */
  'item:lookup': z.object({ code: requiredText(64) }),
  'item:save': z.object({
    id: id.optional(),
    code,
    name: requiredText(128),
    spec: text(128).default(''),
    unit: text(16).default('件'),
    barcode: text(64)
      .default('')
      .transform((s) => (s === '' ? null : s)),
    category: text(64).default(''),
    brand: text(64).default(''),
    serialManaged: z.boolean(),
    defaultBuyPrice: yuanNonNegative,
    defaultSellPrice: yuanNonNegative,
    remark: text(255).default(''),
    enabled: z.boolean().default(true),
  }),

  'partner:list': z.object({
    kind: z.enum(['supplier', 'customer']),
    keyword: text(64).default(''),
    includeDisabled: z.boolean().default(false),
  }),
  'partner:save': z.object({
    id: id.optional(),
    kind: z.enum(['supplier', 'customer']),
    code,
    name: requiredText(128),
    contact: text(32).default(''),
    phone: text(32).default(''),
    address: text(255).default(''),
    remark: text(255).default(''),
    enabled: z.boolean().default(true),
  }),

  // —— 设置（店名、打印抬头等） ——
  'setting:getAll': z.object({}),
  'setting:save': z.object({ values: z.record(z.string().max(64), z.string().max(1000)) }),
} as const

/** 各通道的返回类型；新增通道时必须在这里同时声明，否则 core 注册处理器会类型报错。 */
export interface Outputs {
  'system:info': SystemInfo
  'auth:status': AuthStatus
  'auth:setupOwner': SessionInfo
  'auth:login': SessionInfo
  'auth:logout': null
  'auth:changePassword': null
  'user:list': UserRow[]
  'user:create': UserRow
  'user:update': UserRow
  'user:resetPassword': null
  'warehouse:list': WarehouseRow[]
  'warehouse:save': WarehouseRow
  'item:list': { rows: ItemRow[]; total: number }
  'item:get': ItemRow
  'item:lookup': ItemRow | null
  'item:save': ItemRow
  'partner:list': PartnerRow[]
  'partner:save': PartnerRow
  'setting:getAll': Record<string, string>
  'setting:save': null
}

export type Channel = keyof typeof schemas
/** renderer 调用时传入的参数类型（transform 之前，例如金额是字符串）。 */
export type InputOf<C extends Channel> = z.input<(typeof schemas)[C]>
/** core 用例拿到的参数类型（transform 之后，例如金额已是 Cents）。 */
export type ParsedOf<C extends Channel> = z.output<(typeof schemas)[C]>
export type OutputOf<C extends Channel> = C extends keyof Outputs ? Outputs[C] : never

export const isChannel = (s: unknown): s is Channel =>
  typeof s === 'string' && Object.prototype.hasOwnProperty.call(schemas, s)
