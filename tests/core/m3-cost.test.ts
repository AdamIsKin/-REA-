import { test } from 'node:test'
import assert from 'node:assert/strict'
import { CLERK, OWNER, setup, sns, type TestEnv } from './helpers'

function seed(env: TestEnv) {
  const { call } = env
  const wh = call(OWNER, 'warehouse:save', { code: 'W1', name: '门店仓' })
  const supplier = call(OWNER, 'partner:save', { kind: 'supplier', code: 'S1', name: '供应商A' })
  const customer = call(OWNER, 'partner:save', { kind: 'customer', code: 'C1', name: '客户A' })
  const item = call(OWNER, 'item:save', {
    code: 'PHONE1',
    name: '手机A',
    defaultBuyPrice: '10',
    defaultSellPrice: '20',
  })
  return { wh, supplier, customer, item }
}

test('9. 按串号取成本：两批不同进价，跨批出库成本正确', () => {
  const env = setup()
  const { call } = env
  const { wh, supplier, customer, item } = seed(env)
  const batch1 = sns('P1-', 3)
  const batch2 = sns('P2-', 3)
  call(OWNER, 'doc:create', {
    docType: 'PURCHASE',
    bizDate: '2026-11-01',
    warehouseId: wh.id,
    partnerId: supplier.id,
    lines: [{ itemId: item.id, qty: 3, unitPrice: '10.00', serials: batch1 }],
  })
  call(OWNER, 'doc:create', {
    docType: 'PURCHASE',
    bizDate: '2026-11-02',
    warehouseId: wh.id,
    partnerId: supplier.id,
    lines: [{ itemId: item.id, qty: 3, unitPrice: '12.00', serials: batch2 }],
  })
  // 卖 3 台一批 + 1 台二批：3×10 + 1×12 = 42 元
  const sale = call(OWNER, 'doc:create', {
    docType: 'SALE',
    bizDate: '2026-11-05',
    warehouseId: wh.id,
    partnerId: customer.id,
    lines: [{ itemId: item.id, qty: 4, unitPrice: '20', serials: [...batch1, batch2[0]!] }],
  })
  assert.equal(sale.lines[0]!.costAmount, 4200)
})

test('10. 同一进价批次分多次卖完，各次成本之和等于批次金额', () => {
  const env = setup()
  const { call } = env
  const { wh, supplier, customer, item } = seed(env)
  const all = sns('Q', 6)
  call(OWNER, 'doc:create', {
    docType: 'PURCHASE',
    bizDate: '2026-11-01',
    warehouseId: wh.id,
    partnerId: supplier.id,
    lines: [{ itemId: item.id, qty: 6, unitPrice: '1.00', serials: all }],
  })
  const s1 = call(OWNER, 'doc:create', {
    docType: 'SALE',
    bizDate: '2026-11-02',
    warehouseId: wh.id,
    partnerId: customer.id,
    lines: [{ itemId: item.id, qty: 3, unitPrice: '2', serials: all.slice(0, 3) }],
  })
  const s2 = call(OWNER, 'doc:create', {
    docType: 'SALE',
    bizDate: '2026-11-03',
    warehouseId: wh.id,
    partnerId: customer.id,
    lines: [{ itemId: item.id, qty: 2, unitPrice: '2', serials: all.slice(3, 5) }],
  })
  const s3 = call(OWNER, 'doc:create', {
    docType: 'SALE',
    bizDate: '2026-11-04',
    warehouseId: wh.id,
    partnerId: customer.id,
    lines: [{ itemId: item.id, qty: 1, unitPrice: '2', serials: [all[5]!] }],
  })
  assert.equal(s1.lines[0]!.costAmount! + s2.lines[0]!.costAmount! + s3.lines[0]!.costAmount!, 600)
})

