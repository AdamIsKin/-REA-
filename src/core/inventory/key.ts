/**
 * 排序键 key = (业务日期, 单据 id, 行 id)（设计文档 6.1）。
 *
 * 所有库存事件、成本批次都按这个三元组全序排列：
 * - 业务日期决定跨天顺序；
 * - 同一天按单据 id（录入先后，R7）；修改单据时 id 不变，所以单据在当天的位置也不变；
 * - 同一单据内按行 id。
 *
 * 'YYYY-MM-DD' 定长且按年月日排列，字符串字典序 = 时间序，比较不需要解析日期。
 */
export interface Key {
  date: string
  docId: number
  lineId: number
}

export function compareKey(a: Key, b: Key): number {
  if (a.date !== b.date) return a.date < b.date ? -1 : 1
  if (a.docId !== b.docId) return a.docId - b.docId
  return a.lineId - b.lineId
}

export const minKey = (a: Key, b: Key): Key => (compareKey(a, b) <= 0 ? a : b)

/** 某张单据在某天的“起点”：lineId=0 比该单任何一行都早，又比同日更早单据的所有行都晚。 */
export const docStartKey = (date: string, docId: number): Key => ({ date, docId, lineId: 0 })
