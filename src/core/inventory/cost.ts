import { prorate } from '@shared/money'
import type { DB } from '../db/connection'
import { assertInTransaction } from '../db/tx'
import { BizError } from '../domain/errors'
import type { Key } from './key'

/**
 * 成本重算（设计文档第 8 节）：按商品从 key K 重放采购/销售/退货。
 */

interface LayerRow {
  id: number
  source_line_id: number
  serial: string | null
  biz_date: string
  doc_id: number
  qty: number
  amount: number
  adj_amount: number
}

interface LayerState {
  id: number
  sourceLineId: number
  serial: string | null
  remQty: number
  remAmount: number
}

interface EventRow {
  doc_type: string
  biz_date: string
  doc_id: number
  line_id: number
  qty: number
  amount: number
  ref_line_id: number | null
}

function takeAmount(remQty: number, remAmount: number, q: number): number {
  if (q <= 0 || q > remQty) throw new BizError('INTERNAL', { remQty, q }, '成本分摊数量非法')
  return q === remQty ? remAmount : prorate(remAmount, q, remQty)
}

function effectiveAmount(row: LayerRow): number {
  return row.amount - row.adj_amount
}

function cogsOf(db: DB, itemId: number): number {
  return (
    db
      .prepare(
        `SELECT COALESCE(SUM(CASE d.doc_type
             WHEN 'SALE' THEN l.cost_amount
             WHEN 'SALE_RETURN' THEN -l.cost_amount
             ELSE 0 END), 0) AS v
         FROM doc_line l JOIN doc d ON d.id = l.doc_id
         WHERE l.item_id = ? AND d.status = 'posted'`,
      )
      .get(itemId) as { v: number }
  ).v
}

/** 采购退货成本差异合计 = amount − cost_amount（8.4 / 8.7）。 */
function varianceOf(db: DB, itemId: number): number {
  return (
    db
      .prepare(
        `SELECT COALESCE(SUM(l.amount - l.cost_amount), 0) AS v
         FROM doc_line l JOIN doc d ON d.id = l.doc_id
         WHERE l.item_id = ? AND d.status = 'posted' AND d.doc_type = 'PURCHASE_RETURN'`,
      )
      .get(itemId) as { v: number }
  ).v
}

/**
 * 销售退货退回成本（8.5）：按原销售行未退成本比例分摊。
 * 只统计 key 小于本次退货的已过账退货。
 */
function saleReturnCost(db: DB, refLineId: number, qty: number, at: Key): number {
  const orig = db.prepare('SELECT qty, cost_amount FROM doc_line WHERE id = ?').get(refLineId) as
    | { qty: number; cost_amount: number }
    | undefined
  if (!orig) throw new BizError('INTERNAL', { refLineId }, '销售退货找不到原销售行')

  const prev = db
    .prepare(
      `SELECT COALESCE(SUM(l.qty), 0) AS qty, COALESCE(SUM(l.cost_amount), 0) AS cost
       FROM doc_line l
       JOIN doc d ON d.id = l.doc_id
       WHERE l.ref_line_id = @refLineId AND d.status = 'posted' AND d.doc_type = 'SALE_RETURN'
         AND (d.biz_date < @d OR (d.biz_date = @d AND d.id < @doc)
              OR (d.biz_date = @d AND d.id = @doc AND l.id < @line))`,
    )
    .get({ refLineId, d: at.date, doc: at.docId, line: at.lineId }) as { qty: number; cost: number }

  const remainQty = orig.qty - prev.qty
  const remainCost = orig.cost_amount - prev.cost
  if (qty > remainQty || remainQty <= 0) {
    throw new BizError('INTERNAL', { refLineId, qty, remainQty }, '销售退货可退成本不足')
  }
  return qty === remainQty ? remainCost : prorate(remainCost, qty, remainQty)
}

