import type { DocInputParsed } from '@shared/contracts'
import type { SessionInfo } from '@shared/dto'
import { writeOpLog } from '../audit'
import type { DB } from '../db/connection'
import { assertInTransaction } from '../db/tx'
import { localDate, type Clock } from '../domain/clock'
import { BizError, ensure } from '../domain/errors'
import { recalculateItem } from './cost'
import { nextDocNo } from './docno'
import { Affected, applyEffects, flushBalances, removeEffects } from './effects'
import {
  getDoc,
  getDocSerials,
  getLines,
  insertDoc,
  markDraft,
  markPosted,
  replaceLines,
  updateHeader,
  type DocRecord,
  type HeaderWrite,
} from './repo'
import { checkSerialTimeline, checkStockTimeline } from './timeline'
import { normalizeDoc } from './validate'

/**
 * 过账编排（设计文档 7.2–7.4）。
 *
 * 状态切换与成本重算的顺序很关键：
 * - 过账：先 markPosted 再重算，否则 events 按 status=posted 过滤时看不到本单；
 * - 反过账：先 markDraft 再重算，否则本单仍会被重放，分配会写回已撤销的出库行。
 */

function createdDay(now: string): string {
  return localDate(new Date(now))
}

function runCost(db: DB, aff: Affected, userId: number, now: string, reason: string): void {
  for (const [itemId, from] of aff.costFrom) {
    recalculateItem(db, itemId, from, userId, now, reason)
  }
}

function assertNotReferenced(db: DB, docId: number): void {
  const refs = db
    .prepare(`SELECT doc_no FROM doc WHERE ref_doc_id = ? AND status = 'posted'`)
    .all(docId) as { doc_no: string }[]
  if (refs.length > 0) throw new BizError('DOC_REFERENCED', { docNos: refs.map((r) => r.doc_no) })
}

function postDraft(db: DB, docId: number, userId: number, now: string, reason: string): void {
  const doc = getDoc(db, docId)
  ensure(doc, 'NOT_FOUND', { type: 'doc', id: docId })
  ensure(doc.status === 'draft', 'DOC_STATE_INVALID', { status: doc.status })
  const lines = getLines(db, docId)
  ensure(lines.length > 0, 'VALIDATION_FAILED', { field: 'lines' }, '单据没有明细')
  const serials = getDocSerials(db, docId)
  const aff = new Affected()
  applyEffects(db, doc, lines, serials, aff)
  checkStockTimeline(db, aff)
  checkSerialTimeline(db, aff)
  flushBalances(db, aff)
  markPosted(db, docId, now)
  runCost(db, aff, userId, now, reason)
}

function unpostPosted(db: DB, doc: DocRecord, userId: number, now: string, reason: string): Affected {
  ensure(doc.status === 'posted', 'DOC_STATE_INVALID', { status: doc.status })
  assertNotReferenced(db, doc.id)
  const lines = getLines(db, doc.id)
  const aff = new Affected()
  removeEffects(db, doc, lines, aff)
  checkStockTimeline(db, aff)
  checkSerialTimeline(db, aff)
  flushBalances(db, aff)
  markDraft(db, doc.id, userId, now)
  runCost(db, aff, userId, now, reason)
  return aff
}

export function createAndPost(db: DB, clock: Clock, session: SessionInfo, input: DocInputParsed): number {
  assertInTransaction(db)
  const norm = normalizeDoc(db, input, clock.today())
  const now = clock.now()
  const docNo = nextDocNo(db, norm.header.docType, createdDay(now))
  const id = insertDoc(db, docNo, norm.header, session.userId, now)
  replaceLines(db, id, norm.lines)
  postDraft(db, id, session.userId, now, 'post')
  writeOpLog(db, session.userId, 'doc.create', { id, docNo, docType: norm.header.docType }, id, now)
  return id
}

export function updateAndPost(
  db: DB,
  clock: Clock,
  session: SessionInfo,
  id: number,
  input: DocInputParsed,
): void {
  assertInTransaction(db)
  const doc = getDoc(db, id)
  ensure(doc, 'NOT_FOUND', { type: 'doc', id })
  ensure(doc.doc_type === input.docType, 'VALIDATION_FAILED', { field: 'docType' }, '不能修改单据类型')
  if (doc.status === 'posted') ensure(session.role === 'owner', 'FORBIDDEN', { required: 'owner' })

  const norm = normalizeDoc(db, input, clock.today())
  const header: HeaderWrite = {
    ...norm.header,
    refDocId: doc.ref_doc_id,
    toWarehouseId: doc.to_warehouse_id,
  }
  const now = clock.now()
  const aff = new Affected()

  if (doc.status === 'posted') {
    assertNotReferenced(db, id)
    removeEffects(db, doc, getLines(db, id), aff)
    // 先改成 draft，避免随后重算时把旧单再算进去；新内容过账时再 markPosted。
    markDraft(db, id, session.userId, now)
  }

  updateHeader(db, id, header, session.userId, now)
  replaceLines(db, id, norm.lines)

  const fresh = getDoc(db, id)!
  const lines = getLines(db, id)
  const serials = getDocSerials(db, id)
  applyEffects(db, fresh, lines, serials, aff)
  checkStockTimeline(db, aff)
  checkSerialTimeline(db, aff)
  flushBalances(db, aff)
  markPosted(db, id, now)
  runCost(db, aff, session.userId, now, 'update')
  writeOpLog(db, session.userId, 'doc.update', { id, docNo: doc.doc_no }, id, now)
}

export function unpost(db: DB, clock: Clock, session: SessionInfo, id: number): void {
  assertInTransaction(db)
  ensure(session.role === 'owner', 'FORBIDDEN', { required: 'owner' })
  const doc = getDoc(db, id)
  ensure(doc, 'NOT_FOUND', { type: 'doc', id })
  const now = clock.now()
  unpostPosted(db, doc, session.userId, now, 'unpost')
  writeOpLog(db, session.userId, 'doc.unpost', { id, docNo: doc.doc_no }, id, now)
}

export function post(db: DB, clock: Clock, session: SessionInfo, id: number): void {
  assertInTransaction(db)
  const doc = getDoc(db, id)
  ensure(doc, 'NOT_FOUND', { type: 'doc', id })
  const now = clock.now()
  postDraft(db, id, session.userId, now, 'post')
  writeOpLog(db, session.userId, 'doc.post', { id, docNo: doc.doc_no }, id, now)
}
