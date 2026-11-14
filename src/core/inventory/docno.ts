import type { DocType } from '@shared/dto'
import type { DB } from '../db/connection'
import { defineStatements } from '../db/statements'

/** 单号前缀（设计文档 6.3）。 */
export const DOC_PREFIX: Readonly<Record<DocType, string>> = {
  PURCHASE: 'CG',
  SALE: 'XS',
  TRANSFER: 'DB',
  PURCHASE_RETURN: 'CT',
  SALE_RETURN: 'XT',
}

const sql = defineStatements({
  // UPSERT + RETURNING：一条语句完成“取号并加一”，无需先查后改，也不存在两次请求拿到同一号的窗口。
  next: `INSERT INTO doc_seq (prefix, day, last_no) VALUES (?, ?, 1)
         ON CONFLICT (prefix, day) DO UPDATE SET last_no = last_no + 1
         RETURNING last_no`,
})

/**
 * 生成单号：前缀 + 创建日期 + '-' + 四位流水号，例如 XS20261114-0003。
 * 取的是**创建日期**而不是业务日期：补录早日期单据、修改业务日期时单号都不变。
 * 单日超过 9999 张时自然扩展为 5 位，不会重号（唯一约束兜底）。
 */
export function nextDocNo(db: DB, docType: DocType, createdDay: string): string {
  const prefix = DOC_PREFIX[docType]
  const day = createdDay.replaceAll('-', '')
  const { last_no } = sql(db).next.get(prefix, day) as { last_no: number }
  return `${prefix}${day}-${String(last_no).padStart(4, '0')}`
}
