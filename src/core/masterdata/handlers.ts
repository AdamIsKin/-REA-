import type { ItemRow, PartnerRow, WarehouseRow } from '@shared/dto'
import { cents } from '@shared/money'
import { diff, writeOpLog } from '../audit'
import type { DB } from '../db/connection'
import { defineStatements } from '../db/statements'
import { inTransaction } from '../db/tx'
import { ensure } from '../domain/errors'
import { handler } from '../rpc'

// ═════════════════════════════ SQL ═════════════════════════════

/**
 * 商品查询附带 serial_flag_locked：用 EXISTS 子查询而不是 JOIN + GROUP BY，
 * 命中 ix_stock_move_item_key 的第一条即停止，与流水条数无关，O(log n)。
 */
const ITEM_COLS = `
  i.*, EXISTS (SELECT 1 FROM stock_move m WHERE m.item_id = i.id) AS serial_flag_locked`

const sql = defineStatements({
  // —— 仓库 ——
  whList: 'SELECT * FROM warehouse WHERE enabled = 1 OR @all = 1 ORDER BY code',
  whById: 'SELECT * FROM warehouse WHERE id = ?',
  whByCode: 'SELECT id FROM warehouse WHERE code = ?',
  whInsert: `INSERT INTO warehouse (code, name, remark, enabled, created_at)
             VALUES (@code, @name, @remark, @enabled, @now)`,
  whUpdate: 'UPDATE warehouse SET code = @code, name = @name, remark = @remark, enabled = @enabled WHERE id = @id',

  // —— 商品 ——
  // LIKE 用 ESCAPE 转义用户输入中的 % 和 _，否则搜“50%”会匹配任意字符。
  itemList: `SELECT ${ITEM_COLS} FROM item i
             WHERE (enabled = 1 OR @all = 1)
               AND (@kw = '' OR code LIKE @like ESCAPE '\\' OR name LIKE @like ESCAPE '\\'
                    OR barcode LIKE @like ESCAPE '\\' OR spec LIKE @like ESCAPE '\\' OR brand LIKE @like ESCAPE '\\')
             ORDER BY code LIMIT @limit OFFSET @offset`,
  itemCount: `SELECT COUNT(*) AS n FROM item
              WHERE (enabled = 1 OR @all = 1)
                AND (@kw = '' OR code LIKE @like ESCAPE '\\' OR name LIKE @like ESCAPE '\\'
                     OR barcode LIKE @like ESCAPE '\\' OR spec LIKE @like ESCAPE '\\' OR brand LIKE @like ESCAPE '\\')`,
  itemById: `SELECT ${ITEM_COLS} FROM item i WHERE id = ?`,
  // 扫码定位：条码优先，其次编码；两者都有唯一索引，各一次索引查找。
  itemLookup: `SELECT ${ITEM_COLS} FROM item i WHERE barcode = @code AND enabled = 1
               UNION ALL
               SELECT ${ITEM_COLS} FROM item i WHERE code = @code AND enabled = 1
               LIMIT 1`,
  itemByCode: 'SELECT id FROM item WHERE code = ?',
  itemByBarcode: 'SELECT id FROM item WHERE barcode = ?',
  itemInsert: `INSERT INTO item (code, name, spec, unit, barcode, category, brand, serial_managed,
                 default_buy_price, default_sell_price, remark, enabled, created_at, updated_at)
               VALUES (@code, @name, @spec, @unit, @barcode, @category, @brand, @serialManaged,
                 @defaultBuyPrice, @defaultSellPrice, @remark, @enabled, @now, @now)`,
  itemUpdate: `UPDATE item SET code = @code, name = @name, spec = @spec, unit = @unit, barcode = @barcode,
                 category = @category, brand = @brand, serial_managed = @serialManaged,
                 default_buy_price = @defaultBuyPrice, default_sell_price = @defaultSellPrice,
                 remark = @remark, enabled = @enabled, updated_at = @now
               WHERE id = @id`,

  // —— 往来单位 ——
  ptList: `SELECT * FROM partner
           WHERE kind = @kind AND (enabled = 1 OR @all = 1)
             AND (@kw = '' OR code LIKE @like ESCAPE '\\' OR name LIKE @like ESCAPE '\\' OR phone LIKE @like ESCAPE '\\')
           ORDER BY code`,
  ptById: 'SELECT * FROM partner WHERE id = ?',
  ptByCode: 'SELECT id FROM partner WHERE kind = ? AND code = ?',
  ptInsert: `INSERT INTO partner (kind, code, name, contact, phone, address, remark, enabled, created_at)
             VALUES (@kind, @code, @name, @contact, @phone, @address, @remark, @enabled, @now)`,
  ptUpdate: `UPDATE partner SET code = @code, name = @name, contact = @contact, phone = @phone,
               address = @address, remark = @remark, enabled = @enabled
             WHERE id = @id`,

  // —— 设置 ——
  settingAll: 'SELECT key, value FROM setting',
  settingUpsert: `INSERT INTO setting (key, value) VALUES (?, ?)
                  ON CONFLICT (key) DO UPDATE SET value = excluded.value`,
})

