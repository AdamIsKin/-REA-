import type { ProfitReport, ProfitRow, SerialTrace, StockMoveRow, StockRow } from '@shared/dto'
import { cents } from '@shared/money'
import { defineStatements } from '../db/statements'
import { handler } from '../rpc'

/**
 * 只读查询（设计文档 M5 / R21）：店员结果不返回成本与库存金额字段。
 */

const sql = defineStatements({
  stockList: `SELECT b.warehouse_id, w.name AS warehouse_name, b.item_id, i.code AS item_code,
                     i.name AS item_name, i.spec AS item_spec, i.unit, i.serial_managed, b.qty
              FROM stock_balance b
              JOIN warehouse w ON w.id = b.warehouse_id
              JOIN item i ON i.id = b.item_id
              WHERE (@wh = 0 OR b.warehouse_id = @wh)
                AND (@onlyPos = 0 OR b.qty > 0)
                AND (@kw = '' OR i.code LIKE @like ESCAPE '\\' OR i.name LIKE @like ESCAPE '\\'
                     OR i.barcode LIKE @like ESCAPE '\\' OR i.spec LIKE @like ESCAPE '\\')
              ORDER BY i.code, w.code`,
  // 商品维度库存金额 = 各批次剩余金额（不分仓库，R10/U9）。
  layerRemain: `SELECT cl.item_id AS item_id,
                  (cl.amount - cl.adj_amount) - COALESCE(SUM(a.amount), 0) AS rem
                FROM cost_layer cl
                LEFT JOIN cost_alloc a ON a.layer_id = cl.id
                GROUP BY cl.id`,
  moves: `SELECT m.id, m.biz_date, m.doc_id, d.doc_no, d.doc_type, m.warehouse_id, w.name AS warehouse_name,
                 m.item_id, i.code AS item_code, i.name AS item_name, m.qty
          FROM stock_move m
          JOIN doc d ON d.id = m.doc_id
          JOIN warehouse w ON w.id = m.warehouse_id
          JOIN item i ON i.id = m.item_id
          WHERE (@wh = 0 OR m.warehouse_id = @wh)
            AND (@item = 0 OR m.item_id = @item)
            AND (@from = '' OR m.biz_date >= @from)
            AND (@to = '' OR m.biz_date <= @to)
          ORDER BY m.biz_date DESC, m.doc_id DESC, m.line_id DESC
          LIMIT @limit OFFSET @offset`,
  movesCount: `SELECT COUNT(*) AS n FROM stock_move m
               WHERE (@wh = 0 OR m.warehouse_id = @wh)
                 AND (@item = 0 OR m.item_id = @item)
                 AND (@from = '' OR m.biz_date >= @from)
                 AND (@to = '' OR m.biz_date <= @to)`,
  serialMoves: `SELECT m.biz_date, m.doc_id, d.doc_no, d.doc_type, m.warehouse_id, w.name AS warehouse_name,
                       m.delta, m.item_id, i.code AS item_code, i.name AS item_name
                FROM serial_move m
                JOIN doc d ON d.id = m.doc_id
                JOIN warehouse w ON w.id = m.warehouse_id
                JOIN item i ON i.id = m.item_id
                WHERE m.serial = ?
                ORDER BY m.biz_date, m.doc_id, m.line_id, m.delta`,
  profitByDay: `SELECT d.biz_date AS key,
                  SUM(CASE WHEN d.doc_type = 'SALE' THEN l.amount
                           WHEN d.doc_type = 'SALE_RETURN' THEN -l.amount ELSE 0 END) AS sales_amount,
                  SUM(CASE WHEN d.doc_type = 'SALE' THEN l.cost_amount
                           WHEN d.doc_type = 'SALE_RETURN' THEN -l.cost_amount ELSE 0 END) AS sales_cost,
                  SUM(CASE WHEN d.doc_type = 'PURCHASE_RETURN' THEN l.amount - l.cost_amount ELSE 0 END) AS variance
                FROM doc_line l
                JOIN doc d ON d.id = l.doc_id
                WHERE d.status = 'posted' AND d.biz_date >= @from AND d.biz_date <= @to
                  AND d.doc_type IN ('SALE', 'SALE_RETURN', 'PURCHASE_RETURN')
                GROUP BY d.biz_date
                ORDER BY d.biz_date`,
  profitByItem: `SELECT CAST(i.id AS TEXT) AS key, i.code || ' ' || i.name AS label,
                  SUM(CASE WHEN d.doc_type = 'SALE' THEN l.amount
                           WHEN d.doc_type = 'SALE_RETURN' THEN -l.amount ELSE 0 END) AS sales_amount,
                  SUM(CASE WHEN d.doc_type = 'SALE' THEN l.cost_amount
                           WHEN d.doc_type = 'SALE_RETURN' THEN -l.cost_amount ELSE 0 END) AS sales_cost,
                  SUM(CASE WHEN d.doc_type = 'PURCHASE_RETURN' THEN l.amount - l.cost_amount ELSE 0 END) AS variance
                FROM doc_line l
                JOIN doc d ON d.id = l.doc_id
                JOIN item i ON i.id = l.item_id
                WHERE d.status = 'posted' AND d.biz_date >= @from AND d.biz_date <= @to
                  AND d.doc_type IN ('SALE', 'SALE_RETURN', 'PURCHASE_RETURN')
                GROUP BY i.id
                ORDER BY i.code`,
})

const likePattern = (kw: string): string => `%${kw.replace(/[\\%_]/g, (c) => '\\' + c)}%`

