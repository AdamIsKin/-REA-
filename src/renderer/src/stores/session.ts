import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import type { SessionInfo } from '@shared/dto'
import { call } from '../api'

/**
 * 登录状态。真正的会话在业务进程里，这里只是界面侧的镜像：
 * 用来决定显示哪些菜单、隐藏哪些按钮（只是便利，安全由业务进程保证）。
 */
export const useSessionStore = defineStore('session', () => {
  const session = ref<SessionInfo | null>(null)
  const needsSetup = ref(false)
  const loaded = ref(false)

  const isOwner = computed(() => session.value?.role === 'owner')

  async function refresh(): Promise<void> {
    const s = await call('auth:status', {})
    session.value = s.session
    needsSetup.value = s.needsSetup
    loaded.value = true
  }

  async function login(username: string, password: string): Promise<void> {
    session.value = await call('auth:login', { username, password })
  }

  async function setupOwner(username: string, displayName: string, password: string): Promise<void> {
    session.value = await call('auth:setupOwner', { username, displayName, password })
    needsSetup.value = false
  }

  async function logout(): Promise<void> {
    await call('auth:logout', {})
    session.value = null
  }

  return { session, needsSetup, loaded, isOwner, refresh, login, setupOwner, logout }
})
