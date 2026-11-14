import type { RpcResult } from '../shared/errors'

/** 预加载脚本暴露给页面的接口类型；页面与 preload 共用，保证两边签名一致。 */

export interface FileFilter {
  name: string
  extensions: string[]
}

export interface PrintRequest {
  html: string
  silent?: boolean
  landscape?: boolean
  /** 自定义纸张单位为毫米。 */
  pageSize?: 'A4' | 'A5' | { width: number; height: number }
}

export interface PreloadApi {
  invoke(channel: string, payload: unknown): Promise<RpcResult<unknown>>
  shell: {
    saveDialog(opts: { defaultPath?: string; filters?: FileFilter[] }): Promise<string | null>
    openDialog(opts: { filters?: FileFilter[] }): Promise<string | null>
    print(req: PrintRequest): Promise<{ ok: boolean; error?: string }>
    printToPdf(req: PrintRequest & { defaultPath?: string }): Promise<string | null>
    openPath(path: string): Promise<string>
    relaunch(): Promise<void>
    saveBase64(opts: {
      defaultPath?: string
      filters?: FileFilter[]
      base64: string
    }): Promise<string | null>
  }
}

declare global {
  interface Window {
    api: PreloadApi
  }
}
