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
import type {
  AuthStatus,
  BrandRow,
  CategoryRow,
  DocDetail,
  DocSummary,
  ItemRow,
  Paged,
  PartnerRow,
  ProfitReport,
  PurchaseDetailRow,
  PurchaseStatRow,
  Returnable,
  SerialTrace,
  SessionInfo,
  StockMoveRow,
  StockRow,
  SystemInfo,
  UserOption,
  UserRow,
  WarehouseRow,
} from './dto'

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

const docType = z.enum(['PURCHASE', 'SALE', 'TRANSFER', 'PURCHASE_RETURN', 'SALE_RETURN'])
const isoDate = z.iso.date('日期格式应为 YYYY-MM-DD')
/** 串号（IMEI 等）：去掉首尾空白；扫码枪可能带入的内部空格也视为非法输入。 */
const serial = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^\S+$/, '串号不能包含空格')

/**
 * 单据明细输入。
 * - unitPrice 用 prefault：缺省时按输入值 '0' 走一遍 transform（zod 4 的 default 会跳过 transform）；
 * - 退货行的单价由业务进程取原单单价（D25），移库为 0，页面传什么都会被覆盖。
 */
const docLineInput = z.object({
  itemId: id,
  qty: z.number().int().positive('数量必须大于 0').max(1_000_000),
  unitPrice: yuanNonNegative.prefault('0'),
  /** R26：返利预留；缺省 0。 */
  rebatePerUnit: yuanNonNegative.prefault('0'),
  rebateAmount: yuanNonNegative.prefault('0'),
  refLineId: id.optional(),
  serials: z.array(serial).max(10_000).default([]),
  remark: text(255).default(''),
})

const docInput = z.object({
  docType,
  bizDate: isoDate,
  warehouseId: id,
  toWarehouseId: id.optional(),
  partnerId: id.optional(),
  refDocId: id.optional(),
  /** R24：指定录入人；缺省则用当前登录用户。 */
  createdByUserId: id.optional(),
  remark: text(255).default(''),
  lines: z.array(docLineInput).min(1, '至少要有一行明细').max(1000),
})

