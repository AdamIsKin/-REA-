import type { BrandRow, CategoryRow, ItemRow, PartnerRow, WarehouseRow } from '@shared/dto'
import { cents } from '@shared/money'
import { diff, writeOpLog } from '../audit'
import type { DB } from '../db/connection'
import { defineStatements } from '../db/statements'
import { inTransaction } from '../db/tx'
import { ensure } from '../domain/errors'
import { handler } from '../rpc'

/**
 * 商品查询附带分类/品牌名（D39）。
 * serial_managed 固定为 1（R23），不再暴露可改开关。
 */
const ITEM_COLS = `
  i.id, i.code, i.name, i.spec, i.unit, i.barcode, i.category_id, i.brand_id,
  i.serial_managed, i.default_buy_price, i.default_sell_price, i.remark, i.enabled,
  COALESCE(c.name, '') AS category_name, COALESCE(b.name, '') AS brand_name`

const sql = defineStatements({
  whList: 'SELECT * FROM warehouse WHERE enabled = 1 OR @all = 1 ORDER BY code',
  whById: 'SELECT * FROM warehouse WHERE id = ?',
  whByCode: 'SELECT id FROM warehouse WHERE code = ?',
  whInsert: `INSERT INTO warehouse (code, name, remark, enabled, created_at)
             VALUES (@code, @name, @remark, @enabled, @now)`,
  whUpdate: 'UPDATE warehouse SET code = @code, name = @name, remark = @remark, enabled = @enabled WHERE id = @id',

  catList: 'SELECT * FROM item_category WHERE enabled = 1 OR @all = 1 ORDER BY code',
  catById: 'SELECT * FROM item_category WHERE id = ?',
  catByCode: 'SELECT id FROM item_category WHERE code = ?',
  catInsert: `INSERT INTO item_category (code, name, enabled, created_at) VALUES (@code, @name, @enabled, @now)`,
  catUpdate: 'UPDATE item_category SET code = @code, name = @name, enabled = @enabled WHERE id = @id',

  brandList: 'SELECT * FROM item_brand WHERE enabled = 1 OR @all = 1 ORDER BY code',
  brandById: 'SELECT * FROM item_brand WHERE id = ?',
  brandByCode: 'SELECT id FROM item_brand WHERE code = ?',
  brandInsert: `INSERT INTO item_brand (code, name, enabled, created_at) VALUES (@code, @name, @enabled, @now)`,
  brandUpdate: 'UPDATE item_brand SET code = @code, name = @name, enabled = @enabled WHERE id = @id',

  itemList: `SELECT ${ITEM_COLS} FROM item i
             LEFT JOIN item_category c ON c.id = i.category_id
             LEFT JOIN item_brand b ON b.id = i.brand_id
             WHERE (i.enabled = 1 OR @all = 1)
               AND (@kw = '' OR i.code LIKE @like ESCAPE '\\' OR i.name LIKE @like ESCAPE '\\'
                    OR i.barcode LIKE @like ESCAPE '\\' OR i.spec LIKE @like ESCAPE '\\'
                    OR c.name LIKE @like ESCAPE '\\' OR b.name LIKE @like ESCAPE '\\')
             ORDER BY i.code LIMIT @limit OFFSET @offset`,
  itemCount: `SELECT COUNT(*) AS n FROM item i
              LEFT JOIN item_category c ON c.id = i.category_id
              LEFT JOIN item_brand b ON b.id = i.brand_id
              WHERE (i.enabled = 1 OR @all = 1)
                AND (@kw = '' OR i.code LIKE @like ESCAPE '\\' OR i.name LIKE @like ESCAPE '\\'
                     OR i.barcode LIKE @like ESCAPE '\\' OR i.spec LIKE @like ESCAPE '\\'
                     OR c.name LIKE @like ESCAPE '\\' OR b.name LIKE @like ESCAPE '\\')`,
  itemById: `SELECT ${ITEM_COLS} FROM item i
             LEFT JOIN item_category c ON c.id = i.category_id
             LEFT JOIN item_brand b ON b.id = i.brand_id
             WHERE i.id = ?`,
  itemLookup: `SELECT ${ITEM_COLS} FROM item i
               LEFT JOIN item_category c ON c.id = i.category_id
               LEFT JOIN item_brand b ON b.id = i.brand_id
               WHERE i.barcode = @code AND i.enabled = 1
               UNION ALL
               SELECT ${ITEM_COLS} FROM item i
               LEFT JOIN item_category c ON c.id = i.category_id
               LEFT JOIN item_brand b ON b.id = i.brand_id
               WHERE i.code = @code AND i.enabled = 1
               LIMIT 1`,
  itemByCode: 'SELECT id FROM item WHERE code = ?',
  itemByBarcode: 'SELECT id FROM item WHERE barcode = ?',
  itemInsert: `INSERT INTO item (code, name, spec, unit, barcode, category_id, brand_id, serial_managed,
                 default_buy_price, default_sell_price, remark, enabled, created_at, updated_at)
               VALUES (@code, @name, @spec, @unit, @barcode, @categoryId, @brandId, 1,
                 @defaultBuyPrice, @defaultSellPrice, @remark, @enabled, @now, @now)`,
  itemUpdate: `UPDATE item SET code = @code, name = @name, spec = @spec, unit = @unit, barcode = @barcode,
                 category_id = @categoryId, brand_id = @brandId, serial_managed = 1,
                 default_buy_price = @defaultBuyPrice, default_sell_price = @defaultSellPrice,
                 remark = @remark, enabled = @enabled, updated_at = @now
               WHERE id = @id`,

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

  settingAll: 'SELECT key, value FROM setting',
  settingUpsert: `INSERT INTO setting (key, value) VALUES (?, ?)
                  ON CONFLICT (key) DO UPDATE SET value = excluded.value`,
})

