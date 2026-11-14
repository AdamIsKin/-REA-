import type { BrandRow, CategoryRow, ItemRow, PartnerRow, SerialType, WarehouseRow } from '@shared/dto'
import { diff, writeOpLog } from '../audit'
import type { DB } from '../db/connection'
import { defineStatements } from '../db/statements'
import { inTransaction } from '../db/tx'
import { ensure } from '../domain/errors'
import { handler } from '../rpc'

/**
 * 商品主数据（D47 / R28）：列表/保存用新字段；serial_managed 由 serial_type 派生。
 */
const ITEM_COLS = `
  i.id, i.code, i.name, i.category_id, i.brand_id,
  i.series, i.memory1, i.memory2, i.version, i.model, i.color,
  i.supplier_id, i.serial_type, i.serial_managed,
  i.stock_min, i.stock_max, i.is_consignment, i.is_quotable,
  i.created_by, i.updated_by, i.created_at, i.updated_at,
  COALESCE(c.name, '') AS category_name,
  COALESCE(b.name, '') AS brand_name,
  COALESCE(p.name, '') AS supplier_name,
  COALESCE(NULLIF(cu.display_name, ''), cu.username, '') AS created_by_name,
  COALESCE(NULLIF(uu.display_name, ''), uu.username, '') AS updated_by_name`

const ITEM_JOINS = `
  LEFT JOIN item_category c ON c.id = i.category_id
  LEFT JOIN item_brand b ON b.id = i.brand_id
  LEFT JOIN partner p ON p.id = i.supplier_id
  LEFT JOIN user cu ON cu.id = i.created_by
  LEFT JOIN user uu ON uu.id = i.updated_by`

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

  itemList: `SELECT ${ITEM_COLS} FROM item i ${ITEM_JOINS}
             WHERE (i.enabled = 1 OR @all = 1)
               AND (@kw = '' OR i.name LIKE @like ESCAPE '\\' OR i.series LIKE @like ESCAPE '\\'
                    OR i.model LIKE @like ESCAPE '\\' OR i.color LIKE @like ESCAPE '\\'
                    OR c.name LIKE @like ESCAPE '\\' OR b.name LIKE @like ESCAPE '\\'
                    OR p.name LIKE @like ESCAPE '\\')
             ORDER BY i.id DESC LIMIT @limit OFFSET @offset`,
  itemCount: `SELECT COUNT(*) AS n FROM item i ${ITEM_JOINS}
              WHERE (i.enabled = 1 OR @all = 1)
                AND (@kw = '' OR i.name LIKE @like ESCAPE '\\' OR i.series LIKE @like ESCAPE '\\'
                     OR i.model LIKE @like ESCAPE '\\' OR i.color LIKE @like ESCAPE '\\'
                     OR c.name LIKE @like ESCAPE '\\' OR b.name LIKE @like ESCAPE '\\'
                     OR p.name LIKE @like ESCAPE '\\')`,
  itemById: `SELECT ${ITEM_COLS} FROM item i ${ITEM_JOINS} WHERE i.id = ?`,
  itemLookup: `SELECT ${ITEM_COLS} FROM item i ${ITEM_JOINS}
               WHERE i.name = @code AND i.enabled = 1 LIMIT 1`,
  itemByCode: 'SELECT id FROM item WHERE code = ?',
  itemInsert: `INSERT INTO item (
                 code, name, category_id, brand_id, series, memory1, memory2, version, model, color,
                 supplier_id, serial_type, serial_managed, stock_min, stock_max, is_consignment, is_quotable,
                 enabled, created_by, updated_by, created_at, updated_at)
               VALUES (
                 @code, @name, @categoryId, @brandId, @series, @memory1, @memory2, @version, @model, @color,
                 @supplierId, @serialType, @serialManaged, @stockMin, @stockMax, @isConsignment, @isQuotable,
                 1, @createdBy, @updatedBy, @now, @now)`,
  itemUpdate: `UPDATE item SET name = @name, category_id = @categoryId, brand_id = @brandId,
                 series = @series, memory1 = @memory1, memory2 = @memory2, version = @version,
                 model = @model, color = @color, supplier_id = @supplierId,
                 serial_type = @serialType, serial_managed = @serialManaged,
                 stock_min = @stockMin, stock_max = @stockMax,
                 is_consignment = @isConsignment, is_quotable = @isQuotable,
                 updated_by = @updatedBy, updated_at = @now
               WHERE id = @id`,
  supplierOk: "SELECT id FROM partner WHERE id = ? AND kind = 'supplier' AND enabled = 1",
  userEnabled: 'SELECT id FROM user WHERE id = ? AND enabled = 1',

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
  category_id: number | null
  brand_id: number | null
  category_name: string
  brand_name: string
  series: string
  memory1: string
  memory2: string
  version: string
  model: string
  color: string
  supplier_id: number | null
  supplier_name: string
  serial_type: SerialType
  serial_managed: number
  stock_min: number
  stock_max: number
  is_consignment: number
  is_quotable: number
  created_by: number | null
  created_by_name: string
  updated_by: number | null
  updated_by_name: string
  created_at: string
  updated_at: string
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
  categoryId: r.category_id,
  categoryName: r.category_name,
  brandId: r.brand_id,
  brandName: r.brand_name,
  series: r.series ?? '',
  memory1: r.memory1 ?? '',
  memory2: r.memory2 ?? '',
  version: r.version ?? '',
  model: r.model ?? '',
  color: r.color ?? '',
  supplierId: r.supplier_id,
  supplierName: r.supplier_name ?? '',
  serialType: r.serial_type,
  serialManaged: r.serial_type !== 'none',
  stockMin: r.stock_min ?? 0,
  stockMax: r.stock_max ?? 0,
  isConsignment: (r.is_consignment ?? 0) === 1,
  isQuotable: (r.is_quotable ?? 1) === 1,
  createdBy: r.created_by,
  createdByName: r.created_by_name ?? '',
  updatedBy: r.updated_by,
  updatedByName: r.updated_by_name ?? '',
  createdAt: r.created_at,
  updatedAt: r.updated_at,
})

