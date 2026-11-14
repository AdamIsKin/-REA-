<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { ElMessage } from 'element-plus'
import type { BrandRow, CategoryRow, ItemRow } from '@shared/dto'
import { formatCents } from '@shared/money'
import { call, shellApi } from '../../api'
import { showError } from '../../api/errors'
import { exportExcel } from '../../export/excel'
import { buildBarcodeLabelsHtml } from '../../print/barcodeHtml'
import { toYuanInput, yuan } from '../../utils/format'

const rows = ref<ItemRow[]>([])
const total = ref(0)
const selected = ref<ItemRow[]>([])
const categories = ref<CategoryRow[]>([])
const brands = ref<BrandRow[]>([])
const query = reactive({ keyword: '', includeDisabled: false, page: 1, pageSize: 50 })

const emptyForm = () => ({
  id: undefined as number | undefined,
  code: '',
  name: '',
  spec: '',
  unit: '件',
  barcode: '',
  categoryId: null as number | null,
  brandId: null as number | null,
  defaultBuyPrice: '0.00',
  defaultSellPrice: '0.00',
  remark: '',
  enabled: true,
})
const dialog = ref(false)
const form = reactive(emptyForm())

async function loadMeta(): Promise<void> {
  categories.value = await call('category:list', {})
  brands.value = await call('brand:list', {})
}

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
          id: row.id,
          code: row.code,
          name: row.name,
          spec: row.spec,
          unit: row.unit,
          barcode: row.barcode ?? '',
          categoryId: row.categoryId,
          brandId: row.brandId,
          defaultBuyPrice: toYuanInput(row.defaultBuyPrice),
          defaultSellPrice: toYuanInput(row.defaultSellPrice),
          remark: row.remark,
          enabled: row.enabled,
        }
      : emptyForm(),
  )
  dialog.value = true
}

async function save(): Promise<void> {
  try {
    await call('item:save', { ...form })
    ElMessage.success('已保存')
    dialog.value = false
    await load()
  } catch (e) {
    showError(e)
  }
}

async function doExport(): Promise<void> {
  try {
    await exportExcel({
      fileName: '商品资料.xlsx',
      sheetName: '商品',
      columns: [
        { header: '编码', value: (r) => r.code },
        { header: '名称', value: (r) => r.name },
        { header: '规格', value: (r) => r.spec },
        { header: '单位', value: (r) => r.unit },
        { header: '条码', value: (r) => r.barcode ?? '' },
        { header: '品牌', value: (r) => r.brandName },
        { header: '分类', value: (r) => r.categoryName },
        { header: '默认进价', value: (r) => formatCents(r.defaultBuyPrice) },
        { header: '默认售价', value: (r) => formatCents(r.defaultSellPrice) },
        { header: '状态', value: (r) => (r.enabled ? '启用' : '停用') },
      ],
      rows: rows.value,
    })
  } catch (e) {
    showError(e)
  }
}

function onSelect(v: ItemRow[]): void {
  selected.value = v
}

async function printLabels(): Promise<void> {
  const list = selected.value.length > 0 ? selected.value : rows.value
  if (list.length === 0) {
    ElMessage.warning('没有可打印的商品')
    return
  }
  try {
    const html = buildBarcodeLabelsHtml(
      list.map((i) => ({
        code: (i.barcode && i.barcode.trim()) || i.code,
        name: i.name,
        priceText: formatCents(i.defaultSellPrice),
      })),
    )
    const r = await shellApi().print({ html, pageSize: { width: 40, height: 30 } })
    if (!r.ok) ElMessage.error(r.error || '打印失败')
  } catch (e) {
    showError(e)
  }
}

onMounted(async () => {
  await loadMeta()
  await load()
})
</script>

<template>
  <div class="page">
    <div class="toolbar">
      <el-input
        v-model="query.keyword"
        placeholder="编码 / 名称 / 条码 / 规格 / 品牌 / 分类"
        clearable
        style="width: 280px"
        @keyup.enter="search"
        @clear="search"
      />
      <el-button @click="search">查询</el-button>
      <el-checkbox v-model="query.includeDisabled" @change="search">显示停用</el-checkbox>
      <span class="spacer" />
      <el-button @click="doExport">导出 Excel</el-button>
      <el-button @click="printLabels">打印条码标签</el-button>
      <el-button type="primary" @click="edit()">新增商品</el-button>
    </div>
    <el-table :data="rows" border stripe height="100%" @selection-change="onSelect">
      <el-table-column type="selection" width="42" />
      <el-table-column prop="code" label="编码" width="120" />
      <el-table-column prop="name" label="名称" min-width="160" />
      <el-table-column prop="spec" label="规格" width="120" />
      <el-table-column prop="brandName" label="品牌" width="100" />
      <el-table-column prop="categoryName" label="分类" width="100" />
      <el-table-column prop="unit" label="单位" width="60" />
      <el-table-column prop="barcode" label="条码" width="140" />
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
          <el-col :span="12">
            <el-form-item label="品牌">
              <el-select v-model="form.brandId" clearable filterable style="width: 100%">
                <el-option v-for="b in brands" :key="b.id" :label="b.name" :value="b.id" />
              </el-select>
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="分类">
              <el-select v-model="form.categoryId" clearable filterable style="width: 100%">
                <el-option v-for="c in categories" :key="c.id" :label="c.name" :value="c.id" />
              </el-select>
            </el-form-item>
          </el-col>
          <el-col :span="12"
            ><el-form-item label="默认进价"><el-input v-model="form.defaultBuyPrice" /></el-form-item
          ></el-col>
          <el-col :span="12"
            ><el-form-item label="默认售价"><el-input v-model="form.defaultSellPrice" /></el-form-item
          ></el-col>
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
