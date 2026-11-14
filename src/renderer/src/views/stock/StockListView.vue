<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import type { StockRow, WarehouseRow } from '@shared/dto'
import { formatCents } from '@shared/money'
import { call } from '../../api'
import { showError } from '../../api/errors'
import { exportExcel } from '../../export/excel'
import { useSessionStore } from '../../stores/session'
import { yuan } from '../../utils/format'

const session = useSessionStore()
const rows = ref<StockRow[]>([])
const warehouses = ref<WarehouseRow[]>([])
const query = reactive({ warehouseId: undefined as number | undefined, keyword: '', onlyPositive: true })

async function load(): Promise<void> {
  rows.value = await call('stock:list', { ...query })
}

/**
 * R10/D28：库存金额只到商品维度。列表按「仓库×商品」分行时，同一商品多仓会重复同一个合计；
 * 仅在该商品首次出现的行显示金额，其余行显示 —，避免当成「本仓库存金额」。
 */
function isFirstItemRow(row: StockRow, index: number): boolean {
  const prev = rows.value[index - 1]
  return !prev || prev.itemId !== row.itemId
}

async function doExport(): Promise<void> {
  try {
    await exportExcel({
      fileName: '库存查询.xlsx',
      sheetName: '库存',
      columns: [
        { header: '仓库', value: (r: StockRow) => r.warehouseName },
        { header: '编码', value: (r: StockRow) => r.itemCode },
        { header: '名称', value: (r: StockRow) => r.itemName },
        { header: '规格', value: (r: StockRow) => r.itemSpec },
        { header: '单位', value: (r: StockRow) => r.unit },
        { header: '数量', value: (r: StockRow) => r.qty },
        ...(session.isOwner
          ? [
              {
                header: '商品库存金额',
                value: (r: StockRow) => {
                  const idx = rows.value.indexOf(r)
                  if (idx < 0 || !isFirstItemRow(r, idx)) return ''
                  return r.amount == null ? '' : formatCents(r.amount)
                },
              },
            ]
          : []),
      ],
      rows: rows.value,
    })
  } catch (e) {
    showError(e)
  }
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
      <span class="spacer" />
      <el-button @click="doExport">导出 Excel</el-button>
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
      <el-table-column v-if="session.isOwner" label="商品库存金额" width="130" align="right">
        <template #default="{ row, $index }">
          {{ isFirstItemRow(row, $index) ? yuan(row.amount) : '—' }}
        </template>
      </el-table-column>
    </el-table>
  </div>
</template>