function serialManagedOf(t: SerialType): number {
  return t === 'none' ? 0 : 1
}

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
      if (input.categoryId != null) {
        ensure(sql(db).catById.get(input.categoryId), 'NOT_FOUND', { type: 'category', id: input.categoryId })
      }
      if (input.brandId != null) {
        ensure(sql(db).brandById.get(input.brandId), 'NOT_FOUND', { type: 'brand', id: input.brandId })
      }
      if (input.supplierId != null) {
        ensure(sql(db).supplierOk.get(input.supplierId), 'NOT_FOUND', { type: 'partner', id: input.supplierId }, '供应商不存在或已停用')
      }
      let createdBy = ctx.session.userId
      if (input.createdByUserId !== undefined) {
        ensure(
          sql(db).userEnabled.get(input.createdByUserId),
          'NOT_FOUND',
          { type: 'user', id: input.createdByUserId },
          '录入人不存在或已停用',
        )
        createdBy = input.createdByUserId
      }
      const serialType = input.serialType as SerialType
      const params = {
        name: input.name,
        categoryId: input.categoryId ?? null,
        brandId: input.brandId ?? null,
        series: input.series,
        memory1: input.memory1,
        memory2: input.memory2,
        version: input.version,
        model: input.model,
        color: input.color,
        supplierId: input.supplierId ?? null,
        serialType,
        serialManaged: serialManagedOf(serialType),
        stockMin: input.stockMin,
        stockMax: input.stockMax,
        isConsignment: input.isConsignment ? 1 : 0,
        isQuotable: input.isQuotable ? 1 : 0,
        createdBy,
        updatedBy: ctx.session.userId,
        now: clock.now(),
        id: input.id,
      }
      if (input.id === undefined) {
        // 内部唯一编码：不暴露给页面；用时间戳避免与 UNIQUE(code) 冲突。
        const code = `I${Date.now().toString(36).toUpperCase()}${Math.floor(Math.random() * 1000)}`
        const id = Number(sql(db).itemInsert.run({ ...params, code }).lastInsertRowid)
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