interface WarehouseRecord {
  id: number
  code: string
  name: string
  remark: string
  enabled: number
}
interface NamedMaster {
  id: number
  code: string
  name: string
  enabled: number
}
interface ItemRecord {
  id: number
  code: string
  name: string
  spec: string
  unit: string
  barcode: string | null
  category_id: number | null
  brand_id: number | null
  category_name: string
  brand_name: string
  serial_managed: number
  default_buy_price: number
  default_sell_price: number
  remark: string
  enabled: number
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

const toCategory = (r: NamedMaster): CategoryRow => ({
  id: r.id,
  code: r.code,
  name: r.name,
  enabled: r.enabled === 1,
})

const toBrand = (r: NamedMaster): BrandRow => ({
  id: r.id,
  code: r.code,
  name: r.name,
  enabled: r.enabled === 1,
})

export const toItem = (r: ItemRecord): ItemRow => ({
  id: r.id,
  code: r.code,
  name: r.name,
  spec: r.spec,
  unit: r.unit,
  barcode: r.barcode,
  categoryId: r.category_id,
  categoryName: r.category_name,
  brandId: r.brand_id,
  brandName: r.brand_name,
  serialManaged: true,
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

const likePattern = (kw: string): string => `%${kw.replace(/[\\%_]/g, (c) => '\\' + c)}%`

export function getItemOrThrow(db: DB, id: number): ItemRow {
  const r = sql(db).itemById.get(id) as ItemRecord | undefined
  ensure(r, 'NOT_FOUND', { type: 'item', id })
  return toItem(r)
}

function saveNamedMaster(
  kind: 'category' | 'brand',
  db: DB,
  userId: number,
  now: string,
  input: { id?: number; code: string; name: string; enabled: boolean },
): CategoryRow | BrandRow {
  const listSql = kind === 'category' ? sql(db).catByCode : sql(db).brandByCode
  const byId = kind === 'category' ? sql(db).catById : sql(db).brandById
  const insert = kind === 'category' ? sql(db).catInsert : sql(db).brandInsert
  const update = kind === 'category' ? sql(db).catUpdate : sql(db).brandUpdate
  const map = kind === 'category' ? toCategory : toBrand
  const dup = listSql.get(input.code) as { id: number } | undefined
  ensure(!dup || dup.id === input.id, 'CODE_DUPLICATE', { field: 'code', value: input.code })
  const params = { code: input.code, name: input.name, enabled: input.enabled ? 1 : 0, now, id: input.id }
  if (input.id === undefined) {
    const id = Number(insert.run(params).lastInsertRowid)
    const row = map(byId.get(id) as NamedMaster)
    writeOpLog(db, userId, `${kind}.create`, { after: row }, null, now)
    return row
  }
  const before = byId.get(input.id) as NamedMaster | undefined
  ensure(before, 'NOT_FOUND', { type: kind, id: input.id })
  update.run(params)
  const row = map(byId.get(input.id) as NamedMaster)
  writeOpLog(db, userId, `${kind}.update`, { id: input.id, changes: diff(map(before), row) }, null, now)
  return row
}

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

  'category:list': handler('category:list', 'user', (ctx, input) =>
    (sql(ctx.core.db).catList.all({ all: input.includeDisabled ? 1 : 0 }) as NamedMaster[]).map(toCategory),
  ),
  'category:save': handler('category:save', 'user', (ctx, input) =>
    inTransaction(ctx.core.db, () => saveNamedMaster('category', ctx.core.db, ctx.session.userId, ctx.core.clock.now(), input)),
  ),

  'brand:list': handler('brand:list', 'user', (ctx, input) =>
    (sql(ctx.core.db).brandList.all({ all: input.includeDisabled ? 1 : 0 }) as NamedMaster[]).map(toBrand),
  ),
  'brand:save': handler('brand:save', 'user', (ctx, input) =>
    inTransaction(ctx.core.db, () => saveNamedMaster('brand', ctx.core.db, ctx.session.userId, ctx.core.clock.now(), input)),
  ),

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
      if (input.categoryId != null) {
        ensure(sql(db).catById.get(input.categoryId), 'NOT_FOUND', { type: 'category', id: input.categoryId })
      }
      if (input.brandId != null) {
        ensure(sql(db).brandById.get(input.brandId), 'NOT_FOUND', { type: 'brand', id: input.brandId })
      }
      const params = {
        code: input.code,
        name: input.name,
        spec: input.spec,
        unit: input.unit,
        barcode: input.barcode,
        categoryId: input.categoryId ?? null,
        brandId: input.brandId ?? null,
        defaultBuyPrice: input.defaultBuyPrice,
        defaultSellPrice: input.defaultSellPrice,
        remark: input.remark,
        enabled: input.enabled ? 1 : 0,
        now: clock.now(),
        id: input.id,
      }
      if (input.id === undefined) {
        const id = Number(sql(db).itemInsert.run(params).lastInsertRowid)
        const row = getItemOrThrow(db, id)
        writeOpLog(db, ctx.session.userId, 'item.create', { after: row }, null, clock.now())
        return row
      }
      const before = getItemOrThrow(db, input.id)
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
