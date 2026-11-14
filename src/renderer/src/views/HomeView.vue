<script setup lang="ts">
import { onMounted, ref } from 'vue'
import type { SystemInfo } from '@shared/dto'
import { call } from '../api'

const info = ref<SystemInfo | null>(null)
onMounted(async () => {
  info.value = await call('system:info', {})
})
</script>

<template>
  <div class="page">
    <el-descriptions v-if="info" title="系统信息" :column="1" border>
      <el-descriptions-item label="程序版本">{{ info.appVersion }}</el-descriptions-item>
      <el-descriptions-item label="数据库版本">{{ info.schemaVersion }}</el-descriptions-item>
      <el-descriptions-item label="SQLite">{{ info.sqliteVersion }}</el-descriptions-item>
      <el-descriptions-item label="数据目录">{{ info.dataDir }}</el-descriptions-item>
    </el-descriptions>
  </div>
</template>