function itemAmountMap(db: Parameters<typeof sql>[0]): Map<number, number> {
  // 按批次聚合剩余金额，再按商品汇总。
  const rows = sql(db).layerRemain.all() as { item_id: number; rem: number }[]
  const map = new Map<number, number>()
  for (const r of rows) map.set(r.item_id, (map.get(r.item_id) ?? 0) + r.rem)
  return map
}

export const queryHandlers = {
  'stock:list': handler('stock:list', 'user', (ctx, input) => {
    const db = ctx.core.db
    const rows = sql(db).stockList.all({
      wh: input.warehouseId ?? 0,
      onlyPos: input.onlyPositive ? 1 : 0,
      kw: input.keyword,
      like: likePattern(input.keyword),
    }) as {
      warehouse_id: number
      warehouse_name: string
      item_id: number
      item_code: string
      item_name: string
      item_spec: string
      unit: string
      serial_managed: number
      qty: number
    }[]
    const amounts = ctx.session.role === 'owner' ? itemAmountMap(db) : null
    return rows.map((r): StockRow => {
      const row: StockRow = {
        warehouseId: r.warehouse_id,
        warehouseName: r.warehouse_name,
        itemId: r.item_id,
        itemCode: r.item_code,
        itemName: r.item_name,
        itemSpec: r.item_spec,
        unit: r.unit,
        serialManaged: r.serial_managed === 1,
        qty: r.qty,
      }
      if (amounts) row.amount = cents(amounts.get(r.item_id) ?? 0)
      return row
    })
  }),

  'stock:moves': handler('stock:moves', 'user', (ctx, input) => {
    const db = ctx.core.db
    const p = {
      wh: input.warehouseId ?? 0,
      item: input.itemId ?? 0,
      from: input.dateFrom ?? '',
      to: input.dateTo ?? '',
      limit: input.pageSize,
      offset: (input.page - 1) * input.pageSize,
    }
    const rows = (sql(db).moves.all(p) as {
      id: number
      biz_date: string
      doc_id: number
      doc_no: string
      doc_type: StockMoveRow['docType']
      warehouse_id: number
      warehouse_name: string
      item_id: number
      item_code: string
      item_name: string
      qty: number
    }[]).map(
      (r): StockMoveRow => ({
        id: r.id,
        bizDate: r.biz_date,
        docId: r.doc_id,
        docNo: r.doc_no,
        docType: r.doc_type,
        warehouseId: r.warehouse_id,
        warehouseName: r.warehouse_name,
        itemId: r.item_id,
        itemCode: r.item_code,
        itemName: r.item_name,
        qty: r.qty,
      }),
    )
    const { limit: _l, offset: _o, ...cp } = p
    const total = (sql(db).movesCount.get(cp) as { n: number }).n
    return { rows, total }
  }),

  'serial:trace': handler('serial:trace', 'user', (ctx, input) => {
    const events = sql(ctx.core.db).serialMoves.all(input.serial) as {
      biz_date: string
      doc_id: number
      doc_no: string
      doc_type: SerialTrace['events'][number]['docType']
      warehouse_id: number
      warehouse_name: string
      delta: number
      item_id: number
      item_code: string
      item_name: string
    }[]
    let running = 0
    let currentWarehouseId: number | null = null
    let currentWarehouseName: string | null = null
    const mapped = events.map((e) => {
      running += e.delta
      if (e.delta === 1) {
        currentWarehouseId = e.warehouse_id
        currentWarehouseName = e.warehouse_name
      } else if (running === 0) {
        currentWarehouseId = null
        currentWarehouseName = null
      }
      return {
        bizDate: e.biz_date,
        docId: e.doc_id,
        docNo: e.doc_no,
        docType: e.doc_type,
        warehouseId: e.warehouse_id,
        warehouseName: e.warehouse_name,
        delta: e.delta,
        running,
      }
    })
    const last = events[events.length - 1]
    return {
      serial: input.serial,
      itemId: last?.item_id ?? null,
      itemCode: last?.item_code ?? null,
      itemName: last?.item_name ?? null,
      currentWarehouseId,
      currentWarehouseName,
      events: mapped,
    } satisfies SerialTrace
  }),

  'report:profit': handler('report:profit', 'owner', (ctx, input) => {
    const db = ctx.core.db
    const p = { from: input.dateFrom, to: input.dateTo }
    const raw =
      input.dimension === 'day'
        ? (sql(db).profitByDay.all(p) as {
            key: string
            sales_amount: number
            sales_cost: number
            variance: number
          }[])
        : (sql(db).profitByItem.all(p) as {
            key: string
            label: string
            sales_amount: number
            sales_cost: number
            variance: number
          }[])

    const rows: ProfitRow[] = raw.map((r) => {
      const salesAmount = cents(r.sales_amount)
      const salesCost = cents(r.sales_cost)
      const label = 'label' in r && typeof r.label === 'string' ? r.label : r.key
      return {
        key: r.key,
        label,
        salesAmount,
        salesCost,
        salesProfit: cents(r.sales_amount - r.sales_cost),
        purchaseReturnVariance: cents(r.variance),
      }
    })
    const totals = rows.reduce(
      (a, r) => ({
        salesAmount: cents(a.salesAmount + r.salesAmount),
        salesCost: cents(a.salesCost + r.salesCost),
        salesProfit: cents(a.salesProfit + r.salesProfit),
        purchaseReturnVariance: cents(a.purchaseReturnVariance + r.purchaseReturnVariance),
      }),
      {
        salesAmount: cents(0),
        salesCost: cents(0),
        salesProfit: cents(0),
        purchaseReturnVariance: cents(0),
      },
    )
    const report: ProfitReport = {
      dateFrom: input.dateFrom,
      dateTo: input.dateTo,
      dimension: input.dimension,
      rows,
      totals,
    }
    return report
  }),
}
