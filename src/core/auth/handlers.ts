import type { SessionInfo, UserRow } from '@shared/dto'
import { diff, writeOpLog } from '../audit'
import { defineStatements } from '../db/statements'
import { inTransaction } from '../db/tx'
import { BizError, ensure } from '../domain/errors'
import { handler } from '../rpc'
import { hashPassword, verifyPassword } from './password'

interface UserRecord {
  id: number
  username: string
  display_name: string
  password_hash: string
  role: 'owner' | 'clerk'
  enabled: number
  created_at: string
}

const sql = defineStatements({
  count: 'SELECT COUNT(*) AS n FROM user',
  byId: 'SELECT * FROM user WHERE id = ?',
  byName: 'SELECT * FROM user WHERE username = ?',
  list: 'SELECT * FROM user ORDER BY id',
  insert: `INSERT INTO user (username, display_name, password_hash, role, enabled, created_at)
           VALUES (@username, @displayName, @hash, @role, 1, @now)`,
  update: 'UPDATE user SET display_name = @displayName, role = @role, enabled = @enabled WHERE id = @id',
  setPassword: 'UPDATE user SET password_hash = ? WHERE id = ?',
  countActiveOwners: "SELECT COUNT(*) AS n FROM user WHERE role = 'owner' AND enabled = 1 AND id <> ?",
})

const toRow = (u: UserRecord): UserRow => ({
  id: u.id,
  username: u.username,
  displayName: u.display_name,
  role: u.role,
  enabled: u.enabled === 1,
  createdAt: u.created_at,
})

const toSession = (u: UserRecord): SessionInfo => ({
  userId: u.id,
  username: u.username,
  displayName: u.display_name || u.username,
  role: u.role,
})

/**
 * 登录失败统一提示“用户名或密码错误”，不区分“用户不存在”和“密码错”，
 * 避免通过提示差异枚举出有效用户名。
 */
const badCredentials = () => new BizError('VALIDATION_FAILED', undefined, '用户名或密码错误')

