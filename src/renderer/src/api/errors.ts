import { ElMessage } from 'element-plus'
import { ERROR_MESSAGES } from '@shared/errors'
import { ApiError } from './index'

/**
 * 把错误转成给用户看的中文提示：错误码对应的默认文案 + details 中的商品、日期、串号等关键信息
 * （设计文档第 10 节：页面按错误码显示中文提示，并显示 details 中的信息）。
 */
export function describeError(err: unknown): string {
  if (!(err instanceof ApiError)) return err instanceof Error ? err.message : String(err)
  const d = err.details ?? {}
  const base = err.message || ERROR_MESSAGES[err.code]
  switch (err.code) {
    case 'VALIDATION_FAILED': {
      const fields = d['fields'] as { path: string; message: string }[] | undefined
      return fields?.length ? `${base}：${fields.map((f) => `${f.path} ${f.message}`).join('；')}` : base
    }
    case 'STOCK_NEGATIVE':
      return `${base}（商品 ${d['itemName'] ?? d['itemId']}，仓库 ${d['warehouseName'] ?? d['warehouseId']}，${d['date']} 结存将为 ${d['qty']}）`
    case 'SERIAL_COUNT_MISMATCH':
      return `${base}（第 ${d['lineNo']} 行：数量 ${d['qty']}，串号 ${d['count']} 个）`
    case 'SERIAL_DUPLICATE_IN_DOC':
    case 'RETURN_SERIAL_NOT_IN_ORIGINAL':
      return `${base}：${d['serial']}`
    case 'SERIAL_NOT_AVAILABLE':
      return `${base}：${d['serial']}（${d['date']}，仓库 ${d['warehouseName'] ?? d['warehouseId']}）`
    case 'SERIAL_CONFLICT':
      return `${base}：${d['serial']}（${d['date']}）`
    case 'RETURN_QTY_EXCEEDED':
      return `${base}（第 ${d['lineNo'] ?? '?'} 行最多可退 ${d['available']}）`
    case 'DOC_REFERENCED':
      return `${base}：${(d['docNos'] as string[] | undefined)?.join('、') ?? ''}`
    case 'CODE_DUPLICATE':
      return `${base}：${d['value']}`
    case 'DATE_IN_FUTURE':
      return `${base}：${d['date']}`
    case 'INTERNAL':
      return d['logId'] ? `${base}（日志编号 ${d['logId']}）` : base
    default:
      return base
  }
}

export function showError(err: unknown): void {
  ElMessage.error({ message: describeError(err), duration: 5000, showClose: true })
}
