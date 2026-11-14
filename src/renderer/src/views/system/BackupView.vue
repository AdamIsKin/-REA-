<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { call, shellApi } from '../../api'
import { showError } from '../../api/errors'

type BackupRow = { name: string; path: string; size: number; mtime: string }

const rows = ref<BackupRow[]>([])
const busy = ref(false)

async function load(): Promise<void> {
  rows.value = await call('backup:list', {})
}

function formatSize(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(2)} MB`
}

async function createLocal(): Promise<void> {
  busy.value = true
  try {
    const r = await call('backup:create', {})
    ElMessage.success(`已备份到：${r.filePath}`)
    await load()
  } catch (e) {
    showError(e)
  } finally {
    busy.value = false
  }
}

async function createToPath(): Promise<void> {
  const path = await shellApi().saveDialog({
    defaultPath: `erp-backup-${new Date().toISOString().slice(0, 10)}.db`,
    filters: [{ name: 'SQLite', extensions: ['db'] }],
  })
  if (!path) return
  busy.value = true
  try {
    const r = await call('backup:create', { filePath: path })
    ElMessage.success(`已备份到：${r.filePath}`)
    await load()
  } catch (e) {
    showError(e)
  } finally {
    busy.value = false
  }
}

async function restore(path: string): Promise<void> {
  try {
    await ElMessageBox.confirm(
      '恢复将替换当前全部业务数据，并自动重启程序。恢复前会先备份当前库。是否继续？',
      '恢复备份',
      { type: 'warning', confirmButtonText: '恢复并重启', cancelButtonText: '取消' },
    )
  } catch {
    return
  }
  busy.value = true
  try {
    await call('backup:restore', { filePath: path })
    ElMessage.success('恢复成功，正在重启…')
    await shellApi().relaunch()
  } catch (e) {
    showError(e)
    busy.value = false
  }
}

async function restoreFromFile(): Promise<void> {
  const path = await shellApi().openDialog({
    filters: [{ name: 'SQLite', extensions: ['db'] }],
  })
  if (!path) return
  await restore(path)
}

async function openFolder(): Promise<void> {
  if (rows.value[0]) {
    await shellApi().openPath(rows.value[0].path.replace(/[/\\][^/\\]+$/, '') || rows.value[0].path)
    return
  }
  const info = await call('system:info', {})
  await shellApi().openPath(`${info.dataDir}\\backups`)
}

onMounted(load)
</script>

<template>
  <div class="page">
    <div class="toolbar">
      <el-button type="primary" :loading="busy" @click="createLocal">立即备份</el-button>
      <el-button :loading="busy" @click="createToPath">备份到…</el-button>
      <el-button :loading="busy" @click="restoreFromFile">从文件恢复…</el-button>
      <el-button @click="openFolder">打开备份目录</el-button>
      <span class="spacer" />
      <el-button @click="load">刷新</el-button>
    </div>
    <el-alert
      type="info"
      :closable="false"
      show-icon
      title="自动备份：每月退出时备份一次；迁移前也会备份。手动备份与自动备份均列在下方。"
      style="margin-bottom: 12px"
    />
    <el-table :data="rows" border stripe height="100%">
      <el-table-column prop="name" label="文件名" min-width="240" />
      <el-table-column label="大小" width="100" align="right">
        <template #default="{ row }">{{ formatSize(row.size) }}</template>
      </el-table-column>
      <el-table-column prop="mtime" label="时间" width="200" />
      <el-table-column label="操作" width="100" fixed="right">
        <template #default="{ row }">
          <el-button link type="danger" :disabled="busy" @click="restore(row.path)">恢复</el-button>
        </template>
      </el-table-column>
    </el-table>
  </div>
</template>
