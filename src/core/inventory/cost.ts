import { prorate } from '@shared/money'
import type { DB } from '../db/connection'
import { assertInTransaction } from '../db/tx'
import { BizError } from '../domain/errors'
import type { Key } from './key'

/**
 * 成本重算（设计文档第 8 节）。
 *
 * 按商品、从起点 key K 开始重放。M2 处理采购入库与销售出库；
 * 销售退货填价、采购退货扣批在 M4 接上同一重放循环即可。
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
  ref_line_id: number | null
}

/** 从一个批次取 q 件的金额（8.3）。 */
function takeAmount(remQty: number, remAmount: number, q: number): number {
  if (q <= 0 || q > remQty) throw new BizError('INTERNAL', { remQty, q }, '成本分摊数量非法')
  return q === remQty ? remAmount : prorate(remAmount, q, remQty)
}

function effectiveAmount(row: LayerRow): number {
  return row.amount - row.adj_amount
}

/**
 * 对单个商品从 key K 起重算。
 * @param reason 写入 cost_change_log 的原因
 */
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

  const cogsBefore = (
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

  // 1. 恢复 K 时刻批次剩余：key < K 的批次 − key < K 的分配。
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
      serial: row.serial,
      remQty,
      remAmount: effectiveAmount(row) - used.amount,
    })
  }

  // 2. 删除 key ≥ K 的出库分配，并把相关行的 cost_amount 清零。
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

  // 3. 按 key 重放 K 及之后的入出库事件。
  const events = db
    .prepare(
      `SELECT d.doc_type, d.biz_date, d.id AS doc_id, l.id AS line_id, l.qty, l.ref_line_id
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

  for (const ev of events) {
    if (ev.doc_type === 'PURCHASE' || ev.doc_type === 'SALE_RETURN') {
      // 批次已由 applyEffects 写入；销售退货金额可能仍为 0（M4 再填），这里按库中金额入队。
      for (const row of layersOfLine.all(ev.line_id) as LayerRow[]) {
        queue.push({
          id: row.id,
          serial: row.serial,
          remQty: row.qty,
          remAmount: effectiveAmount(row),
        })
      }
      continue
    }

    if (ev.doc_type === 'SALE') {
      const serials = (serialsOfLine.all(ev.line_id) as { serial: string }[]).map((r) => r.serial)
      let cost = 0
      if (serials.length > 0) {
        // 手机：每个串号匹配当前仍有剩余的那一个批次（D23 / R8）。
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
        // 配件：先进先出（R9），跳过串号批次。
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

    // PURCHASE_RETURN：M4 实现；M2 不应出现。
    if (ev.doc_type === 'PURCHASE_RETURN') {
      throw new BizError('INTERNAL', { lineId: ev.line_id }, '采购退货成本重放尚未实现')
    }
  }

  // 4. 销售成本变动写入日志（R22）；为 0 则跳过。
  const cogsAfter = (
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
  const delta = cogsAfter - cogsBefore
  if (delta !== 0) {
    db.prepare(
      `INSERT INTO cost_change_log
       (item_id, from_biz_date, from_doc_id, reason, cogs_delta, variance_delta, user_id, created_at)
       VALUES (?, ?, ?, ?, ?, 0, ?, ?)`,
    ).run(itemId, from.date, from.docId, reason, delta, userId, now)
  }
}
