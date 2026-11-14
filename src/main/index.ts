import { app, BrowserWindow, dialog, ipcMain, Menu, session, shell } from 'electron'
import { join } from 'node:path'
import { CoreHost } from './core-host'
import { registerShellIpc } from './shell-ipc'

/**
 * 主进程：只负责窗口、菜单、打印、对话框和请求转发，绝不操作数据库（设计文档 5.1）。
 */

// 单实例：同一台电脑同时打开两个程序会让两个业务进程写同一个库，虽然 SQLite 有锁不会损坏，
// 但会出现“这边刚过账那边看不到”的困惑，所以第二个实例直接激活已有窗口后退出。
if (!app.requestSingleInstanceLock()) {
  app.quit()
}

let mainWindow: BrowserWindow | null = null
let host: CoreHost | null = null
let quitting = false

/** 内容安全策略：只允许加载本地资源（设计文档 5.3）。开发模式下 Vite 需要 ws 热更新和内联样式。 */
const CSP = app.isPackaged
  ? "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:"
  : "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self' ws: http://localhost:*"

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1024,
    minHeight: 640,
    show: false,
    autoHideMenuBar: true,
    title: '库存管理',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      spellcheck: false,
    },
  })

  win.once('ready-to-show', () => win.show())

  // 页面内的外部链接交给系统浏览器打开，绝不在应用窗口内加载远程页面。
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (e, url) => {
    const devUrl = process.env['ELECTRON_RENDERER_URL']
    if (!devUrl || !url.startsWith(devUrl)) e.preventDefault()
  })

  const senderId = win.webContents.id
  win.on('closed', () => {
    host?.dropSession(senderId)
    if (mainWindow === win) mainWindow = null
  })

  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (!app.isPackaged && devUrl) void win.loadURL(devUrl)
  else void win.loadFile(join(__dirname, '../renderer/index.html'))
  return win
}

app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  }
})

void app.whenReady().then(() => {
  Menu.setApplicationMenu(null)

  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({ responseHeaders: { ...details.responseHeaders, 'Content-Security-Policy': [CSP] } })
  })
  // 拒绝页面申请的一切权限（摄像头、定位、通知等），库存系统用不到。
  session.defaultSession.setPermissionRequestHandler((_wc, _perm, cb) => cb(false))

  host = new CoreHost(app.getPath('userData'), app.getVersion(), (message) => {
    dialog.showErrorBox('启动失败', `业务进程启动失败：\n${message}\n\n详细信息见数据目录下的 logs/core.log`)
  })
  host.start()

  // 页面 → 主进程 → 业务进程。senderId 取自 IPC 事件，页面无法伪造，用于绑定登录会话。
  ipcMain.handle('rpc', (event, channel: unknown, payload: unknown) => {
    if (typeof channel !== 'string') {
      return { ok: false, error: { code: 'VALIDATION_FAILED', message: '请求通道不合法' } }
    }
    return host!.invoke(event.sender.id, channel, payload)
  })
  registerShellIpc(() => mainWindow)

  mainWindow = createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) mainWindow = createWindow()
  })
})

// 正常退出：先让业务进程完成月度备份和 WAL 检查点，再真正退出（11.4）。
app.on('before-quit', (e) => {
  if (quitting || !host) return
  e.preventDefault()
  quitting = true
  void host.shutdown().finally(() => app.quit())
})

app.on('window-all-closed', () => {
  app.quit()
})