export const authHandlers = {
  'auth:status': handler('auth:status', 'public', (ctx) => {
    const n = (sql(ctx.core.db).count.get() as { n: number }).n
    return { needsSetup: n === 0, session: ctx.session }
  }),

  /** 首次启动引导：只有在一个用户都没有时才允许创建老板账号，之后此通道永久失效。 */
  'auth:setupOwner': handler('auth:setupOwner', 'public', (ctx, input) => {
    const { db, clock, sessions } = ctx.core
    const user = inTransaction(db, () => {
      const n = (sql(db).count.get() as { n: number }).n
      ensure(n === 0, 'FORBIDDEN', undefined, '系统已初始化，不能再创建初始账号')
      const { lastInsertRowid } = sql(db).insert.run({
        username: input.username,
        displayName: input.displayName,
        hash: hashPassword(input.password),
        role: 'owner',
        now: clock.now(),
      })
      const id = Number(lastInsertRowid)
      writeOpLog(db, id, 'auth.setupOwner', { username: input.username }, null, clock.now())
      return sql(db).byId.get(id) as UserRecord
    })
    const session = toSession(user)
    sessions.set(ctx.senderId, session)
    return session
  }),

  'auth:login': handler('auth:login', 'public', (ctx, input) => {
    const { db, clock, sessions } = ctx.core
    const u = sql(db).byName.get(input.username) as UserRecord | undefined
    // 用户不存在时也执行一次哈希，让两种失败的耗时接近，防止计时侧信道。
    const ok = u ? verifyPassword(input.password, u.password_hash) : (verifyPassword(input.password, DUMMY_HASH), false)
    if (!u || !ok) throw badCredentials()
    ensure(u.enabled === 1, 'FORBIDDEN', undefined, '该账号已停用')
    const session = toSession(u)
    sessions.set(ctx.senderId, session)
    inTransaction(db, () => writeOpLog(db, u.id, 'auth.login', {}, null, clock.now()))
    return session
  }),

  'auth:logout': handler('auth:logout', 'user', (ctx) => {
    ctx.core.sessions.drop(ctx.senderId)
    return null
  }),

  'auth:changePassword': handler('auth:changePassword', 'user', (ctx, input) => {
    const { db, clock } = ctx.core
    inTransaction(db, () => {
      const u = sql(db).byId.get(ctx.session.userId) as UserRecord | undefined
      ensure(u, 'NOT_FOUND', { type: 'user', id: ctx.session.userId })
      if (!verifyPassword(input.oldPassword, u.password_hash)) {
        throw new BizError('VALIDATION_FAILED', undefined, '原密码不正确')
      }
      sql(db).setPassword.run(hashPassword(input.newPassword), u.id)
      writeOpLog(db, u.id, 'auth.changePassword', {}, null, clock.now())
    })
    return null
  }),

  // —————————————— 用户管理（仅老板） ——————————————

  'user:list': handler('user:list', 'owner', (ctx) => (sql(ctx.core.db).list.all() as UserRecord[]).map(toRow)),

  'user:create': handler('user:create', 'owner', (ctx, input) => {
    const { db, clock } = ctx.core
    return inTransaction(db, () => {
      ensure(!sql(db).byName.get(input.username), 'CODE_DUPLICATE', { field: 'username', value: input.username })
      const { lastInsertRowid } = sql(db).insert.run({
        username: input.username,
        displayName: input.displayName,
        hash: hashPassword(input.password),
        role: input.role,
        now: clock.now(),
      })
      const id = Number(lastInsertRowid)
      writeOpLog(
        db,
        ctx.session.userId,
        'user.create',
        { id, username: input.username, role: input.role },
        null,
        clock.now(),
      )
      return toRow(sql(db).byId.get(id) as UserRecord)
    })
  }),

  'user:update': handler('user:update', 'owner', (ctx, input) => {
    const { db, clock, sessions } = ctx.core
    let privilegeChanged = false
    const row = inTransaction(db, () => {
      const before = sql(db).byId.get(input.id) as UserRecord | undefined
      ensure(before, 'NOT_FOUND', { type: 'user', id: input.id })
      privilegeChanged = before.role !== input.role || (before.enabled === 1) !== input.enabled
      // 至少保留一个启用的老板，否则没人能做反过账、备份恢复和用户管理，系统会被“锁死”。
      const losingOwner = before.role === 'owner' && (input.role !== 'owner' || !input.enabled)
      if (losingOwner) {
        const others = (sql(db).countActiveOwners.get(input.id) as { n: number }).n
        ensure(others > 0, 'FORBIDDEN', undefined, '至少要保留一个启用的老板账号')
      }
      sql(db).update.run({
        id: input.id,
        displayName: input.displayName,
        role: input.role,
        enabled: input.enabled ? 1 : 0,
      })
      const after = sql(db).byId.get(input.id) as UserRecord
      writeOpLog(
        db,
        ctx.session.userId,
        'user.update',
        { id: input.id, changes: diff(toRow(before), toRow(after)) },
        null,
        clock.now(),
      )
      return toRow(after)
    })
    // 角色或启用状态变了，旧会话持有的权限立即作废；只改显示名不影响已登录状态。
    if (privilegeChanged) sessions.dropUser(input.id)
    return row
  }),

  'user:resetPassword': handler('user:resetPassword', 'owner', (ctx, input) => {
    const { db, clock } = ctx.core
    inTransaction(db, () => {
      ensure(sql(db).byId.get(input.id), 'NOT_FOUND', { type: 'user', id: input.id })
      sql(db).setPassword.run(hashPassword(input.password), input.id)
      writeOpLog(db, ctx.session.userId, 'user.resetPassword', { id: input.id }, null, clock.now())
    })
    return null
  }),
}

/** 用于“用户不存在”分支的等耗时哈希；内容无意义，只要格式合法。 */
const DUMMY_HASH = hashPassword('dummy-password-for-timing')
