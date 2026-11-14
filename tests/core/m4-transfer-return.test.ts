import { test } from 'node:test'
import assert from 'node:assert/strict'
import { OWNER, setup, type TestEnv } from './helpers'

function seed(env: TestEnv, serial = false) {
  const { call } = env
  const wh1 = call(OWNER, 'warehouse:save', { code: 'W1', name: '门店仓' })
  const wh2 = call(OWNER, 'warehouse:save', { code: 'W2', name: '备用仓' })
  const supplier = call(OWNER, 'partner:save', { kind: 'supplier', code: 'S1', name: '供应商A' })
  const customer = call(OWNER, 'partner:save', { kind: 'customer', code: 'C1', name: '客户A' })
  const item = call(OWNER, 'item:save', {
    code: serial ? 'PHONE1' : 'ACC1',
    name: serial ? '手机' : '配件',
    serialManaged: serial,
    defaultBuyPrice: '100',
    defaultSellPrice: '200',
  })
  return { wh1, wh2, supplier, customer, item }
}

test('15. 移库后两仓结存正确且成本不变；补录调出仓早出库按时间线检查', () => {
  const env = setup()
  const { call, fail, db } = env
  const { wh1, wh2, supplier, customer, item } = seed(env)

  call(OWNER, 'doc:create', {
    docType: 'PURCHASE',
    bizDate: '2026-11-01',
    warehouseId: wh1.id,
    partnerId: supplier.id,
    lines: [{ itemId: item.id, qty: 10, unitPrice: '100' }],
  })
  const sale = call(OWNER, 'doc:create', {
    docType: 'SALE',
    bizDate: '2026-11-10',
    warehouseId: wh1.id,
    partnerId: customer.id,
    lines: [{ itemId: item.id, qty: 2, unitPrice: '200' }],
  })
  const costBefore = sale.lines[0]!.costAmount

  call(OWNER, 'doc:create', {
    docType: 'TRANSFER',
    bizDate: '2026-11-05',
    warehouseId: wh1.id,
    toWarehouseId: wh2.id,
    lines: [{ itemId: item.id, qty: 4, unitPrice: '0' }],
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

  // 补录 11-03 从 W1 卖 7：11-03 够，但 11-05 移库后会不够 → 首次变负在移库日
  const e = fail(OWNER, 'doc:create', {
    docType: 'SALE',
    bizDate: '2026-11-03',
    warehouseId: wh1.id,
    partnerId: customer.id,
    lines: [{ itemId: item.id, qty: 7, unitPrice: '200' }],
  })
  assert.equal(e.code, 'STOCK_NEGATIVE')
  assert.equal(e.details?.['date'], '2026-11-05')
})

test('16. 手机移库后从原仓卖出该串号报 SERIAL_NOT_AVAILABLE', () => {
  const env = setup()
  const { call, fail } = env
  const { wh1, wh2, supplier, customer, item } = seed(env, true)
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
  // W1 再入另一台，保证数量检查通过
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

test('17. 配件采购退货：原批次剩余足够时只扣原批次，差异为 0', () => {
  const env = setup()
  const { call } = env
  const { wh1, supplier, item } = seed(env)
  const purchase = call(OWNER, 'doc:create', {
    docType: 'PURCHASE',
    bizDate: '2026-11-01',
    warehouseId: wh1.id,
    partnerId: supplier.id,
    lines: [{ itemId: item.id, qty: 10, unitPrice: '100' }],
  })
  const ret = call(OWNER, 'doc:create', {
    docType: 'PURCHASE_RETURN',
    bizDate: '2026-11-05',
    warehouseId: wh1.id,
    partnerId: supplier.id,
    refDocId: purchase.id,
    lines: [{ itemId: item.id, qty: 3, refLineId: purchase.lines[0]!.id }],
  })
  assert.equal(ret.lines[0]!.amount, 30000)
  assert.equal(ret.lines[0]!.costAmount, 30000) // 差异 0
})

test('18. 配件采购退货：原批次部分卖出后，先扣原批再 FIFO，差异正确', () => {
  const env = setup()
  const { call } = env
  const { wh1, supplier, customer, item } = seed(env)
  const p1 = call(OWNER, 'doc:create', {
    docType: 'PURCHASE',
    bizDate: '2026-11-01',
    warehouseId: wh1.id,
    partnerId: supplier.id,
    lines: [{ itemId: item.id, qty: 5, unitPrice: '10.00' }],
  })
  call(OWNER, 'doc:create', {
    docType: 'PURCHASE',
    bizDate: '2026-11-02',
    warehouseId: wh1.id,
    partnerId: supplier.id,
    lines: [{ itemId: item.id, qty: 5, unitPrice: '12.00' }],
  })
  // 卖掉原批 3 件
  call(OWNER, 'doc:create', {
    docType: 'SALE',
    bizDate: '2026-11-03',
    warehouseId: wh1.id,
    partnerId: customer.id,
    lines: [{ itemId: item.id, qty: 3, unitPrice: '20' }],
  })
  // 退原单 4 件：原批剩 2 → 扣 2×10；再 FIFO 扣 2×12；成本 20+24=44；金额 4×10=40；差异 -4 元=-400 分
  const ret = call(OWNER, 'doc:create', {
    docType: 'PURCHASE_RETURN',
    bizDate: '2026-11-05',
    warehouseId: wh1.id,
    partnerId: supplier.id,
    refDocId: p1.id,
    lines: [{ itemId: item.id, qty: 4, refLineId: p1.lines[0]!.id }],
  })
  assert.equal(ret.lines[0]!.amount, 4000)
  assert.equal(ret.lines[0]!.costAmount, 4400)
})

test('19. 销售退货按原成本新建批次；分多次退完时成本之和等于原销售成本', () => {
  const env = setup()
  const { call } = env
  const { wh1, supplier, customer, item } = seed(env)
  call(OWNER, 'doc:create', {
    docType: 'PURCHASE',
    bizDate: '2026-11-01',
    warehouseId: wh1.id,
    partnerId: supplier.id,
    lines: [{ itemId: item.id, qty: 10, unitPrice: '10.00' }],
  })
  const sale = call(OWNER, 'doc:create', {
    docType: 'SALE',
    bizDate: '2026-11-05',
    warehouseId: wh1.id,
    partnerId: customer.id,
    lines: [{ itemId: item.id, qty: 5, unitPrice: '20' }],
  })
  const saleCost = sale.lines[0]!.costAmount!
  const r1 = call(OWNER, 'doc:create', {
    docType: 'SALE_RETURN',
    bizDate: '2026-11-08',
    warehouseId: wh1.id,
    partnerId: customer.id,
    refDocId: sale.id,
    lines: [{ itemId: item.id, qty: 2, refLineId: sale.lines[0]!.id }],
  })
  const r2 = call(OWNER, 'doc:create', {
    docType: 'SALE_RETURN',
    bizDate: '2026-11-09',
    warehouseId: wh1.id,
    partnerId: customer.id,
    refDocId: sale.id,
    lines: [{ itemId: item.id, qty: 3, refLineId: sale.lines[0]!.id }],
  })
  assert.equal(r1.lines[0]!.costAmount! + r2.lines[0]!.costAmount!, saleCost)
})

test('20. 退货数量超过可退数量报 RETURN_QTY_EXCEEDED', () => {
  const env = setup()
  const { call, fail } = env
  const { wh1, supplier, item } = seed(env)
  const p = call(OWNER, 'doc:create', {
    docType: 'PURCHASE',
    bizDate: '2026-11-01',
    warehouseId: wh1.id,
    partnerId: supplier.id,
    lines: [{ itemId: item.id, qty: 3, unitPrice: '10' }],
  })
  const e = fail(OWNER, 'doc:create', {
    docType: 'PURCHASE_RETURN',
    bizDate: '2026-11-05',
    warehouseId: wh1.id,
    partnerId: supplier.id,
    refDocId: p.id,
    lines: [{ itemId: item.id, qty: 5, refLineId: p.lines[0]!.id }],
  })
  assert.equal(e.code, 'RETURN_QTY_EXCEEDED')
})

test('21. 原单已被退货引用时反过账原单报 DOC_REFERENCED', () => {
  const env = setup()
  const { call, fail } = env
  const { wh1, supplier, item } = seed(env)
  const p = call(OWNER, 'doc:create', {
    docType: 'PURCHASE',
    bizDate: '2026-11-01',
    warehouseId: wh1.id,
    partnerId: supplier.id,
    lines: [{ itemId: item.id, qty: 5, unitPrice: '10' }],
  })
  const ret = call(OWNER, 'doc:create', {
    docType: 'PURCHASE_RETURN',
    bizDate: '2026-11-05',
    warehouseId: wh1.id,
    partnerId: supplier.id,
    refDocId: p.id,
    lines: [{ itemId: item.id, qty: 1, refLineId: p.lines[0]!.id }],
  })
  assert.equal(fail(OWNER, 'doc:unpost', { id: p.id }).code, 'DOC_REFERENCED')
  // D38：退货反过账成草稿后仍占用原单行外键，原单仍不可反过账/改明细。
  call(OWNER, 'doc:unpost', { id: ret.id })
  assert.equal(fail(OWNER, 'doc:unpost', { id: p.id }).code, 'DOC_REFERENCED')
  assert.equal(
    fail(OWNER, 'doc:update', {
      id: p.id,
      docType: 'PURCHASE',
      bizDate: '2026-11-01',
      warehouseId: wh1.id,
      partnerId: supplier.id,
      lines: [{ itemId: item.id, qty: 4, unitPrice: '10' }],
    }).code,
    'DOC_REFERENCED',
  )
})

test('22. 补录导致原销售成本变化后，销售退货批次金额随之更新', () => {
  const env = setup()
  const { call } = env
  const { wh1, supplier, customer, item } = seed(env)
  call(OWNER, 'doc:create', {
    docType: 'PURCHASE',
    bizDate: '2026-11-05',
    warehouseId: wh1.id,
    partnerId: supplier.id,
    lines: [{ itemId: item.id, qty: 10, unitPrice: '10.00' }],
  })
  const sale = call(OWNER, 'doc:create', {
    docType: 'SALE',
    bizDate: '2026-11-10',
    warehouseId: wh1.id,
    partnerId: customer.id,
    lines: [{ itemId: item.id, qty: 2, unitPrice: '20' }],
  })
  const ret = call(OWNER, 'doc:create', {
    docType: 'SALE_RETURN',
    bizDate: '2026-11-12',
    warehouseId: wh1.id,
    partnerId: customer.id,
    refDocId: sale.id,
    lines: [{ itemId: item.id, qty: 2, refLineId: sale.lines[0]!.id }],
  })
  assert.equal(ret.lines[0]!.costAmount, 2000)

  // 补录更便宜的采购 → 销售成本变 2×8=16；退货批次应跟着变成 1600
  call(OWNER, 'doc:create', {
    docType: 'PURCHASE',
    bizDate: '2026-11-01',
    warehouseId: wh1.id,
    partnerId: supplier.id,
    lines: [{ itemId: item.id, qty: 10, unitPrice: '8.00' }],
  })
  const afterSale = call(OWNER, 'doc:get', { id: sale.id })
  const afterRet = call(OWNER, 'doc:get', { id: ret.id })
  assert.equal(afterSale.lines[0]!.costAmount, 1600)
  assert.equal(afterRet.lines[0]!.costAmount, 1600)
})
