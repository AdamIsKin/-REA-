import { createRouter, createWebHashHistory, type RouteRecordRaw } from 'vue-router'
import { DOC_TYPE_LABEL, type DocType } from '@shared/dto'
import { useSessionStore } from './stores/session'

declare module 'vue-router' {
  interface RouteMeta {
    title?: string
    owner?: boolean
    public?: boolean
    ready?: boolean
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
      { path: 'users', component: () => import('./views/system/UsersView.vue'), meta: { title: '用户管理', owner: true } },
      {
        path: 'settings',
        component: () => import('./views/system/SettingsView.vue'),
        meta: { title: '设置', owner: true },
      },
      { path: 'password', component: () => import('./views/system/PasswordView.vue'), meta: { title: '修改密码' } },
      { path: 'stock', component: () => import('./views/stock/StockListView.vue'), meta: { title: '库存查询' } },
      { path: 'docs/:type', component: () => import('./views/docs/DocsListView.vue'), meta: { title: '单据' } },
      { path: 'docs/:type/:id', component: () => import('./views/docs/DocEditView.vue'), meta: { title: '单据编辑' } },
      { path: 'serials', component: () => import('./views/stock/SerialTraceView.vue'), meta: { title: '串号追溯' } },
      { path: 'moves', component: () => import('./views/stock/MovesView.vue'), meta: { title: '库存流水' } },
      {
        path: 'report/profit',
        component: () => import('./views/report/ProfitView.vue'),
        meta: { title: '毛利报表', owner: true },
      },
      {
        path: 'backup',
        component: () => import('./views/system/BackupView.vue'),
        meta: { title: '备份与恢复', owner: true },
      },
      {
        path: 'oplog',
        component: () => import('./views/system/OplogView.vue'),
        meta: { title: '操作日志', owner: true },
      },
    ],
  },
  { path: '/:pathMatch(.*)*', redirect: '/stock' },
]

export const router = createRouter({ history: createWebHashHistory(), routes })

router.beforeEach(async (to) => {
  const s = useSessionStore()
  if (!s.loaded) await s.refresh()
  if (to.meta.public) return true
  if (!s.session) return { path: '/login' }
  if (to.meta.owner && !s.isOwner) return { path: '/stock' }
  return true
})

router.afterEach((to) => {
  const type = typeof to.params['type'] === 'string' ? (to.params['type'] as DocType) : undefined
  const title = (type && DOC_TYPE_LABEL[type]) || (to.meta.title as string | undefined)
  document.title = title ? `${title} - 库存管理` : '库存管理'
})
