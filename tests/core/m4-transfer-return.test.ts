import { test } from 'node:test'
import assert from 'node:assert/strict'
import { OWNER, setup, sns, type TestEnv } from './helpers'

function seed(env: TestEnv) {
  const { call } = env
  const wh1 = call(OWNER, 'warehouse:save', { code: 'W1', name: '门店仓' })
  const wh2 = call(OWNER, 'warehouse:save', { code: 'W2', name: '备用仓' })
  const supplier = call(OWNER, 'partner:save', { kind: 'supplier', code: 'S1', name: '供应商A' })
  const customer = call(OWNER, 'partner:save', { kind: 'customer', code: 'C1', name: '客户A' })
  const item = call(OWNER, 'item:save', {
    code: 'PHONE1',
    name: '手机',
    defaultBuyPrice: '100',
    defaultSellPrice: '200',
  })
  return { wh1, wh2, supplier, customer, item }
}

test('15. 移库后两仓结存正确且成本不变；补录调出仓早出库按时间线检查', () => {
  const env = setup()
  const { call, fail, db } = env
  const { wh1, wh2, supplier, customer, item } = seed(env)
  const stock = sns('M', 10)

  call(OWNER, 'doc:create', {
    docType: 'PURCHASE',
    bizDate: '2026-11-01',
    warehouseId: wh1.id,
    partnerId: supplier.id,
    lines: [{ itemId: item.id, qty: 10, unitPrice: '100', serials: stock }],
  })
  const sale = call(OWNER, 'doc:create', {
    docType: 'SALE',
    bizDate: '2026-11-10',
    warehouseId: wh1.id,
    partnerId: customer.id,
    lines: [{ itemId: item.id, qty: 2, unitPrice: '200', serials: stock.slice(0, 2) }],
  })
  const costBefore = sale.lines[0]!.costAmount

  call(OWNER, 'doc:create', {
    docType: 'TRANSFER',
    bizDate: '2026-11-05',
    warehouseId: wh1.id,
    toWarehouseId: wh2.id,
    lines: [{ itemId: item.id, qty: 4, unitPrice: '0', serials: stock.slice(2, 6) }],
  })

  const b1 = db.prepare('SELECT qty FROM stock_balance WHERE warehouse_id=? AND item_id=?').get(wh1.id, item.id) as {
    qty: number
  }
  const b2 = db.prepare('SELECT qty FROM stock_balance WHERE warehouse_id=? AND item_id=?').get(wh2.id, item.id) as {
    qty: number
  }
  assert.equal(b1.qty, 4) // 10-4-2
  assert.equal(b2.qty, 4)
  assert.equal(call(OWNER, 'doc:get', { id: sale.id }).lines[0]!.costAmount, costBefore)

  // 补录 11-03 从 W1 卖 7（占用将移库的串号）：11-05 移库后会不够
  const e = fail(OWNER, 'doc:create', {
    docType: 'SALE',
    bizDate: '2026-11-03',
    warehouseId: wh1.id,
    partnerId: customer.id,
    lines: [{ itemId: item.id, qty: 7, unitPrice: '200', serials: stock.slice(2, 9) }],
  })
  assert.equal(e.code, 'STOCK_NEGATIVE')
  assert.equal(e.details?.['date'], '2026-11-05')
})

test('16. 移库后从原仓卖出该串号报 SERIAL_NOT_AVAILABLE', () => {
  const env = setup()
  const { call, fail } = env
  const { wh1, wh2, supplier, customer, item } = seed(env)
  call(OWNER, 'doc:create', {
    docType: 'PURCHASE',
    bizDate: '2026-11-01',
    warehouseId: wh1.id,
    partnerId: supplier.id,
    lines: [{ itemId: item.id, qty: 1, unitPrice: '3000', serials: ['SN-T'] }],
  })
  call(OWNER, 'doc:create', {
    docType: 'TRANSFER',
    bizDate: '2026-11-05',
    warehouseId: wh1.id,
    toWarehouseId: wh2.id,
    lines: [{ itemId: item.id, qty: 1, serials: ['SN-T'] }],
  })
  call(OWNER, 'doc:create', {
    docType: 'PURCHASE',
    bizDate: '2026-11-06',
    warehouseId: wh1.id,
    partnerId: supplier.id,
    lines: [{ itemId: item.id, qty: 1, unitPrice: '3000', serials: ['SN-OTHER'] }],
  })
  const e = fail(OWNER, 'doc:create', {
    docType: 'SALE',
    bizDate: '2026-11-07',
    warehouseId: wh1.id,
    partnerId: customer.id,
    lines: [{ itemId: item.id, qty: 1, unitPrice: '3999', serials: ['SN-T'] }],
  })
  assert.equal(e.code, 'SERIAL_NOT_AVAILABLE')
})

