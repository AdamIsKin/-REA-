<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { call } from '../../api'
import { showError } from '../../api/errors'

type Row = {
  id: number
  userName: string
  action: string
  detail: string
  createdAt: string
  docId: number | null
}

const rows = ref<Row[]>([])
const total = ref(0)
const query = reactive({ page: 1, pageSize: 50 })

async function load(): Promise<void> {
  try {
    const r = await call('oplog:list', { ...query })
    rows.value = r.rows
    total.value = r.total
  } catch (e) {
    showError(e)
  }
}

function shortDetail(s: string): string {
  if (s.length <= 120) return s
  return s.slice(0, 120) + '…'
}

onMounted(load)
</script>

<template>
  <div class="page">
    <div class="toolbar">
      <strong>操作日志</strong>
      <span class="spacer" />
      <el-button @click="load">刷新</el-button>
    </div>
    <el-table :data="rows" border stripe height="100%">
      <el-table-column prop="id" label="#" width="70" />
      <el-table-column prop="createdAt" label="时间" width="170" />
      <el-table-column prop="userName" label="用户" width="120" />
      <el-table-column prop="action" label="动作" width="160" />
      <el-table-column prop="docId" label="单据ID" width="90" />
      <el-table-column label="详情" min-width="260">
        <template #default="{ row }">
          <span :title="row.detail">{{ shortDetail(row.detail) }}</span>
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
