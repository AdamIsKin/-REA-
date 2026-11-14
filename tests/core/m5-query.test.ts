import { test } from 'node:test'
import assert from 'node:assert/strict'
import { CLERK, OWNER, setup } from './helpers'

test('库存查询：老板有金额字段，店员没有', () => {
  const env = setup()
  const { call } = env
  const wh = call(OWNER, 'warehouse:save', { code: 'W1', name: '仓' })
  const s = call(OWNER, 'partner:save', { kind: 'supplier', code: 'S1', name: '供' })
  const item = call(OWNER, 'item:save', {
    code: 'A1',
    name: '配件',
    serialManaged: false,
    defaultBuyPrice: '10',
    defaultSellPrice: '20',
  })
  call(OWNER, 'doc:create', {
    docType: 'PURCHASE',
    bizDate: '2026-11-01',
    warehouseId: wh.id,
    partnerId: s.id,
    lines: [{ itemId: item.id, qty: 5, unitPrice: '10' }],
  })
  const ownerRows = call(OWNER, 'stock:list', {})
  const clerkRows = call(CLERK, 'stock:list', {})
  assert.equal(ownerRows[0]!.qty, 5)
  assert.equal(ownerRows[0]!.amount, 5000)
  assert.equal(clerkRows[0]!.qty, 5)
  assert.equal(clerkRows[0]!.amount, undefined)
})

test('毛利报表仅老板可查；店员 FORBIDDEN', () => {
  const env = setup()
  const { call, fail } = env
  assert.equal(
    fail(CLERK, 'report:profit', { dateFrom: '2026-11-01', dateTo: '2026-11-14' }).code,
    'FORBIDDEN',
  )
  const r = call(OWNER, 'report:profit', { dateFrom: '2026-11-01', dateTo: '2026-11-14', dimension: 'day' })
  assert.ok(Array.isArray(r.rows))
})