export type DocInputParsed = z.output<typeof docInput>

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
  /** 录入人下拉（R24）：任意登录用户可读，仅返回启用账号的简要信息。 */
  'user:options': z.object({}),

  // —— 基础资料 ——
  'warehouse:list': z.object({ includeDisabled: z.boolean().default(false) }),
  'warehouse:save': z.object({
    id: id.optional(),
    code,
    name: requiredText(64),
    remark: text(255).default(''),
    enabled: z.boolean().default(true),
  }),

  'category:list': z.object({ includeDisabled: z.boolean().default(false) }),
  'category:save': z.object({
    id: id.optional(),
    code,
    name: requiredText(64),
    enabled: z.boolean().default(true),
  }),
  'brand:list': z.object({ includeDisabled: z.boolean().default(false) }),
  'brand:save': z.object({
    id: id.optional(),
    code,
    name: requiredText(64),
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
    name: requiredText(128),
    categoryId: id.nullable().optional(),
    brandId: id.nullable().optional(),
    series: text(64).default(''),
    memory1: text(64).default(''),
    memory2: text(64).default(''),
    version: text(64).default(''),
    model: text(64).default(''),
    color: text(64).default(''),
    supplierId: id.nullable().optional(),
    serialType: z.enum(['none', 'single', 'dual']).default('single'),
    stockMin: z.number().int().min(0).default(0),
    stockMax: z.number().int().min(0).default(0),
    isConsignment: z.boolean().default(false),
    isQuotable: z.boolean().default(true),
    createdByUserId: id.optional(),
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

  // —— 单据 ——
  'doc:list': z.object({
    docType: docType.optional(),
    status: z.enum(['draft', 'posted']).optional(),
    dateFrom: isoDate.optional(),
    dateTo: isoDate.optional(),
    partnerId: id.optional(),
    warehouseId: id.optional(),
    /** 按单号、备注模糊查找。 */
    keyword: text(64).default(''),
    page: z.number().int().min(1).default(1),
    pageSize: z.number().int().min(1).max(500).default(50),
  }),
  'doc:get': z.object({ id }),
  /** 保存即过账（R2）。 */
  'doc:create': docInput,
  /** 修改：已过账单据在同一事务内反过账 → 替换 → 重新过账（R3，仅老板）；草稿直接替换后过账。 */
  'doc:update': docInput.extend({ id }),
  'doc:unpost': z.object({ id }),
  'doc:post': z.object({ id }),
  'doc:returnable': z.object({ refDocId: id }),
  /** 退货录入时扫串号自动找原单（R14）：在已过账的采购 / 销售单中找最近一次包含该串号的行。 */
  'doc:findBySerial': z.object({ serial, docType: z.enum(['PURCHASE', 'SALE']) }),

  /** 采购入库明细台账（R25）：按串号一行。 */
  'purchase:detailList': z.object({
    keyword: text(64).default(''),
    dateFrom: isoDate.optional(),
    dateTo: isoDate.optional(),
    partnerId: id.optional(),
    warehouseId: id.optional(),
    page: z.number().int().min(1).default(1),
    pageSize: z.number().int().min(1).max(500).default(50),
  }),
  /** 仅更新返利预留字段，不重过账（R26）。 */
  'purchase:updateRebate': z.object({
    lineId: id,
    rebatePerUnit: yuanNonNegative,
    rebateAmount: yuanNonNegative,
  }),
  /** 采购统计（R27）：按商品 + 单价汇总，筛选与明细一致。 */
  'purchase:statList': z.object({
    keyword: text(64).default(''),
    dateFrom: isoDate.optional(),
    dateTo: isoDate.optional(),
    partnerId: id.optional(),
    warehouseId: id.optional(),
  }),

  // —— 查询与报表 ——
  'stock:list': z.object({
    warehouseId: id.optional(),
    keyword: text(64).default(''),
    onlyPositive: z.boolean().default(true),
  }),
  'stock:moves': z.object({
    warehouseId: id.optional(),
    itemId: id.optional(),
    dateFrom: isoDate.optional(),
    dateTo: isoDate.optional(),
    page: z.number().int().min(1).default(1),
    pageSize: z.number().int().min(1).max(500).default(100),
  }),
  'serial:trace': z.object({ serial: requiredText(64) }),
  'report:profit': z.object({
    dateFrom: isoDate,
    dateTo: isoDate,
    dimension: z.enum(['day', 'item']).default('day'),
  }),
  // —— 备份 ——
  /** filePath 可选：有则 VACUUM INTO 该路径（另存）；无则写入 dataDir/backups。 */
  'backup:create': z.object({ filePath: text(500).optional() }),
  'backup:list': z.object({}),
  'backup:restore': z.object({ filePath: requiredText(500) }),

  // —— 操作日志 ——
  'oplog:list': z.object({
    page: z.number().int().min(1).default(1),
    pageSize: z.number().int().min(1).max(200).default(50),
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
  'user:options': UserOption[]
  'warehouse:list': WarehouseRow[]
  'warehouse:save': WarehouseRow
  'category:list': CategoryRow[]
  'category:save': CategoryRow
  'brand:list': BrandRow[]
  'brand:save': BrandRow
  'item:list': { rows: ItemRow[]; total: number }
  'item:get': ItemRow
  'item:lookup': ItemRow | null
  'item:save': ItemRow
  'partner:list': PartnerRow[]
  'partner:save': PartnerRow
  'doc:list': Paged<DocSummary>
  'doc:get': DocDetail
  'doc:create': DocDetail
  'doc:update': DocDetail
  'doc:unpost': DocDetail
  'doc:post': DocDetail
  'doc:returnable': Returnable
  'doc:findBySerial': { docId: number; docNo: string; lineId: number } | null
  'purchase:detailList': Paged<PurchaseDetailRow>
  'purchase:updateRebate': null
  'purchase:statList': PurchaseStatRow[]
  'stock:list': StockRow[]
  'stock:moves': Paged<StockMoveRow>
  'serial:trace': SerialTrace
  'report:profit': ProfitReport
  'backup:create': { filePath: string }
  'backup:list': { name: string; path: string; size: number; mtime: string }[]
  'backup:restore': { ok: true }
  'oplog:list': Paged<{
    id: number
    userName: string
    action: string
    detail: string
    createdAt: string
    docId: number | null
  }>
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
