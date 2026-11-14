<script setup lang="ts">
import { onMounted, ref } from 'vue'
import type { SystemInfo } from '@shared/dto'
import { call } from '../api'
import { showError } from '../api/errors'

/**
 * 临时首页：M5 库存查询接上之前，先展示系统信息，避免右侧内容区空白。
 */
const info = ref<SystemInfo | null>(null)
const loading = ref(true)

onMounted(async () => {
  try {
    info.value = await call('system:info', {})
  } catch (e) {
    showError(e)
  } finally {
    loading.value = false
  }
})
</script>

<template>
  <div class="page">
    <el-skeleton v-if="loading" :rows="4" animated />
    <el-descriptions v-else-if="info" title="系统信息（库存查询功能开发中）" :column="1" border>
      <el-descriptions-item label="程序版本">{{ info.appVersion }}</el-descriptions-item>
      <el-descriptions-item label="数据库版本">{{ info.schemaVersion }}</el-descriptions-item>
      <el-descriptions-item label="SQLite">{{ info.sqliteVersion }}</el-descriptions-item>
      <el-descriptions-item label="数据目录">{{ info.dataDir }}</el-descriptions-item>
    </el-descriptions>
    <el-empty v-else description="未能加载系统信息" />
  </div>
</template>
