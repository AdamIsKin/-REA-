<script setup lang="ts">
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessageBox } from 'element-plus'
import { useSessionStore } from '../stores/session'

/**
 * 主框架：左侧菜单 + 右侧内容。
 * 菜单按角色过滤（老板 / 店员看到不同菜单，M1 验收标准）；过滤只是界面便利，权限由业务进程判断。
 */
interface MenuItem {
  path: string
  title: string
  owner?: boolean
}
interface MenuGroup {
  title: string
  items: MenuItem[]
}

const MENU: MenuGroup[] = [
  {
    title: '单据',
    items: [
      { path: '/docs/PURCHASE', title: '采购入库' },
      { path: '/purchase/details', title: '入库明细' },
      { path: '/docs/SALE', title: '销售出库' },
      { path: '/docs/TRANSFER', title: '移库' },
      { path: '/docs/PURCHASE_RETURN', title: '采购退货' },
      { path: '/docs/SALE_RETURN', title: '销售退货' },
    ],
  },
  {
    title: '库存',
    items: [
      { path: '/stock', title: '库存查询' },
      { path: '/serials', title: '串号追溯' },
      { path: '/moves', title: '库存流水' },
    ],
  },
  {
    title: '报表',
    items: [{ path: '/report/profit', title: '毛利报表', owner: true }],
  },
  {
    title: '基础资料',
    items: [
      { path: '/items', title: '商品' },
      { path: '/categories', title: '商品分类' },
      { path: '/brands', title: '品牌' },
      { path: '/warehouses', title: '仓库' },
      { path: '/partners/supplier', title: '供应商' },
      { path: '/partners/customer', title: '客户' },
    ],
  },
  {
    title: '系统',
    items: [
      { path: '/users', title: '用户管理', owner: true },
      { path: '/settings', title: '设置', owner: true },
      { path: '/backup', title: '备份与恢复', owner: true },
      { path: '/oplog', title: '操作日志', owner: true },
      { path: '/password', title: '修改密码' },
    ],
  },
]

const store = useSessionStore()
const route = useRoute()
const router = useRouter()

const menu = computed(() =>
  MENU.map((g) => ({ ...g, items: g.items.filter((i) => !i.owner || store.isOwner) })).filter(
    (g) => g.items.length > 0,
  ),
)

/** 高亮当前菜单：单据编辑页 /docs/SALE/123 也应高亮“销售出库”，所以取最长前缀匹配。 */
const active = computed(() => {
  let best = ''
  for (const g of MENU)
    for (const i of g.items) if (route.path.startsWith(i.path) && i.path.length > best.length) best = i.path
  return best || route.path
})

const DOC_TITLES: Record<string, string> = {
  PURCHASE: '采购入库',
  SALE: '销售出库',
  TRANSFER: '移库',
  PURCHASE_RETURN: '采购退货',
  SALE_RETURN: '销售退货',
}

const pageTitle = computed(() => {
  const type = typeof route.params['type'] === 'string' ? route.params['type'] : ''
  return DOC_TITLES[type] ?? (route.meta.title as string | undefined) ?? ''
})

async function logout(): Promise<void> {
  await ElMessageBox.confirm('确定退出登录？', '提示', { type: 'warning' })
  await store.logout()
  await router.replace('/login')
}
</script>

<template>
  <el-container class="layout">
    <el-aside width="180px" class="aside">
      <div class="brand">库存管理</div>
      <!-- key 绑 active：Element Plus 的 default-active 只读初次值，路由变化时需重建才能高亮正确项 -->
      <el-menu :key="active" :default-active="active" router :default-openeds="menu.map((g) => g.title)">
        <el-sub-menu v-for="g in menu" :key="g.title" :index="g.title">
          <template #title>{{ g.title }}</template>
          <el-menu-item v-for="i in g.items" :key="i.path" :index="i.path">{{ i.title }}</el-menu-item>
        </el-sub-menu>
      </el-menu>
    </el-aside>
    <el-container>
      <el-header class="header" height="48px">
        <span class="title">{{ pageTitle }}</span>
        <span class="spacer" />
        <span class="user"> {{ store.session?.displayName }}（{{ store.isOwner ? '老板' : '店员' }}） </span>
        <el-button link type="primary" @click="logout">退出</el-button>
      </el-header>
      <el-main class="main">
        <router-view v-slot="{ Component }">
          <keep-alive :max="8">
            <component :is="Component" :key="route.fullPath" />
          </keep-alive>
        </router-view>
      </el-main>
    </el-container>
  </el-container>
</template>

<style scoped>
.layout {
  height: 100%;
}
.aside {
  background: #fff;
  border-right: 1px solid #ebeef5;
  overflow-y: auto;
}
.brand {
  height: 48px;
  line-height: 48px;
  text-align: center;
  font-weight: 600;
  font-size: 16px;
  border-bottom: 1px solid #ebeef5;
}
.aside :deep(.el-menu) {
  border-right: none;
}
.header {
  display: flex;
  align-items: center;
  gap: 12px;
  background: #fff;
  border-bottom: 1px solid #ebeef5;
}
.title {
  font-size: 16px;
  font-weight: 500;
}
.spacer {
  flex: 1;
}
.main {
  padding: 0;
  overflow: auto;
}
</style>
