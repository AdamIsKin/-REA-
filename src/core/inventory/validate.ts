import type { DocInputParsed } from '@shared/contracts'
import type { DocType } from '@shared/dto'
import type { DB } from '../db/connection'
import { defineStatements } from '../db/statements'
import { BizError, ensure } from '../domain/errors'
import type { HeaderWrite, LineWrite } from './repo'

/**
 * 单据内容检查与规范化（设计文档 7.2 第 2 步）。
 * 五类单据共用入口；退货单价取原单（D25），移库单价/金额为 0。
 */

const sql = defineStatements({
  item: 'SELECT id, code, name, serial_managed, enabled FROM item WHERE id = ?',
  warehouse: 'SELECT id, enabled FROM warehouse WHERE id = ?',
  partner: 'SELECT id, kind, enabled FROM partner WHERE id = ?',
  doc: 'SELECT id, doc_type, status, partner_id FROM doc WHERE id = ?',
  line: 'SELECT id, doc_id, item_id, qty, unit_price FROM doc_line WHERE id = ?',
  lineSerials: 'SELECT serial FROM doc_line_serial WHERE line_id = ?',
  // 已过账退货占用的数量（不含当前正在编辑的草稿单，由 excludeDocId 排除）。
  returnedQty: `SELECT COALESCE(SUM(l.qty), 0) AS n
                FROM doc_line l
                JOIN doc d ON d.id = l.doc_id
                WHERE l.ref_line_id = ? AND d.status = 'posted' AND d.id <> ?`,
  returnedSerials: `SELECT s.serial
                    FROM doc_line_serial s
                    JOIN doc_line l ON l.id = s.line_id
                    JOIN doc d ON d.id = l.doc_id
                    WHERE l.ref_line_id = ? AND d.status = 'posted' AND d.id <> ?`,
})

interface ItemInfo {
  id: number
  code: string
  name: string
  serial_managed: number
  enabled: number
}

export interface NormalizedDoc {
  header: HeaderWrite
  lines: LineWrite[]
}

export function assertBizDate(bizDate: string, today: string): void {
  ensure(bizDate <= today, 'DATE_IN_FUTURE', { date: bizDate })
}

function requireWarehouse(db: DB, id: number, field: string): void {
  const wh = sql(db).warehouse.get(id) as { id: number; enabled: number } | undefined
  ensure(wh, 'NOT_FOUND', { type: 'warehouse', id })
  ensure(wh.enabled === 1, 'VALIDATION_FAILED', { field }, '仓库已停用')
}

function checkSerials(
  item: ItemInfo,
  lineNo: number,
  qty: number,
  serials: string[],
  seen: Set<string>,
): void {
  if (item.serial_managed === 1) {
    if (serials.length !== qty) {
      throw new BizError('SERIAL_COUNT_MISMATCH', { lineNo, qty, count: serials.length, itemCode: item.code })
    }
    for (const sn of serials) {
      if (seen.has(sn)) throw new BizError('SERIAL_DUPLICATE_IN_DOC', { serial: sn, lineNo })
      seen.add(sn)
    }
  } else if (serials.length > 0) {
    throw new BizError('VALIDATION_FAILED', { lineNo, field: 'serials' }, `商品 ${item.code} 不按串号管理，不能填串号`)
  }
}

/**
 * @param excludeDocId 修改已有退货单时，统计“已退数量”要排除本单，避免把自己算进去。
 */
