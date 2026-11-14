<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import type { Role, UserRow } from '@shared/dto'
import { call } from '../../api'
import { showError } from '../../api/errors'

const rows = ref<UserRow[]>([])
const dialog = ref(false)
const form = reactive({
  id: undefined as number | undefined,
  username: '',
  displayName: '',
  role: 'clerk' as Role,
  enabled: true,
  password: '',
})

async function load(): Promise<void> {
  rows.value = await call('user:list', {})
}

function edit(row?: UserRow): void {
  Object.assign(
    form,
    row
      ? {
          id: row.id,
          username: row.username,
          displayName: row.displayName,
          role: row.role,
          enabled: row.enabled,
          password: '',
        }
      : { id: undefined, username: '', displayName: '', role: 'clerk', enabled: true, password: '' },
  )
  dialog.value = true
}

async function save(): Promise<void> {
  try {
    if (form.id === undefined) {
      await call('user:create', {
        username: form.username,
        displayName: form.displayName,
        role: form.role,
        password: form.password,
      })
    } else {
      await call('user:update', { id: form.id, displayName: form.displayName, role: form.role, enabled: form.enabled })
    }
    ElMessage.success('已保存')
    dialog.value = false
    await load()
  } catch (e) {
    showError(e)
  }
}

async function resetPassword(row: UserRow): Promise<void> {
  try {
    const { value } = await ElMessageBox.prompt(`为 ${row.username} 设置新密码（至少 6 位）`, '重置密码', {
      inputType: 'password',
      inputPattern: /^.{6,64}$/,
      inputErrorMessage: '密码至少 6 位',
    })
    await call('user:resetPassword', { id: row.id, password: value })
    ElMessage.success('密码已重置')
  } catch (e) {
    if (e !== 'cancel' && e !== 'close') showError(e)
  }
}

onMounted(load)
</script>

<template>
  <div class="page">
    <div class="toolbar">
      <el-button type="primary" @click="edit()">新增用户</el-button>
    </div>
    <el-table :data="rows" border stripe height="100%">
      <el-table-column prop="username" label="用户名" width="160" />
      <el-table-column prop="displayName" label="显示名" />
      <el-table-column label="角色" width="100">
        <template #default="{ row }">{{ row.role === 'owner' ? '老板' : '店员' }}</template>
      </el-table-column>
      <el-table-column label="状态" width="80">
        <template #default="{ row }">{{ row.enabled ? '启用' : '停用' }}</template>
      </el-table-column>
      <el-table-column prop="createdAt" label="创建时间" width="200" />
      <el-table-column label="操作" width="150">
        <template #default="{ row }">
          <el-button link type="primary" @click="edit(row)">编辑</el-button>
          <el-button link type="warning" @click="resetPassword(row)">重置密码</el-button>
        </template>
      </el-table-column>
    </el-table>

    <el-dialog v-model="dialog" :title="form.id ? '编辑用户' : '新增用户'" width="420px">
      <el-form label-width="70px" @submit.prevent="save">
        <el-form-item label="用户名" required>
          <el-input v-model="form.username" :disabled="form.id !== undefined" maxlength="32" />
        </el-form-item>
        <el-form-item label="显示名"><el-input v-model="form.displayName" maxlength="32" /></el-form-item>
        <el-form-item label="角色">
          <el-radio-group v-model="form.role">
            <el-radio value="owner">老板</el-radio>
            <el-radio value="clerk">店员</el-radio>
          </el-radio-group>
        </el-form-item>
        <el-form-item v-if="form.id === undefined" label="密码" required>
          <el-input v-model="form.password" type="password" show-password maxlength="64" />
        </el-form-item>
        <el-form-item v-else label="启用"><el-switch v-model="form.enabled" /></el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialog = false">取消</el-button>
        <el-button type="primary" @click="save">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>
