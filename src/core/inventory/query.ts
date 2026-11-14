import type { DocDetail, DocLineDto, DocSummary, Role } from '@shared/dto'
import { cents } from '@shared/money'
import type { DB } from '../db/connection'
import { defineStatements } from '../db/statements'
import { ensure } from '../domain/errors'
import { getDoc, getDocSerials, getLines } from './repo'

const sql = defineStatements({
  list: `SELECT d.*, w.name AS warehouse_name, tw.name AS to_warehouse_name,
            p.name AS partner_name, rd.doc_no AS ref_doc_no, u.display_name AS created_by_name,
            (SELECT COALESCE(SUM(qty), 0) FROM doc_line WHERE doc_id = d.id) AS total_qty,
            (SELECT COALESCE(SUM(amount), 0) FROM doc_line WHERE doc_id = d.id) AS total_amount,
            (SELECT COALESCE(SUM(cost_amount), 0) FROM doc_line WHERE doc_id = d.id) AS total_cost
          FROM doc d
          JOIN warehouse w ON w.id = d.warehouse_id
          LEFT JOIN warehouse tw ON tw.id = d.to_warehouse_id
          LEFT JOIN partner p ON p.id = d.partner_id
          LEFT JOIN doc rd ON rd.id = d.ref_doc_id
          JOIN user u ON u.id = d.created_by
          WHERE (@docType = '' OR d.doc_type = @docType)
            AND (@status = '' OR d.status = @status)
            AND (@dateFrom = '' OR d.biz_date >= @dateFrom)
            AND (@dateTo = '' OR d.biz_date <= @dateTo)
            AND (@partnerId = 0 OR d.partner_id = @partnerId)
            AND (@warehouseId = 0 OR d.warehouse_id = @warehouseId OR d.to_warehouse_id = @warehouseId)
            AND (@kw = '' OR d.doc_no LIKE @like ESCAPE '\\' OR d.remark LIKE @like ESCAPE '\\')
          ORDER BY d.biz_date DESC, d.id DESC
          LIMIT @limit OFFSET @offset`,
  count: `SELECT COUNT(*) AS n FROM doc d
          WHERE (@docType = '' OR d.doc_type = @docType)
            AND (@status = '' OR d.status = @status)
            AND (@dateFrom = '' OR d.biz_date >= @dateFrom)
            AND (@dateTo = '' OR d.biz_date <= @dateTo)
            AND (@partnerId = 0 OR d.partner_id = @partnerId)
            AND (@warehouseId = 0 OR d.warehouse_id = @warehouseId OR d.to_warehouse_id = @warehouseId)
            AND (@kw = '' OR d.doc_no LIKE @like ESCAPE '\\' OR d.remark LIKE @like ESCAPE '\\')`,
  item: 'SELECT code, name, spec, unit, serial_managed FROM item WHERE id = ?',
  whName: 'SELECT name FROM warehouse WHERE id = ?',
  partnerName: 'SELECT name FROM partner WHERE id = ?',
  userName: 'SELECT display_name, username FROM user WHERE id = ?',
  refNo: 'SELECT doc_no FROM doc WHERE id = ?',
})

interface ListRow {
  id: number
  doc_no: string
  doc_type: DocSummary['docType']
  biz_date: string
  status: DocSummary['status']
  warehouse_id: number
  warehouse_name: string
  to_warehouse_id: number | null
  to_warehouse_name: string | null
  partner_id: number | null
  partner_name: string | null
  ref_doc_id: number | null
  ref_doc_no: string | null
  remark: string
  total_qty: number
  total_amount: number
  total_cost: number
  created_by_name: string
  created_at: string
  posted_at: string | null
}

function toSummary(r: ListRow, role: Role): DocSummary {
  const base: DocSummary = {
    id: r.id,
    docNo: r.doc_no,
    docType: r.doc_type,
    bizDate: r.biz_date,
    status: r.status,
    warehouseId: r.warehouse_id,
    warehouseName: r.warehouse_name,
    toWarehouseId: r.to_warehouse_id,
    toWarehouseName: r.to_warehouse_name,
    partnerId: r.partner_id,
    partnerName: r.partner_name,
    refDocId: r.ref_doc_id,
    refDocNo: r.ref_doc_no,
    remark: r.remark,
    totalQty: r.total_qty,
    totalAmount: cents(r.total_amount),
    createdByName: r.created_by_name || '',
    createdAt: r.created_at,
    postedAt: r.posted_at,
  }
  // R21：店员查询结果不返回成本字段（不是返回 0）。
  if (role === 'owner') base.totalCost = cents(r.total_cost)
  return base
}

