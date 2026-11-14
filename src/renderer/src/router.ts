import { createRouter, createWebHashHistory, type RouteRecordRaw } from 'vue-router'
import { useSessionStore } from './stores/session'

/**
 * 路由。用 hash 模式：生产环境页面通过 file:// 加载，history 模式刷新会找不到文件。
 * 页面组件按需懒加载，首屏只加载登录页和外框。
 *
 * meta.owner：仅老板可见的页面。这里的拦截只是避免店员误入，
 * 真正的权限控制在业务进程（设计文档 5.3）。
 */
declare module 'vue-router' {
  interface RouteMeta {
    title?: string
    owner?: boolean
    public?: boolean
  }
}

const routes: RouteRecordRaw[] = [
  { path: '/login', component: () => import('./views/LoginView.vue'), meta: { public: true, title: '登录' } },
  {
    path: '/',
    component: () => import('./views/LayoutView.vue'),
    redirect: '/stock',
    children: [
      { path: 'items', component: () => import('./views/master/ItemsView.vue'), meta: { title: '商品' } },
      { path: 'warehouses', component: () => import('./views/master/WarehousesView.vue'), meta: { title: '仓库' } },
      {
        path: 'partners/:kind(supplier|customer)',
        component: () => import('./views/master/PartnersView.vue'),
        meta: { title: '往来单位' },
      },
      { path: 'users', component: () => import('./views/system/UsersView.vue'), meta: { title: '用户', owner: true } },
      {
        path: 'settings',
        component: () => import('./views/system/SettingsView.vue'),
        meta: { title: '设置', owner: true },
      },
      { path: 'password', component: () => import('./views/system/PasswordView.vue'), meta: { title: '修改密码' } },
      { path: 'stock', component: () => import('./views/HomeView.vue'), meta: { title: '首页' } },
    ],
  },
]

export const router = createRouter({ history: createWebHashHistory(), routes })

router.beforeEach(async (to) => {
  const s = useSessionStore()
  if (!s.loaded) await s.refresh()
  if (to.meta.public) return true
  if (!s.session) return { path: '/login' }
  if (to.meta.owner && !s.isOwner) return { path: '/' }
  return true
})

router.afterEach((to) => {
  document.title = to.meta.title ? `${to.meta.title} - 库存管理` : '库存管理'
})
