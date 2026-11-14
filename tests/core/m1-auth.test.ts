import { test } from 'node:test'
import assert from 'node:assert/strict'
import { CLERK, OWNER, setup } from './helpers'

test('迁移后 schema 版本为最新，外键开启', () => {
  const { db } = setup()
  assert.equal(db.pragma('user_version', { simple: true }), 3)
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

test('商品保存生成内部编码；默认单串号', () => {
  const { call, fail } = setup()
  const item = call(OWNER, 'item:save', {
    name: '荣耀100Pro',
    serialType: 'single',
  })
  assert.equal(item.name, '荣耀100Pro')
  assert.equal(item.serialManaged, true)
  assert.equal(item.serialType, 'single')
  assert.ok(item.code.length > 0)
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