const likePattern = (kw: string): string => `%${kw.replace(/[\\%_]/g, (c) => '\\' + c)}%`

export function listDocs(
  db: DB,
  role: Role,
  q: {
    docType?: string
    status?: string
    dateFrom?: string
    dateTo?: string
    partnerId?: number
    warehouseId?: number
    keyword: string
    page: number
    pageSize: number
  },
): { rows: DocSummary[]; total: number } {
  const p = {
    docType: q.docType ?? '',
    status: q.status ?? '',
    dateFrom: q.dateFrom ?? '',
    dateTo: q.dateTo ?? '',
    partnerId: q.partnerId ?? 0,
    warehouseId: q.warehouseId ?? 0,
    kw: q.keyword,
    like: likePattern(q.keyword),
    limit: q.pageSize,
    offset: (q.page - 1) * q.pageSize,
  }
  const rows = (sql(db).list.all(p) as ListRow[]).map((r) => toSummary(r, role))
  const { limit: _l, offset: _o, ...cp } = p
  const total = (sql(db).count.get(cp) as { n: number }).n
  return { rows, total }
}

export function getDocDetail(db: DB, id: number, role: Role): DocDetail {
  const doc = getDoc(db, id)
  ensure(doc, 'NOT_FOUND', { type: 'doc', id })
  const s = sql(db)
  const wh = s.whName.get(doc.warehouse_id) as { name: string }
  const toWh = doc.to_warehouse_id
    ? (s.whName.get(doc.to_warehouse_id) as { name: string } | undefined)
    : undefined
  const partner = doc.partner_id
    ? (s.partnerName.get(doc.partner_id) as { name: string } | undefined)
    : undefined
  const user = s.userName.get(doc.created_by) as { display_name: string; username: string }
  const ref = doc.ref_doc_id ? (s.refNo.get(doc.ref_doc_id) as { doc_no: string } | undefined) : undefined
  const lines = getLines(db, id)
  const serials = getDocSerials(db, id)

  let totalQty = 0
  let totalAmount = 0
  let totalCost = 0
  const lineDtos: DocLineDto[] = lines.map((l) => {
    const item = s.item.get(l.item_id) as {
      code: string
      name: string
      spec: string
      unit: string
      serial_managed: number
    }
    totalQty += l.qty
    totalAmount += l.amount
    totalCost += l.cost_amount
    const dto: DocLineDto = {
      id: l.id,
      lineNo: l.line_no,
      itemId: l.item_id,
      itemCode: item.code,
      itemName: item.name,
      itemSpec: item.spec,
      unit: item.unit,
      serialManaged: item.serial_managed === 1,
      qty: l.qty,
      unitPrice: cents(l.unit_price),
      amount: cents(l.amount),
      refLineId: l.ref_line_id,
      remark: l.remark,
      serials: serials.get(l.id) ?? [],
    }
    if (role === 'owner') dto.costAmount = cents(l.cost_amount)
    return dto
  })

  const summary = toSummary(
    {
      id: doc.id,
      doc_no: doc.doc_no,
      doc_type: doc.doc_type,
      biz_date: doc.biz_date,
      status: doc.status,
      warehouse_id: doc.warehouse_id,
      warehouse_name: wh.name,
      to_warehouse_id: doc.to_warehouse_id,
      to_warehouse_name: toWh?.name ?? null,
      partner_id: doc.partner_id,
      partner_name: partner?.name ?? null,
      ref_doc_id: doc.ref_doc_id,
      ref_doc_no: ref?.doc_no ?? null,
      remark: doc.remark,
      total_qty: totalQty,
      total_amount: totalAmount,
      total_cost: totalCost,
      created_by_name: user.display_name || user.username,
      created_at: doc.created_at,
      posted_at: doc.posted_at,
    },
    role,
  )
  return { ...summary, lines: lineDtos }
}
