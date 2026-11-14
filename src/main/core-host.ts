import { utilityProcess, type UtilityProcess } from 'electron'
import { join } from 'node:path'
import type { RpcResult } from '@shared/errors'
import type { CoreToMain, MainToCore } from '../core/ipc-protocol'

interface Pending {
  resolve: (r: RpcResult<unknown>) => void
}

/**
 * 业务进程宿主：负责拉起 utilityProcess，并把页面请求按 id 关联到响应。
 *
 * - 请求 id 用自增整数，Map 查找 O(1)；响应到达后立即删除，Map 大小只等于在途请求数；
 * - core 就绪前到达的请求先排队，就绪后按顺序发送，页面无需关心启动时序；
 * - core 意外退出时，所有在途请求立即以 INTERNAL 失败返回，避免页面永远等待。
 */
export class CoreHost {
  private proc: UtilityProcess | null = null
  private ready = false
  private nextId = 1
  private readonly pending = new Map<number, Pending>()
  private readonly queue: MainToCore[] = []
  private shutdownResolve: (() => void) | null = null
  private fatalMessage: string | null = null

  constructor(
    private readonly dataDir: string,
    private readonly appVersion: string,
    private readonly onFatal: (message: string) => void,
  ) {}

  start(): void {
    // electron-vite 把 core 和 main 打到同一个输出目录：out/main/core.js。
    const entry = join(__dirname, 'core.js')
    this.proc = utilityProcess.fork(entry, [this.dataDir, this.appVersion], {
      serviceName: 'erp-core',
      stdio: 'inherit',
    })
    this.proc.on('message', (msg: CoreToMain) => this.onMessage(msg))
    this.proc.on('exit', (code) => this.onExit(code))
  }

  invoke(senderId: number, channel: string, payload: unknown): Promise<RpcResult<unknown>> {
    if (this.fatalMessage !== null) {
      return Promise.resolve(fail(`业务进程启动失败：${this.fatalMessage}`))
    }
    return new Promise((resolve) => {
      const id = this.nextId++
      this.pending.set(id, { resolve })
      this.post({ kind: 'req', id, senderId, channel, payload })
    })
  }

  dropSession(senderId: number): void {
    this.post({ kind: 'drop-session', senderId })
  }

  /** 正常退出：通知 core 做退出前任务（月度备份、WAL 检查点），最多等待 timeoutMs。 */
  shutdown(timeoutMs = 15_000): Promise<void> {
    if (!this.proc || !this.ready) return Promise.resolve()
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.shutdownResolve = null
        resolve()
      }, timeoutMs)
      this.shutdownResolve = () => {
        clearTimeout(timer)
        resolve()
      }
      this.post({ kind: 'shutdown' })
    })
  }

  private post(msg: MainToCore): void {
    if (this.ready && this.proc) this.proc.postMessage(msg)
    else this.queue.push(msg)
  }

  private onMessage(msg: CoreToMain): void {
    switch (msg.kind) {
      case 'ready':
        this.ready = true
        for (const m of this.queue.splice(0)) this.proc!.postMessage(m)
        break
      case 'res': {
        const p = this.pending.get(msg.id)
        if (p) {
          this.pending.delete(msg.id)
          p.resolve(msg.result)
        }
        break
      }
      case 'fatal':
        this.fatalMessage = msg.message
        this.failAll(`业务进程启动失败：${msg.message}`)
        this.onFatal(msg.message)
        break
      case 'shutdown-done':
        this.shutdownResolve?.()
        this.shutdownResolve = null
        break
    }
  }

  private onExit(code: number): void {
    this.ready = false
    this.proc = null
    this.failAll(`业务进程已退出（code=${code}）`)
    this.shutdownResolve?.()
    this.shutdownResolve = null
  }

  private failAll(message: string): void {
    for (const p of this.pending.values()) p.resolve(fail(message))
    this.pending.clear()
    this.queue.length = 0
  }
}

const fail = (message: string): RpcResult<never> => ({
  ok: false,
  error: { code: 'INTERNAL', message },
})