test('17. 采购退货：退回原单在库串号，成本与金额一致、差异为 0', () => {
  const env = setup()
  const { call } = env
  const { wh1, supplier, item } = seed(env)
  const stock = sns('PR', 10)
  const purchase = call(OWNER, 'doc:create', {
    docType: 'PURCHASE',
    bizDate: '2026-11-01',
    warehouseId: wh1.id,
    partnerId: supplier.id,
    lines: [{ itemId: item.id, qty: 10, unitPrice: '100', serials: stock }],
  })
  const ret = call(OWNER, 'doc:create', {
    docType: 'PURCHASE_RETURN',
    bizDate: '2026-11-05',
    warehouseId: wh1.id,
    partnerId: supplier.id,
    refDocId: purchase.id,
    lines: [{ itemId: item.id, qty: 3, refLineId: purchase.lines[0]!.id, serials: stock.slice(0, 3) }],
  })
  assert.equal(ret.lines[0]!.amount, 30000)
  assert.equal(ret.lines[0]!.costAmount, 30000)
})

test('18. 采购退货只能退原单仍在库串号；已售出串号不可退', () => {
  const env = setup()
  const { call, fail } = env
  const { wh1, supplier, customer, item } = seed(env)
  const stock = sns('PS', 5)
  const p1 = call(OWNER, 'doc:create', {
    docType: 'PURCHASE',
    bizDate: '2026-11-01',
    warehouseId: wh1.id,
    partnerId: supplier.id,
    lines: [{ itemId: item.id, qty: 5, unitPrice: '10.00', serials: stock }],
  })
  call(OWNER, 'doc:create', {
    docType: 'SALE',
    bizDate: '2026-11-03',
    warehouseId: wh1.id,
    partnerId: customer.id,
    lines: [{ itemId: item.id, qty: 3, unitPrice: '20', serials: stock.slice(0, 3) }],
  })
  // 退已售串号 → 串号不在仓
  assert.equal(
    fail(OWNER, 'doc:create', {
      docType: 'PURCHASE_RETURN',
      bizDate: '2026-11-05',
      warehouseId: wh1.id,
      partnerId: supplier.id,
      refDocId: p1.id,
      lines: [{ itemId: item.id, qty: 1, refLineId: p1.lines[0]!.id, serials: [stock[0]!] }],
    }).code,
    'SERIAL_NOT_AVAILABLE',
  )
  // 退剩余 2 台成功
  const ret = call(OWNER, 'doc:create', {
    docType: 'PURCHASE_RETURN',
    bizDate: '2026-11-05',
    warehouseId: wh1.id,
    partnerId: supplier.id,
    refDocId: p1.id,
    lines: [{ itemId: item.id, qty: 2, refLineId: p1.lines[0]!.id, serials: stock.slice(3, 5) }],
  })
  assert.equal(ret.lines[0]!.amount, 2000)
  assert.equal(ret.lines[0]!.costAmount, 2000)
})

test('19. 销售退货按原成本回库；分多次退完时成本之和等于原销售成本', () => {
  const env = setup()
  const { call } = env
  const { wh1, supplier, customer, item } = seed(env)
  const stock = sns('SR', 10)
  call(OWNER, 'doc:create', {
    docType: 'PURCHASE',
    bizDate: '2026-11-01',
    warehouseId: wh1.id,
    partnerId: supplier.id,
    lines: [{ itemId: item.id, qty: 10, unitPrice: '10.00', serials: stock }],
  })
  const sold = stock.slice(0, 5)
  const sale = call(OWNER, 'doc:create', {
    docType: 'SALE',
    bizDate: '2026-11-05',
    warehouseId: wh1.id,
    partnerId: customer.id,
    lines: [{ itemId: item.id, qty: 5, unitPrice: '20', serials: sold }],
  })
  const saleCost = sale.lines[0]!.costAmount!
  const r1 = call(OWNER, 'doc:create', {
    docType: 'SALE_RETURN',
    bizDate: '2026-11-08',
    warehouseId: wh1.id,
    partnerId: customer.id,
    refDocId: sale.id,
    lines: [{ itemId: item.id, qty: 2, refLineId: sale.lines[0]!.id, serials: sold.slice(0, 2) }],
  })
  const r2 = call(OWNER, 'doc:create', {
    docType: 'SALE_RETURN',
    bizDate: '2026-11-09',
    warehouseId: wh1.id,
    partnerId: customer.id,
    refDocId: sale.id,
    lines: [{ itemId: item.id, qty: 3, refLineId: sale.lines[0]!.id, serials: sold.slice(2, 5) }],
  })
  assert.equal(r1.lines[0]!.costAmount! + r2.lines[0]!.costAmount!, saleCost)
})

