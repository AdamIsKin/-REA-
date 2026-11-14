<script setup lang="ts">
import { reactive } from 'vue'
import { ElMessage } from 'element-plus'
import { call } from '../../api'
import { showError } from '../../api/errors'

const form = reactive({ oldPassword: '', newPassword: '', confirm: '' })

async function save(): Promise<void> {
  if (form.newPassword !== form.confirm) {
    showError(new Error('两次输入的新密码不一致'))
    return
  }
  try {
    await call('auth:changePassword', { oldPassword: form.oldPassword, newPassword: form.newPassword })
    ElMessage.success('密码已修改')
    Object.assign(form, { oldPassword: '', newPassword: '', confirm: '' })
  } catch (e) {
    showError(e)
  }
}
</script>

<template>
  <div class="page">
    <el-form label-width="90px" style="max-width: 420px" @submit.prevent="save">
      <el-form-item label="原密码"><el-input v-model="form.oldPassword" type="password" show-password /></el-form-item>
      <el-form-item label="新密码"><el-input v-model="form.newPassword" type="password" show-password /></el-form-item>
      <el-form-item label="确认新密码"><el-input v-model="form.confirm" type="password" show-password /></el-form-item>
      <el-form-item><el-button type="primary" native-type="submit">修改</el-button></el-form-item>
    </el-form>
  </div>
</template>
