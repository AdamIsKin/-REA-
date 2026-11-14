<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import { DOC_TYPE_LABEL, type SerialTrace } from '@shared/dto'
import { call } from '../../api'
import { showError } from '../../api/errors'

const route = useRoute()
const serial = ref('')
const result = ref<SerialTrace | null>(null)

async function search(): Promise<void> {
  try {
    result.value = await call('serial:trace', { serial: serial.value.trim() })
  } catch (e) {
    showError(e)
  }
}

onMounted(() => {
  const q = route.query['serial']
  const sn = typeof q === 'string' ? q.trim() : Array.isArray(q) ? String(q[0] ?? '').trim() : ''
  if (sn) {
    serial.value = sn
    void search()
  }
})
</script>

<template>
  <div class="page">
    <div class="toolbar">
      <el-input v-model="serial" placeholder="输入或扫描串号" style="width: 280px" @keyup.enter="search" />
      <el-button type="primary" @click="search">追溯</el-button>
    </div>
    <template v-if="result">
      <el-descriptions :column="2" border>
        <el-descriptions-item label="串号">{{ result.serial }}</el-descriptions-item>
        <el-descriptions-item label="商品">{{ result.itemCode }} {{ result.itemName }}</el-descriptions-item>
        <el-descriptions-item label="当前位置">
          {{ result.currentWarehouseName ?? '不在库' }}
        </el-descriptions-item>
      </el-descriptions>
      <el-table :data="result.events" border stripe style="margin-top: 12px" height="100%">
        <el-table-column prop="bizDate" label="日期" width="110" />
        <el-table-column prop="docNo" label="单号" width="160" />
        <el-table-column label="类型" width="100">
          <template #default="{ row }">{{ DOC_TYPE_LABEL[row.docType as keyof typeof DOC_TYPE_LABEL] }}</template>
        </el-table-column>
        <el-table-column prop="warehouseName" label="仓库" width="120" />
        <el-table-column label="变动" width="80" align="right">
          <template #default="{ row }">{{ row.delta > 0 ? '+1' : '-1' }}</template>
        </el-table-column>
        <el-table-column prop="running" label="合计在库" width="90" align="right" />
      </el-table>
    </template>
  </div>
</template>