test('20. 退货数量超过可退数量报 RETURN_QTY_EXCEEDED', () => {
  const env = setup()
  const { call, fail } = env
  const { wh1, supplier, item } = seed(env)
  const stock = sns('RQ', 3)
  const p = call(OWNER, 'doc:create', {
    docType: 'PURCHASE',
    bizDate: '2026-11-01',
    warehouseId: wh1.id,
    partnerId: supplier.id,
    lines: [{ itemId: item.id, qty: 3, unitPrice: '10', serials: stock }],
  })
  const e = fail(OWNER, 'doc:create', {
    docType: 'PURCHASE_RETURN',
    bizDate: '2026-11-05',
    warehouseId: wh1.id,
    partnerId: supplier.id,
    refDocId: p.id,
    lines: [{ itemId: item.id, qty: 5, refLineId: p.lines[0]!.id, serials: sns('XX', 5) }],
  })
  assert.equal(e.code, 'RETURN_QTY_EXCEEDED')
})

test('21. 原单已被退货引用时反过账原单报 DOC_REFERENCED', () => {
  const env = setup()
  const { call, fail } = env
  const { wh1, supplier, item } = seed(env)
  const stock = sns('RF', 5)
  const p = call(OWNER, 'doc:create', {
    docType: 'PURCHASE',
    bizDate: '2026-11-01',
    warehouseId: wh1.id,
    partnerId: supplier.id,
    lines: [{ itemId: item.id, qty: 5, unitPrice: '10', serials: stock }],
  })
  const ret = call(OWNER, 'doc:create', {
    docType: 'PURCHASE_RETURN',
    bizDate: '2026-11-05',
    warehouseId: wh1.id,
    partnerId: supplier.id,
    refDocId: p.id,
    lines: [{ itemId: item.id, qty: 1, refLineId: p.lines[0]!.id, serials: [stock[0]!] }],
  })
  assert.equal(fail(OWNER, 'doc:unpost', { id: p.id }).code, 'DOC_REFERENCED')
  call(OWNER, 'doc:unpost', { id: ret.id })
  assert.equal(fail(OWNER, 'doc:unpost', { id: p.id }).code, 'DOC_REFERENCED')
  assert.equal(
    fail(OWNER, 'doc:update', {
      id: p.id,
      docType: 'PURCHASE',
      bizDate: '2026-11-01',
      warehouseId: wh1.id,
      partnerId: supplier.id,
      lines: [{ itemId: item.id, qty: 4, unitPrice: '10', serials: stock.slice(0, 4) }],
    }).code,
    'DOC_REFERENCED',
  )
})

test('22. 串号销售成本不因后续无关采购而改变；退货成本跟随原销售', () => {
  const env = setup()
  const { call } = env
  const { wh1, supplier, customer, item } = seed(env)
  const stock = sns('SC', 10)
  call(OWNER, 'doc:create', {
    docType: 'PURCHASE',
    bizDate: '2026-11-05',
    warehouseId: wh1.id,
    partnerId: supplier.id,
    lines: [{ itemId: item.id, qty: 10, unitPrice: '10.00', serials: stock }],
  })
  const sold = stock.slice(0, 2)
  const sale = call(OWNER, 'doc:create', {
    docType: 'SALE',
    bizDate: '2026-11-10',
    warehouseId: wh1.id,
    partnerId: customer.id,
    lines: [{ itemId: item.id, qty: 2, unitPrice: '20', serials: sold }],
  })
  const ret = call(OWNER, 'doc:create', {
    docType: 'SALE_RETURN',
    bizDate: '2026-11-12',
    warehouseId: wh1.id,
    partnerId: customer.id,
    refDocId: sale.id,
    lines: [{ itemId: item.id, qty: 2, refLineId: sale.lines[0]!.id, serials: sold }],
  })
  assert.equal(ret.lines[0]!.costAmount, 2000)

  // 补录更早、更便宜的其它串号，不影响已售串号成本
  call(OWNER, 'doc:create', {
    docType: 'PURCHASE',
    bizDate: '2026-11-01',
    warehouseId: wh1.id,
    partnerId: supplier.id,
    lines: [{ itemId: item.id, qty: 10, unitPrice: '8.00', serials: sns('CHEAP', 10) }],
  })
  const afterSale = call(OWNER, 'doc:get', { id: sale.id })
  const afterRet = call(OWNER, 'doc:get', { id: ret.id })
  assert.equal(afterSale.lines[0]!.costAmount, 2000)
  assert.equal(afterRet.lines[0]!.costAmount, 2000)
})
