import type { DocType } from '@shared/dto'
import type { DB } from '../db/connection'
import { defineStatements } from '../db/statements'
import { assertInTransaction } from '../db/tx'
import { docStartKey, minKey, type Key } from './key'
import type { DocRecord, LineRecord } from './repo'

/**
 * 过账效果（设计文档 7.1）：把单据翻译成库存流水、串号流水和成本批次；反过账时原样撤销。
 *
 * 写入和撤销都只做“记账”，不做规则判断：
 * 规则检查（时间线、成本）统一在所有写入完成之后、基于最终状态一次性进行（见 service.ts），
 * 这样“修改单据 = 撤销旧效果 + 写入新效果”只需检查一次，而且检查的是最终结果，不会被中间态误判。
 */

/** 本次操作影响到的范围，供之后的时间线检查与成本重算使用。 */
export class Affected {
  /** 受影响的“仓库 + 商品”，键为 `${warehouseId}:${itemId}`。 */
  readonly stock = new Set<string>()
  readonly serials = new Set<string>()
  /** 需要重算成本的商品 → 重算起点（取所有涉及 key 中最早的一个，7.4）。 */
  readonly costFrom = new Map<number, Key>()
  /** 结存增量；时间线检查通过后才写入 stock_balance（见 flushBalances）。 */
  readonly balanceDelta = new Map<string, number>()

  touchStock(warehouseId: number, itemId: number, delta: number): void {
    const k = `${warehouseId}:${itemId}`
    this.stock.add(k)
    this.balanceDelta.set(k, (this.balanceDelta.get(k) ?? 0) + delta)
  }

  touchCost(itemId: number, from: Key): void {
    const cur = this.costFrom.get(itemId)
    this.costFrom.set(itemId, cur ? minKey(cur, from) : from)
  }
}

/** 每类单据在各仓库上的数量方向：[仓库字段, 符号]。移库一行生成两条流水（7.1）。 */
function legs(doc: DocRecord): [number, 1 | -1][] {
  switch (doc.doc_type) {
    case 'PURCHASE':
    case 'SALE_RETURN':
      return [[doc.warehouse_id, 1]]
    case 'SALE':
    case 'PURCHASE_RETURN':
      return [[doc.warehouse_id, -1]]
    case 'TRANSFER':
      // 调出在前、调入在后：同一 key 内先 −1 后 +1，串号合计在任何瞬间都不会出现 2。
      return [
        [doc.warehouse_id, -1],
        [doc.to_warehouse_id!, 1],
      ]
  }
}

/** 会产生成本批次的单据（8.1）。 */
const CREATES_LAYER: ReadonlySet<DocType> = new Set(['PURCHASE', 'SALE_RETURN'])

