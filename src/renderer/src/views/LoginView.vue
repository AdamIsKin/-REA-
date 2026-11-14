<script setup lang="ts">
import { reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useSessionStore } from '../stores/session'
import { showError } from '../api/errors'

/**
 * 登录页；首次启动（一个用户都没有）时变为“创建老板账号”引导（设计文档第 9 节）。
 */
const store = useSessionStore()
const router = useRouter()
const busy = ref(false)
const form = reactive({ username: '', displayName: '', password: '', confirm: '' })

async function submit(): Promise<void> {
  if (busy.value) return
  if (store.needsSetup && form.password !== form.confirm) {
    showError(new Error('两次输入的密码不一致'))
    return
  }
  busy.value = true
  try {
    if (store.needsSetup) await store.setupOwner(form.username, form.displayName, form.password)
    else await store.login(form.username, form.password)
    await router.replace('/')
  } catch (e) {
    showError(e)
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div class="login">
    <el-card class="box" shadow="always">
      <h2>{{ store.needsSetup ? '首次使用：创建老板账号' : '库存管理 登录' }}</h2>
      <el-form label-width="80px" @submit.prevent="submit">
        <el-form-item label="用户名">
          <el-input v-model="form.username" autofocus maxlength="32" />
        </el-form-item>
        <el-form-item v-if="store.needsSetup" label="显示名">
          <el-input v-model="form.displayName" maxlength="32" placeholder="可不填" />
        </el-form-item>
        <el-form-item label="密码">
          <el-input v-model="form.password" type="password" show-password maxlength="64" />
        </el-form-item>
        <el-form-item v-if="store.needsSetup" label="确认密码">
          <el-input v-model="form.confirm" type="password" show-password maxlength="64" />
        </el-form-item>
        <el-form-item>
          <el-button type="primary" native-type="submit" :loading="busy" style="width: 100%">
            {{ store.needsSetup ? '创建并登录' : '登录' }}
          </el-button>
        </el-form-item>
      </el-form>
    </el-card>
  </div>
</template>

<style scoped>
.login {
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
}
.box {
  width: 400px;
}
h2 {
  text-align: center;
  margin: 0 0 20px;
  font-weight: 500;
}
</style>
