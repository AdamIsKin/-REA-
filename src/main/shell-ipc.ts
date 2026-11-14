import { app, BrowserWindow, dialog, ipcMain, shell, type FileFilter } from 'electron'
import { writeFile } from 'node:fs/promises'

/**
 * 只能由主进程完成的“外壳”能力：文件对话框、打印、重启、打开目录。
 * 这些操作不涉及业务数据，不经过业务进程。
 *
 * 打印方案（设计文档 4.1）：页面把已渲染好的 HTML（条码已转成内联 SVG）交给主进程，
 * 主进程在一个隐藏窗口里加载后调用 webContents.print / printToPDF。
 * 隐藏窗口禁用 JavaScript、不挂 preload，打印内容即使含有用户录入的文字也无法执行脚本。
 */

export interface PrintRequest {
  html: string
  /** true：直接打印到默认打印机；false：弹出系统打印对话框。 */
  silent?: boolean
  landscape?: boolean
  pageSize?: 'A4' | 'A5' | { width: number; height: number }
}

async function withPrintWindow<T>(html: string, fn: (win: BrowserWindow) => Promise<T>): Promise<T> {
  const win = new BrowserWindow({
    show: false,
    webPreferences: { javascript: false, sandbox: true, contextIsolation: true, nodeIntegration: false },
  })
  try {
    await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
    return await fn(win)
  } finally {
    win.destroy()
  }
}

function toElectronPageSize(p: PrintRequest['pageSize']) {
  // Electron 自定义纸张单位为微米；页面传入毫米，便于和标签纸规格对应。
  if (p && typeof p === 'object') return { width: p.width * 1000, height: p.height * 1000 }
  return p ?? 'A4'
}

export function registerShellIpc(getWindow: () => BrowserWindow | null): void {
  ipcMain.handle('shell:saveDialog', async (_e, opts: { defaultPath?: string; filters?: FileFilter[] }) => {
    const win = getWindow()
    const r = win
      ? await dialog.showSaveDialog(win, { defaultPath: opts?.defaultPath, filters: opts?.filters })
      : await dialog.showSaveDialog({ defaultPath: opts?.defaultPath, filters: opts?.filters })
    return r.canceled ? null : (r.filePath ?? null)
  })

  ipcMain.handle('shell:openDialog', async (_e, opts: { filters?: FileFilter[] }) => {
    const win = getWindow()
    const options = { properties: ['openFile' as const], filters: opts?.filters }
    const r = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
    return r.canceled ? null : (r.filePaths[0] ?? null)
  })

  ipcMain.handle('shell:print', (_e, req: PrintRequest) =>
    withPrintWindow(
      req.html,
      (win) =>
        new Promise<{ ok: boolean; error?: string }>((resolve) => {
          win.webContents.print(
            {
              silent: req.silent ?? false,
              printBackground: true,
              landscape: req.landscape ?? false,
              pageSize: toElectronPageSize(req.pageSize),
            },
            (success, failureReason) => resolve(success ? { ok: true } : { ok: false, error: failureReason }),
          )
        }),
    ),
  )

  ipcMain.handle('shell:printToPdf', async (_e, req: PrintRequest & { defaultPath?: string }) => {
    const win = getWindow()
    const opts = { defaultPath: req.defaultPath, filters: [{ name: 'PDF', extensions: ['pdf'] }] }
    const r = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts)
    if (r.canceled || !r.filePath) return null
    const pdf = await withPrintWindow(req.html, (w) =>
      w.webContents.printToPDF({
        printBackground: true,
        landscape: req.landscape ?? false,
        pageSize: toElectronPageSize(req.pageSize),
      }),
    )
    await writeFile(r.filePath, pdf)
    return r.filePath
  })

  ipcMain.handle('shell:openPath', (_e, path: string) => shell.openPath(String(path)))

  /** 恢复备份后需要重启：业务进程会重新打开替换后的数据库文件。 */
  ipcMain.handle('shell:relaunch', () => {
    app.relaunch()
    app.quit()
  })

  /** 页面导出 Excel 等：先弹另存对话框，再把 base64 写入文件。 */
  ipcMain.handle(
    'shell:saveBase64',
    async (_e, opts: { defaultPath?: string; filters?: FileFilter[]; base64: string }) => {
      const win = getWindow()
      const dialogOpts = {
        defaultPath: opts.defaultPath,
        filters: opts.filters ?? [{ name: 'All', extensions: ['*'] }],
      }
      const r = win ? await dialog.showSaveDialog(win, dialogOpts) : await dialog.showSaveDialog(dialogOpts)
      if (r.canceled || !r.filePath) return null
      await writeFile(r.filePath, Buffer.from(opts.base64, 'base64'))
      return r.filePath
    },
  )
}
