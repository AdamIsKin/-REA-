import { test } from 'node:test'
import assert from 'node:assert/strict'
import { CLERK, OWNER, setup } from './helpers'

test('迁移后 schema 版本为最新，外键开启', () => {
  const { db } = setup()
  assert.equal(db.pragma('user_version', { simple: true }), 2)
  assert.equal(db.pragma('foreign_keys', { simple: true }), 1)
})

test('未登录请求返回 AUTH_REQUIRED', () => {
  const { fail } = setup()
  assert.equal(fail(99, 'warehouse:list', {}).code, 'AUTH_REQUIRED')
})

test('店员调用老板专属功能返回 FORBIDDEN', () => {
  const { fail } = setup()
  assert.equal(fail(CLERK, 'user:list', {}).code, 'FORBIDDEN')
})

test('店员维护基础资料成功并写入操作日志（D26）', () => {
  const { call, db } = setup()
  const wh = call(CLERK, 'warehouse:save', { code: 'W1', name: '门店' })
  call(CLERK, 'warehouse:save', { id: wh.id, code: 'W1', name: '门店仓' })
  const logs = db.prepare("SELECT action, detail FROM op_log WHERE action LIKE 'warehouse.%' ORDER BY id").all() as {
    action: string
    detail: string
  }[]
  assert.deepEqual(
    logs.map((l) => l.action),
    ['warehouse.create', 'warehouse.update'],
  )
  assert.deepEqual(JSON.parse(logs[1]!.detail).changes, { name: ['门店', '门店仓'] })
})

test('商品编码重复返回 CODE_DUPLICATE；金额按元字符串解析为分', () => {
  const { call, fail } = setup()
  const item = call(OWNER, 'item:save', {
    code: 'A1',
    name: '手机线',
    defaultBuyPrice: '1',
    defaultSellPrice: '19.9',
  })
  assert.equal(item.defaultBuyPrice, 100)
  assert.equal(item.defaultSellPrice, 1990)
  assert.equal(item.serialManaged, true)
  const e = fail(OWNER, 'item:save', {
    code: 'A1',
    name: 'x',
    defaultBuyPrice: '0',
    defaultSellPrice: '0',
  })
  assert.equal(e.code, 'CODE_DUPLICATE')
})

test('至少保留一个启用的老板账号', () => {
  const { call, fail } = setup()
  const me = call(OWNER, 'user:list', {}).find((u) => u.username === 'boss')!
  const e = fail(OWNER, 'user:update', { id: me.id, displayName: '', role: 'clerk', enabled: true })
  assert.equal(e.code, 'FORBIDDEN')
})

test('错误密码登录失败，不区分用户是否存在', () => {
  const { fail } = setup()
  const a = fail(5, 'auth:login', { username: 'boss', password: 'wrong' })
  const b = fail(5, 'auth:login', { username: 'nobody', password: 'wrong' })
  assert.equal(a.message, b.message)
})
