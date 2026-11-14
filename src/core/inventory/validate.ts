import type { DocInputParsed } from '@shared/contracts'
import type { DocType } from '@shared/dto'
import type { DB } from '../db/connection'
import { defineStatements } from '../db/statements'
import { BizError, ensure } from '../domain/errors'
import type { HeaderWrite, LineWrite } from './repo'

/**
 * 单据内容检查与规范化（设计文档 7.2 第 2 步）。
 * 返回可直接写入数据库的头、行；金额按规则算好，页面传入的“元”已在 zod 层变成分。
 */

const sql = defineStatements({
  item: 'SELECT id, code, name, serial_managed, enabled FROM item WHERE id = ?',
  warehouse: 'SELECT id, enabled FROM warehouse WHERE id = ?',
  partner: 'SELECT id, kind, enabled FROM partner WHERE id = ?',
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

/** 业务日期不能晚于今天（R6）。 */
export function assertBizDate(bizDate: string, today: string): void {
  ensure(bizDate <= today, 'DATE_IN_FUTURE', { date: bizDate })
}

/**
 * 校验并规范化一张单据。
 * M2 只开放采购入库、销售出库；其他类型留给 M4，避免半成品逻辑混进过账路径。
 */
export function normalizeDoc(db: DB, input: DocInputParsed, today: string): NormalizedDoc {
  const { docType } = input
  ensure(
    docType === 'PURCHASE' || docType === 'SALE',
    'VALIDATION_FAILED',
    { field: 'docType', value: docType },
    '当前版本仅支持采购入库和销售出库',
  )
  assertBizDate(input.bizDate, today)

  const wh = sql(db).warehouse.get(input.warehouseId) as { id: number; enabled: number } | undefined
  ensure(wh, 'NOT_FOUND', { type: 'warehouse', id: input.warehouseId })
  ensure(wh.enabled === 1, 'VALIDATION_FAILED', { field: 'warehouseId' }, '仓库已停用')

  ensure(input.partnerId !== undefined, 'VALIDATION_FAILED', { field: 'partnerId' }, '请选择往来单位')
  const partner = sql(db).partner.get(input.partnerId) as
    | { id: number; kind: string; enabled: number }
    | undefined
  ensure(partner, 'NOT_FOUND', { type: 'partner', id: input.partnerId })
  ensure(partner.enabled === 1, 'VALIDATION_FAILED', { field: 'partnerId' }, '往来单位已停用')
  const expectKind = docType === 'PURCHASE' ? 'supplier' : 'customer'
  ensure(
    partner.kind === expectKind,
    'VALIDATION_FAILED',
    { field: 'partnerId', expected: expectKind },
    docType === 'PURCHASE' ? '采购单必须选择供应商' : '销售单必须选择客户',
  )

  ensure(input.toWarehouseId === undefined, 'VALIDATION_FAILED', { field: 'toWarehouseId' }, '采购/销售单不能填调入仓')
  ensure(input.refDocId === undefined, 'VALIDATION_FAILED', { field: 'refDocId' }, '采购/销售单不能关联原单')

  const seenSerials = new Set<string>()
  const lines: LineWrite[] = input.lines.map((line, idx) => {
    const lineNo = idx + 1
    const item = sql(db).item.get(line.itemId) as ItemInfo | undefined
    ensure(item, 'NOT_FOUND', { type: 'item', id: line.itemId })
    ensure(item.enabled === 1, 'VALIDATION_FAILED', { field: `lines.${idx}.itemId` }, `商品 ${item.code} 已停用`)

    const serialManaged = item.serial_managed === 1
    if (serialManaged) {
      if (line.serials.length !== line.qty) {
        throw new BizError('SERIAL_COUNT_MISMATCH', {
          lineNo,
          qty: line.qty,
          count: line.serials.length,
          itemCode: item.code,
        })
      }
      for (const sn of line.serials) {
        if (seenSerials.has(sn)) throw new BizError('SERIAL_DUPLICATE_IN_DOC', { serial: sn, lineNo })
        seenSerials.add(sn)
      }
    } else if (line.serials.length > 0) {
      throw new BizError('VALIDATION_FAILED', { lineNo, field: 'serials' }, `商品 ${item.code} 不按串号管理，不能填串号`)
    }

    // 采购/销售金额 = 数量 × 单价（R20）；销售退货的改价规则在 M4。
    const unitPrice = line.unitPrice
    const amount = unitPrice * line.qty
    return {
      lineNo,
      itemId: line.itemId,
      qty: line.qty,
      unitPrice,
      amount,
      refLineId: null,
      remark: line.remark,
      serials: line.serials,
    }
  })

  return {
    header: {
      docType: docType as DocType,
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