// ═════════════════════════════ 映射 ═════════════════════════════

interface WarehouseRecord {
  id: number
  code: string
  name: string
  remark: string
  enabled: number
}
interface ItemRecord {
  id: number
  code: string
  name: string
  spec: string
  unit: string
  barcode: string | null
  category: string
  brand: string
  serial_managed: number
  default_buy_price: number
  default_sell_price: number
  remark: string
  enabled: number
  serial_flag_locked: number
}
interface PartnerRecord {
  id: number
  kind: 'supplier' | 'customer'
  code: string
  name: string
  contact: string
  phone: string
  address: string
  remark: string
  enabled: number
}

const toWarehouse = (r: WarehouseRecord): WarehouseRow => ({
  id: r.id,
  code: r.code,
  name: r.name,
  remark: r.remark,
  enabled: r.enabled === 1,
})

export const toItem = (r: ItemRecord): ItemRow => ({
  id: r.id,
  code: r.code,
  name: r.name,
  spec: r.spec,
  unit: r.unit,
  barcode: r.barcode,
  category: r.category,
  brand: r.brand,
  serialManaged: r.serial_managed === 1,
  serialFlagLocked: r.serial_flag_locked === 1,
  defaultBuyPrice: cents(r.default_buy_price),
  defaultSellPrice: cents(r.default_sell_price),
  remark: r.remark,
  enabled: r.enabled === 1,
})

const toPartner = (r: PartnerRecord): PartnerRow => ({
  id: r.id,
  kind: r.kind,
  code: r.code,
  name: r.name,
  contact: r.contact,
  phone: r.phone,
  address: r.address,
  remark: r.remark,
  enabled: r.enabled === 1,
})

/** LIKE 模式：转义通配符后两侧加 %。 */
const likePattern = (kw: string): string => `%${kw.replace(/[\\%_]/g, (c) => '\\' + c)}%`

/** 供单据模块复用：按 id 取商品，不存在抛 NOT_FOUND。 */
export function getItemOrThrow(db: DB, id: number): ItemRow {
  const r = sql(db).itemById.get(id) as ItemRecord | undefined
  ensure(r, 'NOT_FOUND', { type: 'item', id })
  return toItem(r)
}

// ═════════════════════════════ 处理器 ═════════════════════════════

