import type { DB } from '../db/connection'
import { defineStatements } from '../db/statements'
import { BizError } from '../domain/errors'
import type { Affected } from './effects'

/**
 * 时间线检查（设计文档 7.5 / 7.6）。
 *
 * 为什么不只检查“当前结存”：允许补录早日期单据（R5）。补录一张 11-01 的出库，
 * 当天库存也许够，但会让 11-05 那张出库变成“卖了不存在的货”。只有按时间顺序回放，
 * 才能发现“某个时刻”变负。
 */

const sql = defineStatements({
  // 窗口函数按 key 求累计数量，返回第一个小于 0 的时刻。
  // 走 ix_stock_move_wh_item_key：等值过滤 + 按索引顺序读取，无需额外排序，O(该仓库该商品的流水数)。
  firstNegative: `SELECT biz_date, running FROM (
                    SELECT biz_date, SUM(qty) OVER (ORDER BY biz_date, doc_id, line_id
                                                    ROWS UNBOUNDED PRECEDING) AS running
                    FROM stock_move WHERE warehouse_id = ? AND item_id = ?
                  ) WHERE running < 0 LIMIT 1`,
  // 同一 key 内按 delta 升序：移库的 −1 先于 +1，避免“瞬间在两个仓库”的误报。
  serialMoves: `SELECT warehouse_id, item_id, biz_date, delta FROM serial_move
                WHERE serial = ? ORDER BY biz_date, doc_id, line_id, delta`,
  itemName: 'SELECT name FROM item WHERE id = ?',
  whName: 'SELECT name FROM warehouse WHERE id = ?',
})

const nameOf = (db: DB, which: 'itemName' | 'whName', id: number): string =>
  (sql(db)[which].get(id) as { name: string } | undefined)?.name ?? String(id)

/** 对每个受影响的“仓库 + 商品”检查累计数量在任何时刻都不小于 0（R4）。 */
export function checkStockTimeline(db: DB, aff: Affected): void {
  const s = sql(db)
  for (const k of aff.stock) {
    const [wh, item] = k.split(':').map(Number) as [number, number]
    const hit = s.firstNegative.get(wh, item) as { biz_date: string; running: number } | undefined
    if (hit) {
      throw new BizError('STOCK_NEGATIVE', {
        itemId: item,
        itemName: nameOf(db, 'itemName', item),
        warehouseId: wh,
        warehouseName: nameOf(db, 'whName', wh),
        date: hit.biz_date,
        qty: hit.running,
      })
    }
  }
}

/**
 * 对每个受影响的串号按 key 回放（R13）：
 * - 每个“仓库 + 商品”位置上的累计值只能是 0 或 1：小于 0 说明卖出 / 调出了一个当时不在这里的串号
 *   （也拦住了“用 A 商品入库、用 B 商品卖出”的错配）；
 * - 所有位置合计只能是 0 或 1：大于 1 说明同一串号重复入库。
 *
 * 单个串号的流水通常只有几条，在内存里回放比写一条多层窗口函数的 SQL 更清楚，开销可以忽略。
 */
export function checkSerialTimeline(db: DB, aff: Affected): void {
  const s = sql(db)
  for (const serial of aff.serials) {
    const rows = s.serialMoves.all(serial) as { warehouse_id: number; item_id: number; biz_date: string; delta: number }[]
    const atLoc = new Map<string, number>()
    let total = 0
    for (const r of rows) {
      const loc = `${r.warehouse_id}:${r.item_id}`
      const n = (atLoc.get(loc) ?? 0) + r.delta
      atLoc.set(loc, n)
      total += r.delta
      if (n < 0) {
        throw new BizError('SERIAL_NOT_AVAILABLE', {
          serial,
          warehouseId: r.warehouse_id,
          warehouseName: nameOf(db, 'whName', r.warehouse_id),
          itemId: r.item_id,
          date: r.biz_date,
        })
      }
      if (n > 1 || total > 1) throw new BizError('SERIAL_CONFLICT', { serial, date: r.biz_date })
    }
  }
}
