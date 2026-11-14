import { formatCents } from '@shared/money'

/** 页面只做“分 → 元”的显示，不做任何金额计算（设计文档 11.2）。 */
export const yuan = (v: number | null | undefined): string => (v === null || v === undefined ? '' : formatCents(v))

/** 表单回填：分 → 可编辑的元字符串。 */
export const toYuanInput = (v: number): string => formatCents(v)

/** 本机今天，'YYYY-MM-DD'；只用于日期选择器默认值和禁用未来日期（后端仍会检查）。 */
export function today(): string {
  const d = new Date()
  const p = (n: number) => n.toString().padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

/** el-date-picker 的 disabled-date：禁用今天之后的日期。 */
export const disableFuture = (d: Date): boolean => {
  const end = new Date()
  end.setHours(23, 59, 59, 999)
  return d.getTime() > end.getTime()
}