export const masterdataHandlers = {
  'warehouse:list': handler('warehouse:list', 'user', (ctx, input) =>
    (sql(ctx.core.db).whList.all({ all: input.includeDisabled ? 1 : 0 }) as WarehouseRecord[]).map(toWarehouse),
  ),

  'warehouse:save': handler('warehouse:save', 'user', (ctx, input) => {
    const { db, clock } = ctx.core
    return inTransaction(db, () => {
      const dup = sql(db).whByCode.get(input.code) as { id: number } | undefined
      ensure(!dup || dup.id === input.id, 'CODE_DUPLICATE', { field: 'code', value: input.code })
      const params = { ...input, enabled: input.enabled ? 1 : 0, now: clock.now() }
      if (input.id === undefined) {
        const id = Number(sql(db).whInsert.run(params).lastInsertRowid)
        const row = toWarehouse(sql(db).whById.get(id) as WarehouseRecord)
        writeOpLog(db, ctx.session.userId, 'warehouse.create', { after: row }, null, clock.now())
        return row
      }
      const before = sql(db).whById.get(input.id) as WarehouseRecord | undefined
      ensure(before, 'NOT_FOUND', { type: 'warehouse', id: input.id })
      sql(db).whUpdate.run(params)
      const row = toWarehouse(sql(db).whById.get(input.id) as WarehouseRecord)
      writeOpLog(
        db,
        ctx.session.userId,
        'warehouse.update',
        { id: input.id, changes: diff(toWarehouse(before), row) },
        null,
        clock.now(),
      )
      return row
    })
  }),

  'item:list': handler('item:list', 'user', (ctx, input) => {
    const db = ctx.core.db
    const p = {
      all: input.includeDisabled ? 1 : 0,
      kw: input.keyword,
      like: likePattern(input.keyword),
      limit: input.pageSize,
      offset: (input.page - 1) * input.pageSize,
    }
    const rows = (sql(db).itemList.all(p) as ItemRecord[]).map(toItem)
    const { limit: _l, offset: _o, ...countParams } = p
    const total = (sql(db).itemCount.get(countParams) as { n: number }).n
    return { rows, total }
  }),

  'item:get': handler('item:get', 'user', (ctx, input) => getItemOrThrow(ctx.core.db, input.id)),

  'item:lookup': handler('item:lookup', 'user', (ctx, input) => {
    const r = sql(ctx.core.db).itemLookup.get({ code: input.code }) as ItemRecord | undefined
    return r ? toItem(r) : null
  }),

  'item:save': handler('item:save', 'user', (ctx, input) => {
    const { db, clock } = ctx.core
    return inTransaction(db, () => {
      const dupCode = sql(db).itemByCode.get(input.code) as { id: number } | undefined
      ensure(!dupCode || dupCode.id === input.id, 'CODE_DUPLICATE', { field: 'code', value: input.code })
      if (input.barcode !== null) {
        const dupBar = sql(db).itemByBarcode.get(input.barcode) as { id: number } | undefined
        ensure(!dupBar || dupBar.id === input.id, 'CODE_DUPLICATE', { field: 'barcode', value: input.barcode })
      }
      const params = {
        ...input,
        serialManaged: input.serialManaged ? 1 : 0,
        enabled: input.enabled ? 1 : 0,
        now: clock.now(),
      }
      if (input.id === undefined) {
        const id = Number(sql(db).itemInsert.run(params).lastInsertRowid)
        const row = getItemOrThrow(db, id)
        writeOpLog(db, ctx.session.userId, 'item.create', { after: row }, null, clock.now())
        return row
      }
      const before = getItemOrThrow(db, input.id)
      // 已有库存流水的商品不能切换串号管理：已有的串号流水 / 成本批次结构会与新设置不一致（6.2）。
      ensure(!before.serialFlagLocked || before.serialManaged === input.serialManaged, 'ITEM_SERIAL_FLAG_LOCKED', {
        itemId: input.id,
        code: before.code,
      })
      sql(db).itemUpdate.run(params)
      const row = getItemOrThrow(db, input.id)
      writeOpLog(db, ctx.session.userId, 'item.update', { id: input.id, changes: diff(before, row) }, null, clock.now())
      return row
    })
  }),

  'partner:list': handler('partner:list', 'user', (ctx, input) =>
    (
      sql(ctx.core.db).ptList.all({
        kind: input.kind,
        all: input.includeDisabled ? 1 : 0,
        kw: input.keyword,
        like: likePattern(input.keyword),
      }) as PartnerRecord[]
    ).map(toPartner),
  ),

  'partner:save': handler('partner:save', 'user', (ctx, input) => {
    const { db, clock } = ctx.core
    return inTransaction(db, () => {
      const dup = sql(db).ptByCode.get(input.kind, input.code) as { id: number } | undefined
      ensure(!dup || dup.id === input.id, 'CODE_DUPLICATE', { field: 'code', value: input.code })
      const params = { ...input, enabled: input.enabled ? 1 : 0, now: clock.now() }
      if (input.id === undefined) {
        const id = Number(sql(db).ptInsert.run(params).lastInsertRowid)
        const row = toPartner(sql(db).ptById.get(id) as PartnerRecord)
        writeOpLog(db, ctx.session.userId, `${input.kind}.create`, { after: row }, null, clock.now())
        return row
      }
      const before = sql(db).ptById.get(input.id) as PartnerRecord | undefined
      ensure(before, 'NOT_FOUND', { type: 'partner', id: input.id })
      // 往来单位类型不可修改：供应商被采购单引用、客户被销售单引用，改类型会破坏单据的约束含义。
      ensure(before.kind === input.kind, 'VALIDATION_FAILED', { field: 'kind' }, '不能修改往来单位类型')
      sql(db).ptUpdate.run(params)
      const row = toPartner(sql(db).ptById.get(input.id) as PartnerRecord)
      writeOpLog(
        db,
        ctx.session.userId,
        `${input.kind}.update`,
        { id: input.id, changes: diff(toPartner(before), row) },
        null,
        clock.now(),
      )
      return row
    })
  }),

  'setting:getAll': handler('setting:getAll', 'user', (ctx) => {
    const rows = sql(ctx.core.db).settingAll.all() as { key: string; value: string }[]
    return Object.fromEntries(rows.map((r) => [r.key, r.value]))
  }),

  'setting:save': handler('setting:save', 'owner', (ctx, input) => {
    const { db, clock } = ctx.core
    inTransaction(db, () => {
      for (const [k, v] of Object.entries(input.values)) sql(db).settingUpsert.run(k, v)
      writeOpLog(db, ctx.session.userId, 'setting.save', { keys: Object.keys(input.values) }, null, clock.now())
    })
    return null
  }),
}
