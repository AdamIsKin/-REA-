<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { DOC_TYPE_LABEL, type StockMoveRow, type WarehouseRow } from '@shared/dto'
import { call } from '../../api'
import { today } from '../../utils/format'

const rows = ref<StockMoveRow[]>([])
const total = ref(0)
const warehouses = ref<WarehouseRow[]>([])
const query = reactive({
  warehouseId: undefined as number | undefined,
  dateFrom: '',
  dateTo: today(),
  page: 1,
  pageSize: 100,
})

async function load(): Promise<void> {
  const r = await call('stock:moves', {
    warehouseId: query.warehouseId,
    dateFrom: query.dateFrom || undefined,
    dateTo: query.dateTo || undefined,
    page: query.page,
    pageSize: query.pageSize,
  })
  rows.value = r.rows
  total.value = r.total
}

onMounted(async () => {
  warehouses.value = await call('warehouse:list', {})
  await load()
})
</script>

<template>
  <div class="page">
    <div class="toolbar">
      <el-select v-model="query.warehouseId" clearable placeholder="全部仓库" style="width: 140px" @change="load">
        <el-option v-for="w in warehouses" :key="w.id" :label="w.name" :value="w.id" />
      </el-select>
      <el-date-picker v-model="query.dateFrom" type="date" value-format="YYYY-MM-DD" placeholder="起" />
      <el-date-picker v-model="query.dateTo" type="date" value-format="YYYY-MM-DD" placeholder="止" />
      <el-button @click="load">查询</el-button>
    </div>
    <el-table :data="rows" border stripe height="100%">
      <el-table-column prop="bizDate" label="日期" width="110" />
      <el-table-column prop="docNo" label="单号" width="160" />
      <el-table-column label="类型" width="100">
        <template #default="{ row }">{{ DOC_TYPE_LABEL[row.docType as keyof typeof DOC_TYPE_LABEL] }}</template>
      </el-table-column>
      <el-table-column prop="warehouseName" label="仓库" width="120" />
      <el-table-column prop="itemCode" label="编码" width="120" />
      <el-table-column prop="itemName" label="商品" min-width="140" />
      <el-table-column label="数量" width="90" align="right">
        <template #default="{ row }">
          <span :style="{ color: row.qty < 0 ? '#f56c6c' : '#67c23a' }">{{ row.qty > 0 ? '+' : '' }}{{ row.qty }}</span>
        </template>
      </el-table-column>
    </el-table>
    <el-pagination
      v-model:current-page="query.page"
      :page-size="query.pageSize"
      :total="total"
      layout="total, prev, pager, next"
      @current-change="load"
    />
  </div>
</template>
