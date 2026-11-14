import { contextBridge, ipcRenderer } from 'electron'
import type { PreloadApi } from './api'

/**
 * 预加载脚本：只暴露一组固定的方法（设计文档 5.1），不写任何业务逻辑。
 *
 * 绝不直接暴露 ipcRenderer 本身：那样页面可以向任意通道发消息、监听任意事件，
 * 等于绕过了 contextIsolation。这里每个方法都写死了通道名。
 */
const api: PreloadApi = {
  invoke: (channel, payload) => ipcRenderer.invoke('rpc', channel, payload),
  shell: {
    saveDialog: (opts) => ipcRenderer.invoke('shell:saveDialog', opts),
    openDialog: (opts) => ipcRenderer.invoke('shell:openDialog', opts),
    print: (req) => ipcRenderer.invoke('shell:print', req),
    printToPdf: (req) => ipcRenderer.invoke('shell:printToPdf', req),
    openPath: (path) => ipcRenderer.invoke('shell:openPath', path),
    relaunch: () => ipcRenderer.invoke('shell:relaunch'),
    saveBase64: (opts) => ipcRenderer.invoke('shell:saveBase64', opts),
  },
}

contextBridge.exposeInMainWorld('api', api)
