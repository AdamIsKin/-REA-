import type { DocStatus, DocType } from '@shared/dto'
import type { DB } from '../db/connection'
import { defineStatements } from '../db/statements'

/** 单据头、明细、串号的数据库读写。只做数据搬运，不含业务规则。 */

export interface DocRecord {
  id: number
  doc_no: string
  doc_type: DocType
  biz_date: string
  warehouse_id: number
  to_warehouse_id: number | null
  partner_id: number | null
  ref_doc_id: number | null
  status: DocStatus
  remark: string
  created_by: number
  updated_by: number
  created_at: string
  updated_at: string
  posted_at: string | null
}

export interface LineRecord {
  id: number
  doc_id: number
  line_no: number
  item_id: number
  qty: number
  unit_price: number
  amount: number
  ref_line_id: number | null
  cost_amount: number
  remark: string
}

/** 已规范化、准备写入的明细（金额已按规则算好）。 */
export interface LineWrite {
  lineNo: number
  itemId: number
  qty: number
  unitPrice: number
  amount: number
  refLineId: number | null
  remark: string
  serials: string[]
}

export interface HeaderWrite {
  docType: DocType
  bizDate: string
  warehouseId: number
  toWarehouseId: number | null
  partnerId: number | null
  refDocId: number | null
  remark: string
}

const sql = defineStatements({
  docById: 'SELECT * FROM doc WHERE id = ?',
  linesByDoc: 'SELECT * FROM doc_line WHERE doc_id = ? ORDER BY line_no',
  lineById: 'SELECT * FROM doc_line WHERE id = ?',
  // doc_line_serial 是 WITHOUT ROWID，不能按 rowid 排序；按 (line_id, serial) 即可稳定输出。
  serialsByDoc: `SELECT s.line_id, s.serial FROM doc_line_serial s
                 JOIN doc_line l ON l.id = s.line_id
                 WHERE l.doc_id = ? ORDER BY s.line_id, s.serial`,
  serialsByLine: 'SELECT serial FROM doc_line_serial WHERE line_id = ?',
  insertDoc: `INSERT INTO doc (doc_no, doc_type, biz_date, warehouse_id, to_warehouse_id, partner_id, ref_doc_id,
                status, remark, created_by, updated_by, created_at, updated_at)
              VALUES (@docNo, @docType, @bizDate, @warehouseId, @toWarehouseId, @partnerId, @refDocId,
                'draft', @remark, @userId, @userId, @now, @now)`,
  updateHeader: `UPDATE doc SET biz_date = @bizDate, warehouse_id = @warehouseId, to_warehouse_id = @toWarehouseId,
                   partner_id = @partnerId, remark = @remark, updated_by = @userId, updated_at = @now
                 WHERE id = @id`,
  setPosted: "UPDATE doc SET status = 'posted', posted_at = ? WHERE id = ?",
  setDraft: "UPDATE doc SET status = 'draft', posted_at = NULL, updated_by = ?, updated_at = ? WHERE id = ?",
  deleteLines: 'DELETE FROM doc_line WHERE doc_id = ?',
  insertLine: `INSERT INTO doc_line (doc_id, line_no, item_id, qty, unit_price, amount, ref_line_id, remark)
               VALUES (@docId, @lineNo, @itemId, @qty, @unitPrice, @amount, @refLineId, @remark)`,
  insertSerial: 'INSERT INTO doc_line_serial (line_id, serial) VALUES (?, ?)',
})

export const getDoc = (db: DB, id: number): DocRecord | undefined => sql(db).docById.get(id) as DocRecord | undefined

export const getLines = (db: DB, docId: number): LineRecord[] => sql(db).linesByDoc.all(docId) as LineRecord[]

export const getLine = (db: DB, id: number): LineRecord | undefined => sql(db).lineById.get(id) as LineRecord | undefined

export const getLineSerials = (db: DB, lineId: number): string[] =>
  (sql(db).serialsByLine.all(lineId) as { serial: string }[]).map((r) => r.serial)

/** 一次查询取整张单据的串号，按行分组；避免每行一次查询（N+1）。 */
export function getDocSerials(db: DB, docId: number): Map<number, string[]> {
  const map = new Map<number, string[]>()
  for (const r of sql(db).serialsByDoc.all(docId) as { line_id: number; serial: string }[]) {
    let list = map.get(r.line_id)
    if (!list) map.set(r.line_id, (list = []))
    list.push(r.serial)
  }
  return map
}

export function insertDoc(db: DB, docNo: string, h: HeaderWrite, userId: number, now: string): number {
  return Number(sql(db).insertDoc.run({ ...h, docNo, userId, now }).lastInsertRowid)
}

export function updateHeader(db: DB, id: number, h: HeaderWrite, userId: number, now: string): void {
  sql(db).updateHeader.run({ ...h, id, userId, now })
}

/** 替换全部明细：先删（串号、成本分配随外键级联删除）再插。修改单据时行 id 会变，但单据 id 不变，排序位置不变。 */
export function replaceLines(db: DB, docId: number, lines: LineWrite[]): void {
  const s = sql(db)
  s.deleteLines.run(docId)
  for (const l of lines) {
    const lineId = Number(s.insertLine.run({ ...l, docId }).lastInsertRowid)
    for (const serial of l.serials) s.insertSerial.run(lineId, serial)
  }
}

export const markPosted = (db: DB, id: number, now: string): void => void sql(db).setPosted.run(now, id)

export const markDraft = (db: DB, id: number, userId: number, now: string): void =>
  void sql(db).setDraft.run(userId, now, id)
