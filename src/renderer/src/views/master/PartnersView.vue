<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { useRoute } from 'vue-router'
import { ElMessage } from 'element-plus'
import type { PartnerKind, PartnerRow } from '@shared/dto'
import { call } from '../../api'
import { showError } from '../../api/errors'

/** 供应商、客户共用一个页面，按路由参数区分（路由带 key=fullPath，切换时组件重建）。 */
const route = useRoute()
const kind = computed(() => route.params['kind'] as PartnerKind)
const label = computed(() => (kind.value === 'supplier' ? '供应商' : '客户'))

const rows = ref<PartnerRow[]>([])
const query = reactive({ keyword: '', includeDisabled: false })
const emptyForm = () => ({
  id: undefined as number | undefined,
  code: '',
  name: '',
  contact: '',
  phone: '',
  address: '',
  remark: '',
  enabled: true,
})
const dialog = ref(false)
const form = reactive(emptyForm())

async function load(): Promise<void> {
  rows.value = await call('partner:list', { kind: kind.value, ...query })
}

function edit(row?: PartnerRow): void {
  Object.assign(form, row ? { ...row } : emptyForm())
  dialog.value = true
}

async function save(): Promise<void> {
  try {
    await call('partner:save', { ...form, kind: kind.value })
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
      <el-input
        v-model="query.keyword"
        placeholder="编码 / 名称 / 电话"
        clearable
        style="width: 240px"
        @keyup.enter="load"
        @clear="load"
      />
      <el-button @click="load">查询</el-button>
      <el-checkbox v-model="query.includeDisabled" @change="load">显示停用</el-checkbox>
      <span class="spacer" />
      <el-button type="primary" @click="edit()">新增{{ label }}</el-button>
    </div>
    <el-table :data="rows" border stripe height="100%">
      <el-table-column prop="code" label="编码" width="120" />
      <el-table-column prop="name" label="名称" min-width="160" />
      <el-table-column prop="contact" label="联系人" width="100" />
      <el-table-column prop="phone" label="电话" width="130" />
      <el-table-column prop="address" label="地址" min-width="160" />
      <el-table-column prop="remark" label="备注" />
      <el-table-column label="状态" width="70">
        <template #default="{ row }">{{ row.enabled ? '启用' : '停用' }}</template>
      </el-table-column>
      <el-table-column label="操作" width="70">
        <template #default="{ row }">
          <el-button link type="primary" @click="edit(row)">编辑</el-button>
        </template>
      </el-table-column>
    </el-table>

    <el-dialog v-model="dialog" :title="(form.id ? '编辑' : '新增') + label" width="480px">
      <el-form label-width="70px" @submit.prevent="save">
        <el-form-item label="编码" required><el-input v-model="form.code" maxlength="32" /></el-form-item>
        <el-form-item label="名称" required><el-input v-model="form.name" maxlength="128" /></el-form-item>
        <el-form-item label="联系人"><el-input v-model="form.contact" maxlength="32" /></el-form-item>
        <el-form-item label="电话"><el-input v-model="form.phone" maxlength="32" /></el-form-item>
        <el-form-item label="地址"><el-input v-model="form.address" maxlength="255" /></el-form-item>
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
