<script setup lang="ts">
import { onMounted, reactive } from 'vue'
import { ElMessage } from 'element-plus'
import { call } from '../../api'
import { showError } from '../../api/errors'

/** 设置项的键名集中在这里，打印模板和备份模块按同样的键读取。 */
const form = reactive({
  'shop.name': '',
  'shop.phone': '',
  'shop.address': '',
  'print.footer': '',
  'backup.keepMonthly': '5',
})

onMounted(async () => {
  const all = await call('setting:getAll', {})
  for (const k of Object.keys(form) as (keyof typeof form)[]) if (all[k] !== undefined) form[k] = all[k]!
})

async function save(): Promise<void> {
  try {
    await call('setting:save', { values: { ...form } })
    ElMessage.success('已保存')
  } catch (e) {
    showError(e)
  }
}
</script>

<template>
  <div class="page">
    <el-form label-width="120px" style="max-width: 560px" @submit.prevent="save">
      <el-divider content-position="left">店铺信息（打印抬头）</el-divider>
      <el-form-item label="店名"><el-input v-model="form['shop.name']" maxlength="64" /></el-form-item>
      <el-form-item label="电话"><el-input v-model="form['shop.phone']" maxlength="32" /></el-form-item>
      <el-form-item label="地址"><el-input v-model="form['shop.address']" maxlength="128" /></el-form-item>
      <el-form-item label="单据底部说明"
        ><el-input v-model="form['print.footer']" type="textarea" maxlength="255"
      /></el-form-item>
      <el-divider content-position="left">备份</el-divider>
      <el-form-item label="月度备份保留份数">
        <el-input-number
          :model-value="Number(form['backup.keepMonthly'])"
          :min="1"
          :max="60"
          @update:model-value="(v: number | undefined) => (form['backup.keepMonthly'] = String(v ?? 5))"
        />
      </el-form-item>
      <el-form-item>
        <el-button type="primary" native-type="submit">保存</el-button>
      </el-form-item>
    </el-form>
  </div>
</template>
