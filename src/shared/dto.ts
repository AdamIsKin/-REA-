/**
 * 跨进程返回的数据结构（DTO）。
 *
 * 只放纯类型，renderer 用 `import type` 引用，打包时完全擦除。
 * 字段名使用 camelCase；core 在查询层把 snake_case 列映射过来，页面不感知数据库命名。
 * 带 `?` 的成本类字段：店员会话下 core 根本不返回（R21），而不是返回 0，避免“0 成本”被误读。
 */
import type { Cents, Qty } from './money'

export type Role = 'owner' | 'clerk'

export interface SessionInfo {
  userId: number
  username: string
  displayName: string
  role: Role
}

export interface AuthStatus {
  /** 首次启动没有任何用户，页面应进入“创建老板账号”引导（设计文档第 9 节）。 */
  needsSetup: boolean
  session: SessionInfo | null
}

export interface SystemInfo {
  appVersion: string
  schemaVersion: number
  dataDir: string
  sqliteVersion: string
}

export interface UserRow {
  id: number
  username: string
  displayName: string
  role: Role
  enabled: boolean
  createdAt: string
}

export interface WarehouseRow {
  id: number
  code: string
  name: string
  remark: string
  enabled: boolean
}

export interface ItemRow {
  id: number
  code: string
  name: string
  spec: string
  unit: string
  barcode: string | null
  category: string
  brand: string
  serialManaged: boolean
  /** 一旦有库存流水，串号管理标志就锁定（ITEM_SERIAL_FLAG_LOCKED）；页面据此禁用开关。 */
  serialFlagLocked: boolean
  defaultBuyPrice: Cents
  defaultSellPrice: Cents
  remark: string
  enabled: boolean
}

export type PartnerKind = 'supplier' | 'customer'

export interface PartnerRow {
  id: number
  kind: PartnerKind
  code: string
  name: string
  contact: string
  phone: string
  address: string
  remark: string
  enabled: boolean
}

export interface Paged<T> {
  rows: T[]
  total: number
}

export type QtyValue = Qty

// ═════════════════════════════ 单据 ═════════════════════════════

export type DocType = 'PURCHASE' | 'SALE' | 'TRANSFER' | 'PURCHASE_RETURN' | 'SALE_RETURN'
export type DocStatus = 'draft' | 'posted'

export const DOC_TYPE_LABEL: Readonly<Record<DocType, string>> = {
  PURCHASE: '采购入库',
  SALE: '销售出库',
  TRANSFER: '移库',
  PURCHASE_RETURN: '采购退货',
  SALE_RETURN: '销售退货',
}

export interface DocLineDto {
  id: number
  lineNo: number
  itemId: number
  itemCode: string
  itemName: string
  itemSpec: string
  unit: string
  serialManaged: boolean
  qty: number
  unitPrice: Cents
  amount: Cents
  refLineId: number | null
  /** 仅老板会话返回（R21）。 */
  costAmount?: Cents
  remark: string
  serials: string[]
}

export interface DocSummary {
  id: number
  docNo: string
  docType: DocType
  bizDate: string
  status: DocStatus
  warehouseId: number
  warehouseName: string
  toWarehouseId: number | null
  toWarehouseName: string | null
  partnerId: number | null
  partnerName: string | null
  refDocId: number | null
  refDocNo: string | null
  remark: string
  totalQty: number
  totalAmount: Cents
  /** 仅老板会话返回。 */
  totalCost?: Cents
  createdByName: string
  createdAt: string
  postedAt: string | null
}

export interface DocDetail extends DocSummary {
  lines: DocLineDto[]
}

/** 退货录入用：原单每一行的可退情况。 */
export interface ReturnableLine {
  refLineId: number
  lineNo: number
  itemId: number
  itemCode: string
  itemName: string
  itemSpec: string
  unit: string
  serialManaged: boolean
  qty: number
  returnedQty: number
  availableQty: number
  unitPrice: Cents
  /** 原单行中尚未被已过账退货单退掉的串号。 */
  availableSerials: string[]
}

export interface Returnable {
  refDoc: DocSummary
  lines: ReturnableLine[]
}

// ═════════════════════════════ 查询与报表（M5） ═════════════════════════════

export interface StockRow {
  warehouseId: number
  warehouseName: string
  itemId: number
  itemCode: string
  itemName: string
  itemSpec: string
  unit: string
  serialManaged: boolean
  qty: number
  /** 仅老板：该商品全部仓库合计的批次剩余金额（R10/U9，不分仓库）。 */
  amount?: Cents
}

export interface StockMoveRow {
  id: number
  bizDate: string
  docId: number
  docNo: string
  docType: DocType
  warehouseId: number
  warehouseName: string
  itemId: number
  itemCode: string
  itemName: string
  qty: number
}

export interface SerialTraceEvent {
  bizDate: string
  docId: number
  docNo: string
  docType: DocType
  warehouseId: number
  warehouseName: string
  delta: number
  running: number
}

export interface SerialTrace {
  serial: string
  itemId: number | null
  itemCode: string | null
  itemName: string | null
  /** 当前所在仓库；不在库则为 null。 */
  currentWarehouseId: number | null
  currentWarehouseName: string | null
  events: SerialTraceEvent[]
}

export interface ProfitRow {
  key: string
  label: string
  salesAmount: Cents
  salesCost: Cents
  salesProfit: Cents
  purchaseReturnVariance: Cents
}

export interface ProfitReport {
  dateFrom: string
  dateTo: string
  dimension: 'day' | 'item'
  rows: ProfitRow[]
  totals: Omit<ProfitRow, 'key' | 'label'>
}
