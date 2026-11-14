<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { ElMessage } from 'element-plus'
import type { ItemRow } from '@shared/dto'
import { call } from '../../api'
import { showError } from '../../api/errors'
import { toYuanInput, yuan } from '../../utils/format'

const rows = ref<ItemRow[]>([])
const total = ref(0)
const query = reactive({ keyword: '', includeDisabled: false, page: 1, pageSize: 50 })

const emptyForm = () => ({
  id: undefined as number | undefined,
  code: '',
  name: '',
  spec: '',
  unit: '件',
  barcode: '',
  category: '',
  brand: '',
  serialManaged: false,
  serialFlagLocked: false,
  defaultBuyPrice: '0.00',
  defaultSellPrice: '0.00',
  remark: '',
  enabled: true,
})
const dialog = ref(false)
const form = reactive(emptyForm())

async function load(): Promise<void> {
  const r = await call('item:list', { ...query })
  rows.value = r.rows
  total.value = r.total
}

function search(): void {
  query.page = 1
  void load()
}

function edit(row?: ItemRow): void {
  Object.assign(
    form,
    row
      ? {
          ...row,
          barcode: row.barcode ?? '',
          defaultBuyPrice: toYuanInput(row.defaultBuyPrice),
          defaultSellPrice: toYuanInput(row.defaultSellPrice),
        }
      : emptyForm(),
  )
  dialog.value = true
}

async function save(): Promise<void> {
  try {
    const { serialFlagLocked: _locked, ...payload } = form
    await call('item:save', payload)
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
        placeholder="编码 / 名称 / 条码 / 规格 / 品牌"
        clearable
        style="width: 280px"
        @keyup.enter="search"
        @clear="search"
      />
      <el-button @click="search">查询</el-button>
      <el-checkbox v-model="query.includeDisabled" @change="search">显示停用</el-checkbox>
      <span class="spacer" />
      <el-button type="primary" @click="edit()">新增商品</el-button>
    </div>
    <el-table :data="rows" border stripe height="100%">
      <el-table-column prop="code" label="编码" width="120" />
      <el-table-column prop="name" label="名称" min-width="160" />
      <el-table-column prop="spec" label="规格" width="120" />
      <el-table-column prop="brand" label="品牌" width="100" />
      <el-table-column prop="category" label="类别" width="100" />
      <el-table-column prop="unit" label="单位" width="60" />
      <el-table-column prop="barcode" label="条码" width="140" />
      <el-table-column label="串号管理" width="90">
        <template #default="{ row }">{{ row.serialManaged ? '是' : '否' }}</template>
      </el-table-column>
      <el-table-column label="默认进价" width="100" align="right">
        <template #default="{ row }">{{ yuan(row.defaultBuyPrice) }}</template>
      </el-table-column>
      <el-table-column label="默认售价" width="100" align="right">
        <template #default="{ row }">{{ yuan(row.defaultSellPrice) }}</template>
      </el-table-column>
      <el-table-column label="状态" width="70">
        <template #default="{ row }">{{ row.enabled ? '启用' : '停用' }}</template>
      </el-table-column>
      <el-table-column label="操作" width="70" fixed="right">
        <template #default="{ row }">
          <el-button link type="primary" @click="edit(row)">编辑</el-button>
        </template>
      </el-table-column>
    </el-table>
    <el-pagination
      v-model:current-page="query.page"
      v-model:page-size="query.pageSize"
      :total="total"
      :page-sizes="[50, 100, 200]"
      layout="total, sizes, prev, pager, next"
      @current-change="load"
      @size-change="search"
    />

    <el-dialog v-model="dialog" :title="form.id ? '编辑商品' : '新增商品'" width="560px">
      <el-form label-width="84px" @submit.prevent="save">
        <el-row :gutter="12">
          <el-col :span="12"
            ><el-form-item label="编码" required><el-input v-model="form.code" maxlength="32" /></el-form-item
          ></el-col>
          <el-col :span="12"
            ><el-form-item label="条码"><el-input v-model="form.barcode" maxlength="64" /></el-form-item
          ></el-col>
          <el-col :span="24"
            ><el-form-item label="名称" required><el-input v-model="form.name" maxlength="128" /></el-form-item
          ></el-col>
          <el-col :span="12"
            ><el-form-item label="规格"><el-input v-model="form.spec" maxlength="128" /></el-form-item
          ></el-col>
          <el-col :span="12"
            ><el-form-item label="单位"><el-input v-model="form.unit" maxlength="16" /></el-form-item
          ></el-col>
          <el-col :span="12"
            ><el-form-item label="品牌"><el-input v-model="form.brand" maxlength="64" /></el-form-item
          ></el-col>
          <el-col :span="12"
            ><el-form-item label="类别"><el-input v-model="form.category" maxlength="64" /></el-form-item
          ></el-col>
          <el-col :span="12"
            ><el-form-item label="默认进价"><el-input v-model="form.defaultBuyPrice" /></el-form-item
          ></el-col>
          <el-col :span="12"
            ><el-form-item label="默认售价"><el-input v-model="form.defaultSellPrice" /></el-form-item
          ></el-col>
          <el-col :span="12">
            <el-form-item label="串号管理">
              <el-switch v-model="form.serialManaged" :disabled="form.serialFlagLocked" />
              <span v-if="form.serialFlagLocked" class="hint">已有库存流水，不能修改</span>
            </el-form-item>
          </el-col>
          <el-col :span="12"
            ><el-form-item label="启用"><el-switch v-model="form.enabled" /></el-form-item
          ></el-col>
          <el-col :span="24"
            ><el-form-item label="备注"><el-input v-model="form.remark" maxlength="255" /></el-form-item
          ></el-col>
        </el-row>
      </el-form>
      <template #footer>
        <el-button @click="dialog = false">取消</el-button>
        <el-button type="primary" @click="save">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.hint {
  margin-left: 8px;
  color: #909399;
  font-size: 12px;
}
</style>
