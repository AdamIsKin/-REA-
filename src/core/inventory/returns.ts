import type { DocSummary, Returnable, ReturnableLine, Role } from '@shared/dto'
import type { DB } from '../db/connection'
import { ensure } from '../domain/errors'
import { getDocDetail } from './query'

/**
 * 退货可退查询与按串号找原单（R14 / R18）。
 */

export function getReturnable(db: DB, refDocId: number, role: Role): Returnable {
  const refDoc = getDocDetail(db, refDocId, role)
  ensure(
    refDoc.docType === 'PURCHASE' || refDoc.docType === 'SALE',
    'VALIDATION_FAILED',
    { docType: refDoc.docType },
    '只能对采购入库或销售出库做退货',
  )
  ensure(refDoc.status === 'posted', 'DOC_STATE_INVALID', { status: refDoc.status }, '原单必须已过账')

  const returnedQty = db.prepare(
    `SELECT l.ref_line_id AS id, COALESCE(SUM(l.qty), 0) AS qty
     FROM doc_line l JOIN doc d ON d.id = l.doc_id
     WHERE d.ref_doc_id = ? AND d.status = 'posted' AND l.ref_line_id IS NOT NULL
     GROUP BY l.ref_line_id`,
  )
  const usedMap = new Map(
    (returnedQty.all(refDocId) as { id: number; qty: number }[]).map((r) => [r.id, r.qty]),
  )

  const returnedSerials = db.prepare(
    `SELECT s.serial
     FROM doc_line_serial s
     JOIN doc_line l ON l.id = s.line_id
     JOIN doc d ON d.id = l.doc_id
     WHERE l.ref_line_id = ? AND d.status = 'posted'`,
  )

  const lines: ReturnableLine[] = refDoc.lines.map((l) => {
    const returned = usedMap.get(l.id) ?? 0
    const usedSn = new Set((returnedSerials.all(l.id) as { serial: string }[]).map((r) => r.serial))
    return {
      refLineId: l.id,
      lineNo: l.lineNo,
      itemId: l.itemId,
      itemCode: l.itemCode,
      itemName: l.itemName,
      itemSpec: l.itemSpec,
      unit: l.unit,
      serialManaged: l.serialManaged,
      qty: l.qty,
      returnedQty: returned,
      availableQty: l.qty - returned,
      unitPrice: l.unitPrice,
      availableSerials: l.serials.filter((s) => !usedSn.has(s)),
    }
  })

  const { lines: _ignored, ...summary } = refDoc
  return { refDoc: summary as DocSummary, lines }
}

/** 在已过账的采购/销售单中找最近一次包含该串号的行（手机退货扫码用）。 */
export function findDocBySerial(
  db: DB,
  serial: string,
  docType: 'PURCHASE' | 'SALE',
): { docId: number; docNo: string; lineId: number } | null {
  const row = db
    .prepare(
      `SELECT d.id AS docId, d.doc_no AS docNo, l.id AS lineId
       FROM doc_line_serial s
       JOIN doc_line l ON l.id = s.line_id
       JOIN doc d ON d.id = l.doc_id
       WHERE s.serial = ? AND d.doc_type = ? AND d.status = 'posted'
       ORDER BY d.biz_date DESC, d.id DESC
       LIMIT 1`,
    )
    .get(serial, docType) as { docId: number; docNo: string; lineId: number } | undefined
  return row ?? null
}
