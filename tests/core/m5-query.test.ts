import { test } from 'node:test'
import assert from 'node:assert/strict'
import { CLERK, OWNER, setup, sns } from './helpers'

test('库存查询：老板有金额字段，店员没有', () => {
  const env = setup()
  const { call } = env
  const wh = call(OWNER, 'warehouse:save', { code: 'W1', name: '仓' })
  const s = call(OWNER, 'partner:save', { kind: 'supplier', code: 'S1', name: '供' })
  const item = call(OWNER, 'item:save', {
    name: '手机',
    serialType: 'single',
  })
  call(OWNER, 'doc:create', {
    docType: 'PURCHASE',
    bizDate: '2026-11-01',
    warehouseId: wh.id,
    partnerId: s.id,
    lines: [{ itemId: item.id, qty: 5, unitPrice: '10', serials: sns('Q', 5) }],
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

test('采购入库明细按串号展开；user:options 对店员可用', () => {
  const env = setup()
  const { call } = env
  const wh = call(OWNER, 'warehouse:save', { code: 'W1', name: '仓' })
  const s = call(OWNER, 'partner:save', { kind: 'supplier', code: 'S1', name: '供' })
  const item = call(OWNER, 'item:save', {
    name: '手机B',
    serialType: 'single',
  })
  call(OWNER, 'doc:create', {
    docType: 'PURCHASE',
    bizDate: '2026-11-01',
    warehouseId: wh.id,
    partnerId: s.id,
    lines: [{ itemId: item.id, qty: 2, unitPrice: '100', serials: ['DET1', 'DET2'], rebatePerUnit: '5', rebateAmount: '10' }],
  })
  const detail = call(CLERK, 'purchase:detailList', { page: 1, pageSize: 50 })
  assert.equal(detail.total, 2)
  assert.equal(detail.rows[0]!.qty, 1)
  assert.equal(detail.rows[0]!.lineQty, 2)
  assert.equal(detail.rows[0]!.rebatePerUnit, 500)

  const opts = call(CLERK, 'user:options', {})
  assert.ok(opts.length >= 2)
  assert.ok(opts.every((u) => 'displayName' in u && 'username' in u))

  const stats = call(CLERK, 'purchase:statList', {})
  assert.equal(stats.length, 1)
  assert.equal(stats[0]!.itemName, '手机B')
  assert.equal(stats[0]!.qty, 2)
  assert.equal(stats[0]!.unitPrice, 10000)
  assert.equal(stats[0]!.amount, 20000)
})