test('11. 串号成本绑定原采购；先反过账销售后改进价，再销售成本按新进价', () => {
  const env = setup()
  const { call, fail } = env
  const { wh, supplier, customer, item } = seed(env)
  const stock = sns('R', 5)
  const p = call(OWNER, 'doc:create', {
    docType: 'PURCHASE',
    bizDate: '2026-11-05',
    warehouseId: wh.id,
    partnerId: supplier.id,
    lines: [{ itemId: item.id, qty: 5, unitPrice: '10.00', serials: stock }],
  })
  const sale = call(OWNER, 'doc:create', {
    docType: 'SALE',
    bizDate: '2026-11-10',
    warehouseId: wh.id,
    partnerId: customer.id,
    lines: [{ itemId: item.id, qty: 2, unitPrice: '20', serials: stock.slice(0, 2) }],
  })
  assert.equal(sale.lines[0]!.costAmount, 2000)
  // 销售仍占用串号时，反过账采购会被拒绝。
  assert.equal(fail(OWNER, 'doc:unpost', { id: p.id }).code, 'STOCK_NEGATIVE')

  call(OWNER, 'doc:unpost', { id: sale.id })
  call(OWNER, 'doc:unpost', { id: p.id })
  call(OWNER, 'doc:update', {
    id: p.id,
    docType: 'PURCHASE',
    bizDate: '2026-11-05',
    warehouseId: wh.id,
    partnerId: supplier.id,
    lines: [{ itemId: item.id, qty: 5, unitPrice: '8.00', serials: stock }],
  })
  const sale2 = call(OWNER, 'doc:create', {
    docType: 'SALE',
    bizDate: '2026-11-10',
    warehouseId: wh.id,
    partnerId: customer.id,
    lines: [{ itemId: item.id, qty: 2, unitPrice: '20', serials: stock.slice(0, 2) }],
  })
  assert.equal(sale2.lines[0]!.costAmount, 1600)
})

test('12. 反过账采购单：后面出库会变负则拒绝；否则成功并重算', () => {
  const env = setup()
  const { call, fail } = env
  const { wh, supplier, customer, item } = seed(env)
  const s1 = sns('S1-', 5)
  const s2 = sns('S2-', 5)
  const p1 = call(OWNER, 'doc:create', {
    docType: 'PURCHASE',
    bizDate: '2026-11-01',
    warehouseId: wh.id,
    partnerId: supplier.id,
    lines: [{ itemId: item.id, qty: 5, unitPrice: '10', serials: s1 }],
  })
  call(OWNER, 'doc:create', {
    docType: 'SALE',
    bizDate: '2026-11-05',
    warehouseId: wh.id,
    partnerId: customer.id,
    lines: [{ itemId: item.id, qty: 3, unitPrice: '20', serials: s1.slice(0, 3) }],
  })
  assert.equal(fail(OWNER, 'doc:unpost', { id: p1.id }).code, 'STOCK_NEGATIVE')

  const p2 = call(OWNER, 'doc:create', {
    docType: 'PURCHASE',
    bizDate: '2026-11-03',
    warehouseId: wh.id,
    partnerId: supplier.id,
    lines: [{ itemId: item.id, qty: 5, unitPrice: '12', serials: s2 }],
  })
  const unposted = call(OWNER, 'doc:unpost', { id: p2.id })
  assert.equal(unposted.status, 'draft')
})

test('13. 修改已过账单据后，结果与按新内容重新录入一致', () => {
  const env = setup()
  const { call } = env
  const { wh, supplier, customer, item } = seed(env)
  const stock = sns('T', 10)
  call(OWNER, 'doc:create', {
    docType: 'PURCHASE',
    bizDate: '2026-11-01',
    warehouseId: wh.id,
    partnerId: supplier.id,
    lines: [{ itemId: item.id, qty: 10, unitPrice: '10', serials: stock }],
  })
  const sale = call(OWNER, 'doc:create', {
    docType: 'SALE',
    bizDate: '2026-11-08',
    warehouseId: wh.id,
    partnerId: customer.id,
    lines: [{ itemId: item.id, qty: 2, unitPrice: '20', serials: stock.slice(0, 2) }],
  })
  const updated = call(OWNER, 'doc:update', {
    id: sale.id,
    docType: 'SALE',
    bizDate: '2026-11-06',
    warehouseId: wh.id,
    partnerId: customer.id,
    lines: [{ itemId: item.id, qty: 3, unitPrice: '20', serials: stock.slice(0, 3) }],
  })
  assert.equal(updated.bizDate, '2026-11-06')
  assert.equal(updated.totalQty, 3)
  assert.equal(updated.lines[0]!.costAmount, 3000)
  assert.equal(updated.docNo, sale.docNo)
})

test('14. 店员反过账报 FORBIDDEN', () => {
  const env = setup()
  const { call, fail } = env
  const { wh, supplier, item } = seed(env)
  const doc = call(OWNER, 'doc:create', {
    docType: 'PURCHASE',
    bizDate: '2026-11-01',
    warehouseId: wh.id,
    partnerId: supplier.id,
    lines: [{ itemId: item.id, qty: 1, unitPrice: '10', serials: ['U1'] }],
  })
  assert.equal(fail(CLERK, 'doc:unpost', { id: doc.id }).code, 'FORBIDDEN')
})
