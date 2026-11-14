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

const placeholder = () => import('./views/PlaceholderView.vue')

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
      { path: 'stock', component: () => import('./views/HomeView.vue'), meta: { title: '库存查询' } },

      // M2：采购 / 销售；移库与退货列表仍进同一列表页（内部提示开发中）。
      { path: 'docs/:type', component: () => import('./views/docs/DocsListView.vue'), meta: { title: '单据' } },
      { path: 'docs/:type/:id', component: () => import('./views/docs/DocEditView.vue'), meta: { title: '单据编辑' } },

      { path: 'serials', component: placeholder, meta: { title: '串号追溯', ready: false } },
      { path: 'moves', component: placeholder, meta: { title: '库存流水', ready: false } },
      { path: 'report/profit', component: placeholder, meta: { title: '毛利报表', owner: true, ready: false } },
      { path: 'backup', component: placeholder, meta: { title: '备份与恢复', owner: true, ready: false } },
      { path: 'oplog', component: placeholder, meta: { title: '操作日志', owner: true, ready: false } },
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
