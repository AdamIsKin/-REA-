import ExcelJS from 'exceljs'
import { ElMessage } from 'element-plus'
import { shellApi } from '../api'

/**
 * 页面侧 Excel 导出（设计文档 4.1 / M6）。
 *
 * 为何放在 renderer 而不是 core：
 * - exceljs 写文件是异步 I/O，与业务进程同步 RPC 模型冲突；
 * - 导出只是“把当前查询结果落盘”，不含业务规则，不必进 utilityProcess；
 * - 真实写盘仍走主进程 shell:saveBase64（页面沙箱不能直接写文件系统）。
 */

export type ExcelColumn<T> = {
  header: string
  width?: number
  /** 取值；返回 number 时按数值写入，便于 Excel 汇总。 */
  value: (row: T) => string | number | null | undefined
}

/** ArrayBuffer → base64，分块避免大文件展开参数列表爆栈。 */
function toBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf)
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(binary)
}

export async function exportExcel<T>(
  opts: {
    fileName: string
    sheetName?: string
    columns: ExcelColumn<T>[]
    rows: T[]
  },
): Promise<void> {
  if (opts.rows.length === 0) {
    ElMessage.warning('没有可导出的数据')
    return
  }
  const wb = new ExcelJS.Workbook()
  wb.creator = '库存管理'
  const sheet = wb.addWorksheet(opts.sheetName ?? 'Sheet1')
  sheet.columns = opts.columns.map((c) => ({
    header: c.header,
    width: c.width ?? 14,
  }))
  for (const row of opts.rows) {
    sheet.addRow(opts.columns.map((c) => {
      const v = c.value(row)
      return v === null || v === undefined ? '' : v
    }))
  }
  // 表头加粗，一眼能辨认列名（FAANG 常见报表导出约定）。
  sheet.getRow(1).font = { bold: true }

  const buffer = await wb.xlsx.writeBuffer()
  const path = await shellApi().saveBase64({
    defaultPath: opts.fileName.endsWith('.xlsx') ? opts.fileName : `${opts.fileName}.xlsx`,
    filters: [{ name: 'Excel', extensions: ['xlsx'] }],
    base64: toBase64(buffer as ArrayBuffer),
  })
  if (!path) return
  ElMessage.success(`已导出：${path}`)
}