export function recalculateItem(
  db: DB,
  itemId: number,
  from: Key,
  userId: number | null,
  now: string,
  reason: string,
): void {
  assertInTransaction(db)
  const p = { itemId, d: from.date, doc: from.docId, line: from.lineId }
  const cogsBefore = cogsOf(db, itemId)
  const varianceBefore = varianceOf(db, itemId)

  const earlyLayers = db
    .prepare(
      `SELECT * FROM cost_layer
       WHERE item_id = @itemId
         AND (biz_date < @d OR (biz_date = @d AND doc_id < @doc)
              OR (biz_date = @d AND doc_id = @doc AND source_line_id < @line))
       ORDER BY biz_date, doc_id, source_line_id`,
    )
    .all(p) as LayerRow[]

  const allocStmt = db.prepare(
    `SELECT COALESCE(SUM(a.qty), 0) AS qty, COALESCE(SUM(a.amount), 0) AS amount
     FROM cost_alloc a
     JOIN doc_line l ON l.id = a.line_id
     JOIN doc d ON d.id = l.doc_id
     WHERE a.layer_id = @layerId
       AND (d.biz_date < @d OR (d.biz_date = @d AND d.id < @doc)
            OR (d.biz_date = @d AND d.id = @doc AND l.id < @line))`,
  )

  const queue: LayerState[] = []
  for (const row of earlyLayers) {
    const used = allocStmt.get({ ...p, layerId: row.id }) as { qty: number; amount: number }
    const remQty = row.qty - used.qty
    if (remQty <= 0) continue
    queue.push({
      id: row.id,
      sourceLineId: row.source_line_id,
      serial: row.serial,
      remQty,
      remAmount: effectiveAmount(row) - used.amount,
    })
  }

  db.prepare(
    `DELETE FROM cost_alloc WHERE line_id IN (
       SELECT l.id FROM doc_line l
       JOIN doc d ON d.id = l.doc_id
       WHERE l.item_id = @itemId
         AND d.doc_type IN ('SALE', 'PURCHASE_RETURN')
         AND (d.biz_date > @d OR (d.biz_date = @d AND d.id > @doc)
              OR (d.biz_date = @d AND d.id = @doc AND l.id >= @line))
     )`,
  ).run(p)

  db.prepare(
    `UPDATE doc_line SET cost_amount = 0 WHERE id IN (
       SELECT l.id FROM doc_line l
       JOIN doc d ON d.id = l.doc_id
       WHERE l.item_id = @itemId
         AND d.doc_type IN ('SALE', 'PURCHASE_RETURN', 'SALE_RETURN')
         AND (d.biz_date > @d OR (d.biz_date = @d AND d.id > @doc)
              OR (d.biz_date = @d AND d.id = @doc AND l.id >= @line))
     )`,
  ).run(p)

  const events = db
    .prepare(
      `SELECT d.doc_type, d.biz_date, d.id AS doc_id, l.id AS line_id, l.qty, l.amount, l.ref_line_id
       FROM doc_line l
       JOIN doc d ON d.id = l.doc_id
       WHERE l.item_id = @itemId AND d.status = 'posted'
         AND d.doc_type IN ('PURCHASE', 'SALE', 'PURCHASE_RETURN', 'SALE_RETURN')
         AND (d.biz_date > @d OR (d.biz_date = @d AND d.id > @doc)
              OR (d.biz_date = @d AND d.id = @doc AND l.id >= @line))
       ORDER BY d.biz_date, d.id, l.id`,
    )
    .all(p) as EventRow[]

  const layersOfLine = db.prepare('SELECT * FROM cost_layer WHERE source_line_id = ? ORDER BY id')
  const serialsOfLine = db.prepare('SELECT serial FROM doc_line_serial WHERE line_id = ?')
  const insertAlloc = db.prepare('INSERT INTO cost_alloc (line_id, layer_id, qty, amount) VALUES (?, ?, ?, ?)')
  const setCost = db.prepare('UPDATE doc_line SET cost_amount = ? WHERE id = ?')
  const setLayerAmount = db.prepare('UPDATE cost_layer SET amount = ? WHERE id = ?')

  for (const ev of events) {
    const key: Key = { date: ev.biz_date, docId: ev.doc_id, lineId: ev.line_id }

    if (ev.doc_type === 'PURCHASE') {
      for (const row of layersOfLine.all(ev.line_id) as LayerRow[]) {
        queue.push({
          id: row.id,
          sourceLineId: row.source_line_id,
          serial: row.serial,
          remQty: row.qty,
          remAmount: effectiveAmount(row),
        })
      }
      continue
    }

    if (ev.doc_type === 'SALE_RETURN') {
      // 8.5：按原销售成本填批次金额，再入队。
      if (!ev.ref_line_id) throw new BizError('INTERNAL', { lineId: ev.line_id }, '销售退货缺少原单行')
      const totalCost = saleReturnCost(db, ev.ref_line_id, ev.qty, key)
      const layers = layersOfLine.all(ev.line_id) as LayerRow[]
      if (layers.length === 0) throw new BizError('INTERNAL', { lineId: ev.line_id }, '销售退货缺少批次')

      // 手机：每个串号一层 qty=1，按件分摊；配件：一层拿走全部退回成本。最后一层吃掉尾差。
      let assigned = 0
      for (let i = 0; i < layers.length; i++) {
        const row = layers[i]!
        const isLast = i === layers.length - 1
        const amt = isLast ? totalCost - assigned : prorate(totalCost, row.qty, ev.qty)
        setLayerAmount.run(amt, row.id)
        assigned += amt
        queue.push({
          id: row.id,
          sourceLineId: row.source_line_id,
          serial: row.serial,
          remQty: row.qty,
          remAmount: amt,
        })
      }
      setCost.run(totalCost, ev.line_id)
      continue
    }

    if (ev.doc_type === 'SALE') {
      const serials = (serialsOfLine.all(ev.line_id) as { serial: string }[]).map((r) => r.serial)
      let cost = 0
      if (serials.length > 0) {
        for (const sn of serials) {
          const layer = queue.find((x) => x.serial === sn && x.remQty > 0)
          if (!layer) throw new BizError('INTERNAL', { serial: sn, lineId: ev.line_id }, '串号批次不足')
          const amt = takeAmount(layer.remQty, layer.remAmount, 1)
          insertAlloc.run(ev.line_id, layer.id, 1, amt)
          layer.remQty -= 1
          layer.remAmount -= amt
          cost += amt
        }
      } else {
        let need = ev.qty
        for (const layer of queue) {
          if (need <= 0) break
          if (layer.serial !== null || layer.remQty <= 0) continue
          const q = Math.min(need, layer.remQty)
          const amt = takeAmount(layer.remQty, layer.remAmount, q)
          insertAlloc.run(ev.line_id, layer.id, q, amt)
          layer.remQty -= q
          layer.remAmount -= amt
          cost += amt
          need -= q
        }
        if (need > 0) throw new BizError('INTERNAL', { itemId, lineId: ev.line_id, need }, '先进先出批次不足')
      }
      setCost.run(cost, ev.line_id)
      continue
    }

    if (ev.doc_type === 'PURCHASE_RETURN') {
      // 8.4：先扣原采购批次，再 FIFO。
      if (!ev.ref_line_id) throw new BizError('INTERNAL', { lineId: ev.line_id }, '采购退货缺少原单行')
      const serials = (serialsOfLine.all(ev.line_id) as { serial: string }[]).map((r) => r.serial)
      let cost = 0
      if (serials.length > 0) {
        for (const sn of serials) {
          const layer = queue.find((x) => x.serial === sn && x.sourceLineId === ev.ref_line_id && x.remQty > 0)
          if (!layer) throw new BizError('INTERNAL', { serial: sn }, '采购退货串号批次不足')
          const amt = takeAmount(layer.remQty, layer.remAmount, 1)
          insertAlloc.run(ev.line_id, layer.id, 1, amt)
          layer.remQty -= 1
          layer.remAmount -= amt
          cost += amt
        }
      } else {
        let need = ev.qty
        // 先扣原采购行批次。
        for (const layer of queue) {
          if (need <= 0) break
          if (layer.sourceLineId !== ev.ref_line_id || layer.serial !== null || layer.remQty <= 0) continue
          const q = Math.min(need, layer.remQty)
          const amt = takeAmount(layer.remQty, layer.remAmount, q)
          insertAlloc.run(ev.line_id, layer.id, q, amt)
          layer.remQty -= q
          layer.remAmount -= amt
          cost += amt
          need -= q
        }
        // 不够再 FIFO。
        for (const layer of queue) {
          if (need <= 0) break
          if (layer.serial !== null || layer.remQty <= 0) continue
          const q = Math.min(need, layer.remQty)
          const amt = takeAmount(layer.remQty, layer.remAmount, q)
          insertAlloc.run(ev.line_id, layer.id, q, amt)
          layer.remQty -= q
          layer.remAmount -= amt
          cost += amt
          need -= q
        }
        if (need > 0) throw new BizError('INTERNAL', { lineId: ev.line_id, need }, '采购退货批次不足')
      }
      setCost.run(cost, ev.line_id)
    }
  }

  const cogsDelta = cogsOf(db, itemId) - cogsBefore
  const varianceDelta = varianceOf(db, itemId) - varianceBefore
  if (cogsDelta !== 0 || varianceDelta !== 0) {
    db.prepare(
      `INSERT INTO cost_change_log
       (item_id, from_biz_date, from_doc_id, reason, cogs_delta, variance_delta, user_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(itemId, from.date, from.docId, reason, cogsDelta, varianceDelta, userId, now)
  }
}