export function normalizeDoc(
  db: DB,
  input: DocInputParsed,
  today: string,
  excludeDocId = 0,
): NormalizedDoc {
  const { docType } = input
  assertBizDate(input.bizDate, today)
  requireWarehouse(db, input.warehouseId, 'warehouseId')

  const seenSerials = new Set<string>()

  if (docType === 'TRANSFER') {
    ensure(input.toWarehouseId !== undefined, 'VALIDATION_FAILED', { field: 'toWarehouseId' }, '请选择调入仓')
    ensure(input.toWarehouseId !== input.warehouseId, 'VALIDATION_FAILED', { field: 'toWarehouseId' }, '调入仓不能与调出仓相同')
    requireWarehouse(db, input.toWarehouseId!, 'toWarehouseId')
    ensure(input.partnerId === undefined, 'VALIDATION_FAILED', { field: 'partnerId' }, '移库单不能填往来单位')
    ensure(input.refDocId === undefined, 'VALIDATION_FAILED', { field: 'refDocId' }, '移库单不能关联原单')

    const lines: LineWrite[] = input.lines.map((line, idx) => {
      const lineNo = idx + 1
      const item = sql(db).item.get(line.itemId) as ItemInfo | undefined
      ensure(item, 'NOT_FOUND', { type: 'item', id: line.itemId })
      ensure(item.enabled === 1, 'VALIDATION_FAILED', { field: `lines.${idx}.itemId` }, `商品 ${item.code} 已停用`)
      checkSerials(item, lineNo, line.qty, line.serials, seenSerials)
      return {
        lineNo,
        itemId: line.itemId,
        qty: line.qty,
        unitPrice: 0,
        amount: 0,
        refLineId: null,
        remark: line.remark,
        serials: line.serials,
      }
    })
    return {
      header: {
        docType,
        bizDate: input.bizDate,
        warehouseId: input.warehouseId,
        toWarehouseId: input.toWarehouseId!,
        partnerId: null,
        refDocId: null,
        remark: input.remark,
      },
      lines,
    }
  }

  if (docType === 'PURCHASE' || docType === 'SALE') {
    ensure(input.partnerId !== undefined, 'VALIDATION_FAILED', { field: 'partnerId' }, '请选择往来单位')
    const partner = sql(db).partner.get(input.partnerId) as { id: number; kind: string; enabled: number } | undefined
    ensure(partner, 'NOT_FOUND', { type: 'partner', id: input.partnerId })
    ensure(partner.enabled === 1, 'VALIDATION_FAILED', { field: 'partnerId' }, '往来单位已停用')
    const expectKind = docType === 'PURCHASE' ? 'supplier' : 'customer'
    ensure(partner.kind === expectKind, 'VALIDATION_FAILED', { field: 'partnerId' }, docType === 'PURCHASE' ? '采购单必须选择供应商' : '销售单必须选择客户')
    ensure(input.toWarehouseId === undefined, 'VALIDATION_FAILED', { field: 'toWarehouseId' }, '不能填调入仓')
    ensure(input.refDocId === undefined, 'VALIDATION_FAILED', { field: 'refDocId' }, '不能关联原单')

    const lines: LineWrite[] = input.lines.map((line, idx) => {
      const lineNo = idx + 1
      const item = sql(db).item.get(line.itemId) as ItemInfo | undefined
      ensure(item, 'NOT_FOUND', { type: 'item', id: line.itemId })
      ensure(item.enabled === 1, 'VALIDATION_FAILED', { field: `lines.${idx}.itemId` }, `商品 ${item.code} 已停用`)
      checkSerials(item, lineNo, line.qty, line.serials, seenSerials)
      return {
        lineNo,
        itemId: line.itemId,
        qty: line.qty,
        unitPrice: line.unitPrice,
        amount: line.unitPrice * line.qty,
        refLineId: null,
        remark: line.remark,
        serials: line.serials,
      }
    })
    return {
      header: {
        docType,
        bizDate: input.bizDate,
        warehouseId: input.warehouseId,
        toWarehouseId: null,
        partnerId: input.partnerId!,
        refDocId: null,
        remark: input.remark,
      },
      lines,
    }
  }

  // —— 退货：PURCHASE_RETURN / SALE_RETURN ——
  const expectOrig: DocType = docType === 'PURCHASE_RETURN' ? 'PURCHASE' : 'SALE'
  ensure(input.refDocId !== undefined, 'VALIDATION_FAILED', { field: 'refDocId' }, '退货必须关联原单')
  ensure(input.toWarehouseId === undefined, 'VALIDATION_FAILED', { field: 'toWarehouseId' }, '退货单不能填调入仓')

  const orig = sql(db).doc.get(input.refDocId) as
    | { id: number; doc_type: DocType; status: string; partner_id: number | null }
    | undefined
  ensure(orig, 'NOT_FOUND', { type: 'doc', id: input.refDocId })
  ensure(orig.doc_type === expectOrig, 'VALIDATION_FAILED', { field: 'refDocId' }, '原单类型不匹配')
  ensure(orig.status === 'posted', 'DOC_STATE_INVALID', { status: orig.status }, '只能关联已过账的原单')

  // 往来单位默认取原单；若传入则必须一致。
  const partnerId = input.partnerId ?? orig.partner_id ?? undefined
  ensure(partnerId !== undefined, 'VALIDATION_FAILED', { field: 'partnerId' }, '请选择往来单位')
  if (input.partnerId !== undefined) {
    ensure(input.partnerId === orig.partner_id, 'VALIDATION_FAILED', { field: 'partnerId' }, '退货往来单位须与原单一致')
  }

  const lines: LineWrite[] = input.lines.map((line, idx) => {
    const lineNo = idx + 1
    ensure(line.refLineId !== undefined, 'VALIDATION_FAILED', { field: `lines.${idx}.refLineId` }, '退货行必须指向原单行')
    const origLine = sql(db).line.get(line.refLineId) as
      | { id: number; doc_id: number; item_id: number; qty: number; unit_price: number }
      | undefined
    ensure(origLine, 'NOT_FOUND', { type: 'doc_line', id: line.refLineId })
    ensure(origLine.doc_id === orig.id, 'VALIDATION_FAILED', { field: 'refLineId' }, '原单行不属于关联原单')
    ensure(origLine.item_id === line.itemId, 'VALIDATION_FAILED', { field: 'itemId' }, '退货商品必须与原单行一致')

    const item = sql(db).item.get(line.itemId) as ItemInfo | undefined
    ensure(item, 'NOT_FOUND', { type: 'item', id: line.itemId })
    checkSerials(item, lineNo, line.qty, line.serials, seenSerials)

    const used = (sql(db).returnedQty.get(origLine.id, excludeDocId) as { n: number }).n
    const available = origLine.qty - used
    if (line.qty > available) {
      throw new BizError('RETURN_QTY_EXCEEDED', { lineNo, available, refLineId: origLine.id })
    }

    if (item.serial_managed === 1) {
      const origSerials = new Set(
        (sql(db).lineSerials.all(origLine.id) as { serial: string }[]).map((r) => r.serial),
      )
      const already = new Set(
        (sql(db).returnedSerials.all(origLine.id, excludeDocId) as { serial: string }[]).map((r) => r.serial),
      )
      for (const sn of line.serials) {
        if (!origSerials.has(sn)) throw new BizError('RETURN_SERIAL_NOT_IN_ORIGINAL', { serial: sn, lineNo })
        if (already.has(sn)) throw new BizError('RETURN_SERIAL_NOT_IN_ORIGINAL', { serial: sn, lineNo }, '串号已退过')
      }
    }

    // D25：退货单价/金额固定为原单行单价 × 数量，忽略页面传入的单价。
    const unitPrice = origLine.unit_price
    return {
      lineNo,
      itemId: line.itemId,
      qty: line.qty,
      unitPrice,
      amount: unitPrice * line.qty,
      refLineId: origLine.id,
      remark: line.remark,
      serials: line.serials,
    }
  })

  return {
    header: {
      docType,
      bizDate: input.bizDate,
      warehouseId: input.warehouseId,
      toWarehouseId: null,
      partnerId: partnerId!,
      refDocId: orig.id,
      remark: input.remark,
    },
    lines,
  }
}
