import { test } from 'node:test'
import assert from 'node:assert/strict'
import { CLERK, OWNER, setup, type TestEnv } from './helpers'

function seedPart(env: TestEnv) {
  const { call } = env
  const wh = call(OWNER, 'warehouse:save', { code: 'W1', name: '门店仓' })
  const supplier = call(OWNER, 'partner:save', { kind: 'supplier', code: 'S1', name: '供应商A' })
  const customer = call(OWNER, 'partner:save', { kind: 'customer', code: 'C1', name: '客户A' })
  const item = call(OWNER, 'item:save', {
    code: 'ACC1',
    name: '配件A',
    serialManaged: false,
    defaultBuyPrice: '10',
    defaultSellPrice: '20',
  })
  return { wh, supplier, customer, item }
}

test('9. 配件按先进先出：两批不同进价，跨批出库成本正确', () => {
  const env = setup()
  const { call } = env
  const { wh, supplier, customer, item } = seedPart(env)
  call(OWNER, 'doc:create', {
    docType: 'PURCHASE',
    bizDate: '2026-11-01',
    warehouseId: wh.id,
    partnerId: supplier.id,
    lines: [{ itemId: item.id, qty: 3, unitPrice: '10.00' }],
  })
  call(OWNER, 'doc:create', {
    docType: 'PURCHASE',
    bizDate: '2026-11-02',
    warehouseId: wh.id,
    partnerId: supplier.id,
    lines: [{ itemId: item.id, qty: 3, unitPrice: '12.00' }],
  })
  // 卖 4：3×10 + 1×12 = 42 元 = 4200 分
  const sale = call(OWNER, 'doc:create', {
    docType: 'SALE',
    bizDate: '2026-11-05',
    warehouseId: wh.id,
    partnerId: customer.id,
    lines: [{ itemId: item.id, qty: 4, unitPrice: '20' }],
  })
  assert.equal(sale.lines[0]!.costAmount, 4200)
})

test('10. 一个批次分多次卖完，各次成本之和等于批次金额', () => {
  const env = setup()
  const { call } = env
  const { wh, supplier, customer, item } = seedPart(env)
  // 批次金额 100 分，卖 3+2+1
  call(OWNER, 'doc:create', {
    docType: 'PURCHASE',
    bizDate: '2026-11-01',
    warehouseId: wh.id,
    partnerId: supplier.id,
    lines: [{ itemId: item.id, qty: 6, unitPrice: '1.00' }],
  })
  const s1 = call(OWNER, 'doc:create', {
    docType: 'SALE',
    bizDate: '2026-11-02',
    warehouseId: wh.id,
    partnerId: customer.id,
    lines: [{ itemId: item.id, qty: 3, unitPrice: '2' }],
  })
  const s2 = call(OWNER, 'doc:create', {
    docType: 'SALE',
    bizDate: '2026-11-03',
    warehouseId: wh.id,
    partnerId: customer.id,
    lines: [{ itemId: item.id, qty: 2, unitPrice: '2' }],
  })
  const s3 = call(OWNER, 'doc:create', {
    docType: 'SALE',
    bizDate: '2026-11-04',
    warehouseId: wh.id,
    partnerId: customer.id,
    lines: [{ itemId: item.id, qty: 1, unitPrice: '2' }],
  })
  assert.equal(s1.lines[0]!.costAmount! + s2.lines[0]!.costAmount! + s3.lines[0]!.costAmount!, 600)
})

