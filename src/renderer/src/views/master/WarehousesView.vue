<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { ElMessage } from 'element-plus'
import type { WarehouseRow } from '@shared/dto'
import { call } from '../../api'
import { showError } from '../../api/errors'

const rows = ref<WarehouseRow[]>([])
const includeDisabled = ref(false)
const dialog = ref(false)
const form = reactive({ id: undefined as number | undefined, code: '', name: '', remark: '', enabled: true })

async function load(): Promise<void> {
  rows.value = await call('warehouse:list', { includeDisabled: includeDisabled.value })
}

function edit(row?: WarehouseRow): void {
  Object.assign(form, row ? { ...row } : { id: undefined, code: '', name: '', remark: '', enabled: true })
  dialog.value = true
}

async function save(): Promise<void> {
  try {
    await call('warehouse:save', { ...form })
    ElMessage.success('已保存')
    dialog.value = false
    await load()
  } catch (e) {
    showError(e)
  }
}

onMounted(load)
</script>

<template>
  <div class="page">
    <div class="toolbar">
      <el-button type="primary" @click="edit()">新增仓库</el-button>
      <el-checkbox v-model="includeDisabled" @change="load">显示停用</el-checkbox>
    </div>
    <el-table :data="rows" border stripe height="100%">
      <el-table-column prop="code" label="编码" width="140" />
      <el-table-column prop="name" label="名称" />
      <el-table-column prop="remark" label="备注" />
      <el-table-column label="状态" width="80">
        <template #default="{ row }">
          <el-tag :type="row.enabled ? 'success' : 'info'">{{ row.enabled ? '启用' : '停用' }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="操作" width="90">
        <template #default="{ row }">
          <el-button link type="primary" @click="edit(row)">编辑</el-button>
        </template>
      </el-table-column>
    </el-table>

    <el-dialog v-model="dialog" :title="form.id ? '编辑仓库' : '新增仓库'" width="420px">
      <el-form label-width="70px" @submit.prevent="save">
        <el-form-item label="编码" required><el-input v-model="form.code" maxlength="32" /></el-form-item>
        <el-form-item label="名称" required><el-input v-model="form.name" maxlength="64" /></el-form-item>
        <el-form-item label="备注"><el-input v-model="form.remark" maxlength="255" /></el-form-item>
        <el-form-item label="启用"><el-switch v-model="form.enabled" /></el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialog = false">取消</el-button>
        <el-button type="primary" @click="save">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>
