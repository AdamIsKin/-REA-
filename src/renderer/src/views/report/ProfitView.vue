<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import type { ProfitReport } from '@shared/dto'
import { call } from '../../api'
import { showError } from '../../api/errors'
import { today, yuan } from '../../utils/format'

const report = ref<ProfitReport | null>(null)
const query = reactive({
  dateFrom: today().slice(0, 8) + '01',
  dateTo: today(),
  dimension: 'day' as 'day' | 'item',
})

async function load(): Promise<void> {
  try {
    report.value = await call('report:profit', { ...query })
  } catch (e) {
    showError(e)
  }
}

onMounted(load)
</script>

<template>
  <div class="page">
    <div class="toolbar">
      <el-date-picker v-model="query.dateFrom" type="date" value-format="YYYY-MM-DD" />
      <el-date-picker v-model="query.dateTo" type="date" value-format="YYYY-MM-DD" />
      <el-radio-group v-model="query.dimension" @change="load">
        <el-radio-button value="day">按日</el-radio-button>
        <el-radio-button value="item">按商品</el-radio-button>
      </el-radio-group>
      <el-button type="primary" @click="load">查询</el-button>
    </div>
    <el-table v-if="report" :data="report.rows" border stripe height="100%" show-summary :summary-method="() => {
      if (!report) return []
      const t = report.totals
      return ['合计', yuan(t.salesAmount), yuan(t.salesCost), yuan(t.salesProfit), yuan(t.purchaseReturnVariance)]
    }">
      <el-table-column prop="label" :label="query.dimension === 'day' ? '日期' : '商品'" min-width="160" />
      <el-table-column label="销售收入" width="120" align="right">
        <template #default="{ row }">{{ yuan(row.salesAmount) }}</template>
      </el-table-column>
      <el-table-column label="销售成本" width="120" align="right">
        <template #default="{ row }">{{ yuan(row.salesCost) }}</template>
      </el-table-column>
      <el-table-column label="销售毛利" width="120" align="right">
        <template #default="{ row }">{{ yuan(row.salesProfit) }}</template>
      </el-table-column>
      <el-table-column label="采购退货成本差异" width="150" align="right">
        <template #default="{ row }">{{ yuan(row.purchaseReturnVariance) }}</template>
      </el-table-column>
    </el-table>
  </div>
</template>
