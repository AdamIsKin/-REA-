import { BizError } from '../domain/errors'
import { inTransaction } from '../db/tx'
import { handler } from '../rpc'
import { getDocDetail, listDocs } from './query'
import { createAndPost, post, unpost, updateAndPost } from './service'

export const inventoryHandlers = {
  'doc:list': handler('doc:list', 'user', (ctx, input) => listDocs(ctx.core.db, ctx.session.role, input)),

  'doc:get': handler('doc:get', 'user', (ctx, input) => getDocDetail(ctx.core.db, input.id, ctx.session.role)),

  'doc:create': handler('doc:create', 'user', (ctx, input) => {
    const id = inTransaction(ctx.core.db, () => createAndPost(ctx.core.db, ctx.core.clock, ctx.session, input))
    return getDocDetail(ctx.core.db, id, ctx.session.role)
  }),

  'doc:update': handler('doc:update', 'owner', (ctx, input) => {
    const { id, ...rest } = input
    inTransaction(ctx.core.db, () => updateAndPost(ctx.core.db, ctx.core.clock, ctx.session, id, rest))
    return getDocDetail(ctx.core.db, id, ctx.session.role)
  }),

  'doc:unpost': handler('doc:unpost', 'owner', (ctx, input) => {
    inTransaction(ctx.core.db, () => unpost(ctx.core.db, ctx.core.clock, ctx.session, input.id))
    return getDocDetail(ctx.core.db, input.id, ctx.session.role)
  }),

  'doc:post': handler('doc:post', 'user', (ctx, input) => {
    inTransaction(ctx.core.db, () => post(ctx.core.db, ctx.core.clock, ctx.session, input.id))
    return getDocDetail(ctx.core.db, input.id, ctx.session.role)
  }),

  'doc:returnable': handler('doc:returnable', 'user', () => {
    throw new BizError('INTERNAL', undefined, '退货功能开发中（M4）')
  }),

  'doc:findBySerial': handler('doc:findBySerial', 'user', () => null),
}
