import { test } from 'node:test'
import assert from 'node:assert/strict'
import { CLERK, OWNER, setup, type TestEnv } from './helpers'

/** 准备仓库、往来单位、商品，返回 id。 */
function seed(env: TestEnv, opts?: { serial?: boolean }) {
  const { call } = env
  const wh = call(OWNER, 'warehouse:save', { code: 'W1', name: '门店仓' })
  const supplier = call(OWNER, 'partner:save', { kind: 'supplier', code: 'S1', name: '供应商A' })
  const customer = call(OWNER, 'partner:save', { kind: 'customer', code: 'C1', name: '客户A' })
  const item = call(OWNER, 'item:save', {
    code: 'P1',
    name: opts?.serial ? '手机X' : '数据线',
    serialManaged: opts?.serial ?? false,
    defaultBuyPrice: '100',
    defaultSellPrice: '199',
  })
  return { wh, supplier, customer, item }
}

test('1. 采购入库后，结存和流水正确', () => {
  const env = setup()
  const { call, db } = env
  const { wh, supplier, item } = seed(env)

  const doc = call(CLERK, 'doc:create', {
    docType: 'PURCHASE',
    bizDate: '2026-11-10',
    warehouseId: wh.id,
    partnerId: supplier.id,
    lines: [{ itemId: item.id, qty: 5, unitPrice: '100.00' }],
  })
  assert.equal(doc.status, 'posted')
  assert.equal(doc.totalQty, 5)
  assert.equal(doc.totalAmount, 50000)

  const bal = db.prepare('SELECT qty FROM stock_balance WHERE warehouse_id = ? AND item_id = ?').get(wh.id, item.id) as {
    qty: number
  }
  assert.equal(bal.qty, 5)

  const moves = db.prepare('SELECT qty FROM stock_move WHERE doc_id = ?').all(doc.id) as { qty: number }[]
  assert.deepEqual(
    moves.map((m) => m.qty),
    [5],
  )
})

test('2. 销售数量超过结存时报 STOCK_NEGATIVE', () => {
  const env = setup()
  const { call, fail } = env
  const { wh, supplier, customer, item } = seed(env)
  call(OWNER, 'doc:create', {
    docType: 'PURCHASE',
    bizDate: '2026-11-10',
    warehouseId: wh.id,
    partnerId: supplier.id,
    lines: [{ itemId: item.id, qty: 3, unitPrice: '100' }],
  })
  const e = fail(CLERK, 'doc:create', {
    docType: 'SALE',
    bizDate: '2026-11-12',
    warehouseId: wh.id,
    partnerId: customer.id,
    lines: [{ itemId: item.id, qty: 5, unitPrice: '199' }],
  })
  assert.equal(e.code, 'STOCK_NEGATIVE')
  assert.equal(e.details?.['date'], '2026-11-12')
})

test('3. 补录早日期出库导致后续变负，错误日期是首次变负那天', () => {
  const env = setup()
  const { call, fail } = env
  const { wh, supplier, customer, item } = seed(env)
  // 11-01 入 10；11-10 卖 8；再补录 11-05 卖 5 → 11-10 会变负。
  call(OWNER, 'doc:create', {
    docType: 'PURCHASE',
    bizDate: '2026-11-01',
    warehouseId: wh.id,
    partnerId: supplier.id,
    lines: [{ itemId: item.id, qty: 10, unitPrice: '100' }],
  })
  call(OWNER, 'doc:create', {
    docType: 'SALE',
    bizDate: '2026-11-10',
    warehouseId: wh.id,
    partnerId: customer.id,
    lines: [{ itemId: item.id, qty: 8, unitPrice: '199' }],
  })
  const e = fail(OWNER, 'doc:create', {
    docType: 'SALE',
    bizDate: '2026-11-05',
    warehouseId: wh.id,
    partnerId: customer.id,
    lines: [{ itemId: item.id, qty: 5, unitPrice: '199' }],
  })
  assert.equal(e.code, 'STOCK_NEGATIVE')
  assert.equal(e.details?.['date'], '2026-11-10')
})

test('4. 串号个数与数量不一致时报 SERIAL_COUNT_MISMATCH', () => {
  const env = setup()
  const { fail } = env
  const { wh, supplier, item } = seed(env, { serial: true })
  const e = fail(OWNER, 'doc:create', {
    docType: 'PURCHASE',
    bizDate: '2026-11-10',
    warehouseId: wh.id,
    partnerId: supplier.id,
    lines: [{ itemId: item.id, qty: 2, unitPrice: '3000', serials: ['SN1'] }],
  })
  assert.equal(e.code, 'SERIAL_COUNT_MISMATCH')
})

