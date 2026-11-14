import type { PurchaseDetailRow } from '@shared/dto'
import { cents } from '@shared/money'
import type { DB } from '../db/connection'
import { defineStatements } from '../db/statements'
import { inTransaction } from '../db/tx'
import { ensure } from '../domain/errors'
import { writeOpLog } from '../audit'
import { handler } from '../rpc'
import { getLine, updateLineRebate } from './repo'

/**
 * 采购入库明细台账与返利预留（R25 / R26）。
 * 按串号展开：一行一个串号，数量按 1 展示金额分摊为行单价（整行 amount/qty 即单价）。
 */

const sql = defineStatements({
  detail: `SELECT d.biz_date, d.id AS doc_id, d.doc_no, d.created_at, d.updated_at,
                  COALESCE(p.name, '') AS partner_name,
                  w.name AS warehouse_name,
                  COALESCE(c.name, '') AS category_name,
                  COALESCE(b.name, '') AS brand_name,
                  i.code AS item_code, i.name AS item_name,
                  l.id AS line_id, l.qty AS line_qty, l.unit_price, l.amount AS line_amount,
                  l.rebate_per_unit, l.rebate_amount,
                  s.serial,
                  COALESCE(cu.display_name, cu.username, '') AS created_by_name,
                  COALESCE(uu.display_name, uu.username, '') AS updated_by_name
           FROM doc_line_serial s
           JOIN doc_line l ON l.id = s.line_id
           JOIN doc d ON d.id = l.doc_id
           JOIN item i ON i.id = l.item_id
           JOIN warehouse w ON w.id = d.warehouse_id
           LEFT JOIN partner p ON p.id = d.partner_id
           LEFT JOIN item_category c ON c.id = i.category_id
           LEFT JOIN item_brand b ON b.id = i.brand_id
           LEFT JOIN user cu ON cu.id = d.created_by
           LEFT JOIN user uu ON uu.id = d.updated_by
           WHERE d.doc_type = 'PURCHASE' AND d.status = 'posted'
             AND (@from = '' OR d.biz_date >= @from)
             AND (@to = '' OR d.biz_date <= @to)
             AND (@partner = 0 OR d.partner_id = @partner)
             AND (@wh = 0 OR d.warehouse_id = @wh)
             AND (@kw = '' OR d.doc_no LIKE @like ESCAPE '\\' OR i.code LIKE @like ESCAPE '\\'
                  OR i.name LIKE @like ESCAPE '\\' OR s.serial LIKE @like ESCAPE '\\')
           ORDER BY d.biz_date DESC, d.id DESC, l.line_no, s.serial
           LIMIT @limit OFFSET @offset`,
  detailCount: `SELECT COUNT(*) AS n
                FROM doc_line_serial s
                JOIN doc_line l ON l.id = s.line_id
                JOIN doc d ON d.id = l.doc_id
                JOIN item i ON i.id = l.item_id
                WHERE d.doc_type = 'PURCHASE' AND d.status = 'posted'
                  AND (@from = '' OR d.biz_date >= @from)
                  AND (@to = '' OR d.biz_date <= @to)
                  AND (@partner = 0 OR d.partner_id = @partner)
                  AND (@wh = 0 OR d.warehouse_id = @wh)
                  AND (@kw = '' OR d.doc_no LIKE @like ESCAPE '\\' OR i.code LIKE @like ESCAPE '\\'
                       OR i.name LIKE @like ESCAPE '\\' OR s.serial LIKE @like ESCAPE '\\')`,
  lineDocType: `SELECT d.doc_type, d.status FROM doc_line l JOIN doc d ON d.id = l.doc_id WHERE l.id = ?`,
})

const likePattern = (kw: string): string => `%${kw.replace(/[\\%_]/g, (c) => '\\' + c)}%`

export const purchaseHandlers = {
  'purchase:detailList': handler('purchase:detailList', 'user', (ctx, input) => {
    const db = ctx.core.db
    const p = {
      from: input.dateFrom ?? '',
      to: input.dateTo ?? '',
      partner: input.partnerId ?? 0,
      wh: input.warehouseId ?? 0,
      kw: input.keyword,
      like: likePattern(input.keyword),
      limit: input.pageSize,
      offset: (input.page - 1) * input.pageSize,
    }
    const raw = sql(db).detail.all(p) as {
      biz_date: string
      doc_id: number
      doc_no: string
      partner_name: string
      warehouse_name: string
      category_name: string
      brand_name: string
      item_code: string
      item_name: string
      line_id: number
      line_qty: number
      unit_price: number
      line_amount: number
      rebate_per_unit: number
      rebate_amount: number
      serial: string
      created_by_name: string
      created_at: string
      updated_by_name: string
      updated_at: string
    }[]
    const rows: PurchaseDetailRow[] = raw.map((r) => ({
      bizDate: r.biz_date,
      docId: r.doc_id,
      docNo: r.doc_no,
      partnerName: r.partner_name,
      warehouseName: r.warehouse_name,
      categoryName: r.category_name,
      brandName: r.brand_name,
      itemCode: r.item_code,
      itemName: r.item_name,
      // 一行一串号：数量固定 1；金额/返利金额按「单台」展示，整行件数另给 lineQty。
      qty: 1,
      unitPrice: cents(r.unit_price),
      amount: cents(r.unit_price),
      rebatePerUnit: cents(r.rebate_per_unit),
      rebateAmount: cents(r.rebate_per_unit),
      lineQty: r.line_qty,
      serial: r.serial,
      lineId: r.line_id,
      createdByName: r.created_by_name,
      createdAt: r.created_at,
      updatedByName: r.updated_by_name,
      updatedAt: r.updated_at,
    }))
    const { limit: _l, offset: _o, ...countP } = p
    const total = (sql(db).detailCount.get(countP) as { n: number }).n
    return { rows, total }
  }),

  'purchase:updateRebate': handler('purchase:updateRebate', 'user', (ctx, input) => {
    const { db, clock } = ctx.core
    inTransaction(db, () => {
      const meta = sql(db).lineDocType.get(input.lineId) as { doc_type: string; status: string } | undefined
      ensure(meta, 'NOT_FOUND', { type: 'doc_line', id: input.lineId })
      ensure(meta.doc_type === 'PURCHASE' && meta.status === 'posted', 'DOC_STATE_INVALID', {
        status: meta.status,
        docType: meta.doc_type,
      })
      ensure(getLine(db, input.lineId), 'NOT_FOUND', { type: 'doc_line', id: input.lineId })
      updateLineRebate(db, input.lineId, input.rebatePerUnit, input.rebateAmount)
      writeOpLog(
        db,
        ctx.session.userId,
        'purchase.updateRebate',
        { lineId: input.lineId, rebatePerUnit: input.rebatePerUnit, rebateAmount: input.rebateAmount },
        null,
        clock.now(),
      )
    })
    return null
  }),
}