test('11. 补录更早、进价不同的采购单后，销售成本重算并写 cost_change_log', () => {
  const env = setup()
  const { call, db } = env
  const { wh, supplier, customer, item } = seedPart(env)
  call(OWNER, 'doc:create', {
    docType: 'PURCHASE',
    bizDate: '2026-11-05',
    warehouseId: wh.id,
    partnerId: supplier.id,
    lines: [{ itemId: item.id, qty: 5, unitPrice: '10.00' }],
  })
  const sale = call(OWNER, 'doc:create', {
    docType: 'SALE',
    bizDate: '2026-11-10',
    warehouseId: wh.id,
    partnerId: customer.id,
    lines: [{ itemId: item.id, qty: 2, unitPrice: '20' }],
  })
  assert.equal(sale.lines[0]!.costAmount, 2000)

  // 补录 11-01 进价 8 元的货；FIFO 后销售应吃这批：2×8=16 元
  call(OWNER, 'doc:create', {
    docType: 'PURCHASE',
    bizDate: '2026-11-01',
    warehouseId: wh.id,
    partnerId: supplier.id,
    lines: [{ itemId: item.id, qty: 5, unitPrice: '8.00' }],
  })
  const after = call(OWNER, 'doc:get', { id: sale.id })
  assert.equal(after.lines[0]!.costAmount, 1600)

  const logs = db
    .prepare('SELECT cogs_delta, reason FROM cost_change_log WHERE item_id = ? ORDER BY id')
    .all(item.id) as { cogs_delta: number; reason: string }[]
  assert.ok(logs.some((l) => l.cogs_delta === -400))
})

test('12. 反过账采购单：后面出库会变负则拒绝；否则成功并重算', () => {
  const env = setup()
  const { call, fail } = env
  const { wh, supplier, customer, item } = seedPart(env)
  const p1 = call(OWNER, 'doc:create', {
    docType: 'PURCHASE',
    bizDate: '2026-11-01',
    warehouseId: wh.id,
    partnerId: supplier.id,
    lines: [{ itemId: item.id, qty: 5, unitPrice: '10' }],
  })
  call(OWNER, 'doc:create', {
    docType: 'SALE',
    bizDate: '2026-11-05',
    warehouseId: wh.id,
    partnerId: customer.id,
    lines: [{ itemId: item.id, qty: 3, unitPrice: '20' }],
  })
  // 反过账唯一采购 → 销售变负
  assert.equal(fail(OWNER, 'doc:unpost', { id: p1.id }).code, 'STOCK_NEGATIVE')

  // 再入一批后，反过账第二批采购（没被卖到）应成功
  const p2 = call(OWNER, 'doc:create', {
    docType: 'PURCHASE',
    bizDate: '2026-11-03',
    warehouseId: wh.id,
    partnerId: supplier.id,
    lines: [{ itemId: item.id, qty: 5, unitPrice: '12' }],
  })
  const unposted = call(OWNER, 'doc:unpost', { id: p2.id })
  assert.equal(unposted.status, 'draft')
})

test('13. 修改已过账单据后，结果与按新内容重新录入一致', () => {
  const env = setup()
  const { call } = env
  const { wh, supplier, customer, item } = seedPart(env)
  call(OWNER, 'doc:create', {
    docType: 'PURCHASE',
    bizDate: '2026-11-01',
    warehouseId: wh.id,
    partnerId: supplier.id,
    lines: [{ itemId: item.id, qty: 10, unitPrice: '10' }],
  })
  const sale = call(OWNER, 'doc:create', {
    docType: 'SALE',
    bizDate: '2026-11-08',
    warehouseId: wh.id,
    partnerId: customer.id,
    lines: [{ itemId: item.id, qty: 2, unitPrice: '20' }],
  })
  // 改销售：日期 11-06、数量 3
  const updated = call(OWNER, 'doc:update', {
    id: sale.id,
    docType: 'SALE',
    bizDate: '2026-11-06',
    warehouseId: wh.id,
    partnerId: customer.id,
    lines: [{ itemId: item.id, qty: 3, unitPrice: '20' }],
  })
  assert.equal(updated.bizDate, '2026-11-06')
  assert.equal(updated.totalQty, 3)
  assert.equal(updated.lines[0]!.costAmount, 3000)
  assert.equal(updated.docNo, sale.docNo) // 单号不变
})

test('14. 店员反过账报 FORBIDDEN', () => {
  const env = setup()
  const { call, fail } = env
  const { wh, supplier, item } = seedPart(env)
  const doc = call(OWNER, 'doc:create', {
    docType: 'PURCHASE',
    bizDate: '2026-11-01',
    warehouseId: wh.id,
    partnerId: supplier.id,
    lines: [{ itemId: item.id, qty: 1, unitPrice: '10' }],
  })
  assert.equal(fail(CLERK, 'doc:unpost', { id: doc.id }).code, 'FORBIDDEN')
})
