<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import type { StockRow, WarehouseRow } from '@shared/dto'
import { call } from '../../api'
import { useSessionStore } from '../../stores/session'
import { yuan } from '../../utils/format'

const session = useSessionStore()
const rows = ref<StockRow[]>([])
const warehouses = ref<WarehouseRow[]>([])
const query = reactive({ warehouseId: undefined as number | undefined, keyword: '', onlyPositive: true })

async function load(): Promise<void> {
  rows.value = await call('stock:list', { ...query })
}

onMounted(async () => {
  warehouses.value = await call('warehouse:list', {})
  await load()
})
</script>

<template>
  <div class="page">
    <div class="toolbar">
      <el-select v-model="query.warehouseId" clearable placeholder="全部仓库" style="width: 160px" @change="load">
        <el-option v-for="w in warehouses" :key="w.id" :label="w.name" :value="w.id" />
      </el-select>
      <el-input v-model="query.keyword" placeholder="商品" clearable style="width: 200px" @keyup.enter="load" @clear="load" />
      <el-checkbox v-model="query.onlyPositive" @change="load">仅显示有库存</el-checkbox>
      <el-button @click="load">查询</el-button>
    </div>
    <el-table :data="rows" border stripe height="100%">
      <el-table-column prop="warehouseName" label="仓库" width="120" />
      <el-table-column prop="itemCode" label="编码" width="120" />
      <el-table-column prop="itemName" label="名称" min-width="160" />
      <el-table-column prop="itemSpec" label="规格" width="120" />
      <el-table-column prop="unit" label="单位" width="60" />
      <el-table-column label="数量" width="90" align="right">
        <template #default="{ row }">{{ row.qty }}</template>
      </el-table-column>
      <el-table-column v-if="session.isOwner" label="库存金额(商品合计)" width="160" align="right">
        <template #default="{ row }">{{ yuan(row.amount) }}</template>
      </el-table-column>
    </el-table>
  </div>
</template>