const sql = defineStatements({
  insertMove: `INSERT INTO stock_move (doc_id, line_id, item_id, warehouse_id, biz_date, qty)
               VALUES (?, ?, ?, ?, ?, ?)`,
  insertSerialMove: `INSERT INTO serial_move (serial, item_id, warehouse_id, biz_date, doc_id, line_id, delta)
                     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  // 采购批次金额在写入时即确定；销售退货批次金额先写 0，由成本引擎在重放时按原销售成本填入（8.5）。
  insertLayer: `INSERT INTO cost_layer (item_id, source_line_id, serial, biz_date, doc_id, qty, amount)
                VALUES (?, ?, ?, ?, ?, ?, ?)`,
  movesByDoc: 'SELECT warehouse_id, item_id, qty FROM stock_move WHERE doc_id = ?',
  serialsByDoc: 'SELECT DISTINCT serial FROM serial_move WHERE doc_id = ?',
  deleteAllocs: 'DELETE FROM cost_alloc WHERE line_id IN (SELECT id FROM doc_line WHERE doc_id = ?)',
  deleteLayers: 'DELETE FROM cost_layer WHERE source_line_id IN (SELECT id FROM doc_line WHERE doc_id = ?)',
  deleteMoves: 'DELETE FROM stock_move WHERE doc_id = ?',
  deleteSerialMoves: 'DELETE FROM serial_move WHERE doc_id = ?',
  resetCost: 'UPDATE doc_line SET cost_amount = 0 WHERE doc_id = ?',
  upsertBalance: `INSERT INTO stock_balance (warehouse_id, item_id, qty) VALUES (?, ?, ?)
                  ON CONFLICT (warehouse_id, item_id) DO UPDATE SET qty = qty + excluded.qty`,
  decBalance: 'UPDATE stock_balance SET qty = qty + ? WHERE warehouse_id = ? AND item_id = ?',
})

/** 写入一张单据的全部过账效果。 */
export function applyEffects(
  db: DB,
  doc: DocRecord,
  lines: LineRecord[],
  serials: Map<number, string[]>,
  aff: Affected,
): void {
  assertInTransaction(db)
  const s = sql(db)
  const start = docStartKey(doc.biz_date, doc.id)
  const makesLayer = CREATES_LAYER.has(doc.doc_type)

  for (const line of lines) {
    const lineSerials = serials.get(line.id) ?? []
    for (const [wh, sign] of legs(doc)) {
      s.insertMove.run(doc.id, line.id, line.item_id, wh, doc.biz_date, sign * line.qty)
      aff.touchStock(wh, line.item_id, sign * line.qty)
      for (const sn of lineSerials) {
        s.insertSerialMove.run(sn, line.item_id, wh, doc.biz_date, doc.id, line.id, sign)
        aff.serials.add(sn)
      }
    }

    if (makesLayer) {
      if (lineSerials.length > 0) {
        // 手机：每个串号一个数量为 1 的批次（D23），采购批次金额 = 单价。
        const unit = doc.doc_type === 'PURCHASE' ? line.unit_price : 0
        for (const sn of lineSerials) s.insertLayer.run(line.item_id, line.id, sn, doc.biz_date, doc.id, 1, unit)
      } else {
        const amount = doc.doc_type === 'PURCHASE' ? line.amount : 0
        s.insertLayer.run(line.item_id, line.id, null, doc.biz_date, doc.id, line.qty, amount)
      }
    }
    // 移库不影响成本（R11），其余单据都要从本单起点重算该商品。
    if (doc.doc_type !== 'TRANSFER') aff.touchCost(line.item_id, start)
  }
}

/** 撤销一张单据的全部过账效果（7.3 第 4 步），并记录受影响范围。 */
export function removeEffects(db: DB, doc: DocRecord, lines: LineRecord[], aff: Affected): void {
  assertInTransaction(db)
  const s = sql(db)
  for (const m of s.movesByDoc.all(doc.id) as { warehouse_id: number; item_id: number; qty: number }[]) {
    aff.touchStock(m.warehouse_id, m.item_id, -m.qty)
  }
  for (const r of s.serialsByDoc.all(doc.id) as { serial: string }[]) aff.serials.add(r.serial)
  if (doc.doc_type !== 'TRANSFER') {
    const start = docStartKey(doc.biz_date, doc.id)
    for (const l of lines) aff.touchCost(l.item_id, start)
  }
  // 删除批次会级联删除其他出库行对它的分配；那些出库行的 key 都晚于本单，会在重算时重新分配。
  s.deleteAllocs.run(doc.id)
  s.deleteLayers.run(doc.id)
  s.deleteMoves.run(doc.id)
  s.deleteSerialMoves.run(doc.id)
  s.resetCost.run(doc.id)
}

/**
 * 把累积的结存增量写入 stock_balance。
 * 必须在时间线检查通过之后调用：最终结存 = 全部流水之和 ≥ 0 已由时间线检查保证，
 * 这样 `CHECK (qty >= 0)` 只作为最后一道保险，不会抢先抛出含义模糊的约束错误。
 */
export function flushBalances(db: DB, aff: Affected): void {
  const s = sql(db)
  for (const [k, delta] of aff.balanceDelta) {
    if (delta === 0) continue
    const [wh, item] = k.split(':').map(Number) as [number, number]
    // SQLite 先检查 CHECK 再判断 UPSERT 冲突：负增量走 INSERT 会因 qty<0 直接失败，所以减少时用 UPDATE。
    // 减少意味着此前一定有正的流水，结存行必然已存在。
    if (delta > 0) s.upsertBalance.run(wh, item, delta)
    else s.decBalance.run(delta, wh, item)
  }
}