test('5. 同一串号再次入库报 SERIAL_CONFLICT', () => {
  const env = setup()
  const { call, fail } = env
  const { wh, supplier, item } = seed(env, { serial: true })
  call(OWNER, 'doc:create', {
    docType: 'PURCHASE',
    bizDate: '2026-11-10',
    warehouseId: wh.id,
    partnerId: supplier.id,
    lines: [{ itemId: item.id, qty: 1, unitPrice: '3000', serials: ['SN-A'] }],
  })
  const e = fail(OWNER, 'doc:create', {
    docType: 'PURCHASE',
    bizDate: '2026-11-11',
    warehouseId: wh.id,
    partnerId: supplier.id,
    lines: [{ itemId: item.id, qty: 1, unitPrice: '3100', serials: ['SN-A'] }],
  })
  assert.equal(e.code, 'SERIAL_CONFLICT')
})

test('6. 卖出不在本仓库的串号报 SERIAL_NOT_AVAILABLE', () => {
  const env = setup()
  const { call, fail } = env
  const { wh, supplier, customer, item } = seed(env, { serial: true })
  const wh2 = call(OWNER, 'warehouse:save', { code: 'W2', name: '备用仓' })
  // W1 有 SN-B；W2 另有 SN-D（保证 W2 数量够，才会落到串号时间线检查而不是 STOCK_NEGATIVE）。
  call(OWNER, 'doc:create', {
    docType: 'PURCHASE',
    bizDate: '2026-11-10',
    warehouseId: wh.id,
    partnerId: supplier.id,
    lines: [{ itemId: item.id, qty: 1, unitPrice: '3000', serials: ['SN-B'] }],
  })
  call(OWNER, 'doc:create', {
    docType: 'PURCHASE',
    bizDate: '2026-11-10',
    warehouseId: wh2.id,
    partnerId: supplier.id,
    lines: [{ itemId: item.id, qty: 1, unitPrice: '3000', serials: ['SN-D'] }],
  })
  const e = fail(OWNER, 'doc:create', {
    docType: 'SALE',
    bizDate: '2026-11-11',
    warehouseId: wh2.id,
    partnerId: customer.id,
    lines: [{ itemId: item.id, qty: 1, unitPrice: '3999', serials: ['SN-B'] }],
  })
  assert.equal(e.code, 'SERIAL_NOT_AVAILABLE')
})

test('7. 串号卖出后再入库成功；再次卖出成本取新入库成本', () => {
  const env = setup()
  const { call } = env
  const { wh, supplier, customer, item } = seed(env, { serial: true })

  call(OWNER, 'doc:create', {
    docType: 'PURCHASE',
    bizDate: '2026-11-01',
    warehouseId: wh.id,
    partnerId: supplier.id,
    lines: [{ itemId: item.id, qty: 1, unitPrice: '3000.00', serials: ['SN-C'] }],
  })
  const sale1 = call(OWNER, 'doc:create', {
    docType: 'SALE',
    bizDate: '2026-11-05',
    warehouseId: wh.id,
    partnerId: customer.id,
    lines: [{ itemId: item.id, qty: 1, unitPrice: '3999', serials: ['SN-C'] }],
  })
  assert.equal(sale1.lines[0]!.costAmount, 300000)

  call(OWNER, 'doc:create', {
    docType: 'PURCHASE',
    bizDate: '2026-11-08',
    warehouseId: wh.id,
    partnerId: supplier.id,
    lines: [{ itemId: item.id, qty: 1, unitPrice: '2800.00', serials: ['SN-C'] }],
  })
  const sale2 = call(OWNER, 'doc:create', {
    docType: 'SALE',
    bizDate: '2026-11-10',
    warehouseId: wh.id,
    partnerId: customer.id,
    lines: [{ itemId: item.id, qty: 1, unitPrice: '3500', serials: ['SN-C'] }],
  })
  assert.equal(sale2.lines[0]!.costAmount, 280000)
})

test('8. 失败的过账不留下任何数据', () => {
  const env = setup()
  const { call, fail, db } = env
  const { wh, supplier, customer, item } = seed(env)
  call(OWNER, 'doc:create', {
    docType: 'PURCHASE',
    bizDate: '2026-11-10',
    warehouseId: wh.id,
    partnerId: supplier.id,
    lines: [{ itemId: item.id, qty: 2, unitPrice: '100' }],
  })
  const beforeDocs = (db.prepare('SELECT COUNT(*) AS n FROM doc').get() as { n: number }).n
  const beforeMoves = (db.prepare('SELECT COUNT(*) AS n FROM stock_move').get() as { n: number }).n

  fail(OWNER, 'doc:create', {
    docType: 'SALE',
    bizDate: '2026-11-12',
    warehouseId: wh.id,
    partnerId: customer.id,
    lines: [{ itemId: item.id, qty: 9, unitPrice: '199' }],
  })

  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM doc').get() as { n: number }).n, beforeDocs)
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM stock_move').get() as { n: number }).n, beforeMoves)
  assert.equal(
    (db.prepare('SELECT qty FROM stock_balance WHERE item_id = ?').get(item.id) as { qty: number }).qty,
    2,
  )
})
