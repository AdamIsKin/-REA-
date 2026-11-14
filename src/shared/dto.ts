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
