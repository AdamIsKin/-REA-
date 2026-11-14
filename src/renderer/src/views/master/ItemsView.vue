<script setup lang="ts">
/**
 * 商品主数据（D47 / R28）：分类/品牌以工具栏按钮维护；表单字段按新模型。
 */
import { onActivated, onMounted, reactive, ref } from 'vue'
import { ElMessage } from 'element-plus'
import type { BrandRow, CategoryRow, ItemRow, PartnerRow, SerialType, UserOption } from '@shared/dto'
import { call } from '../../api'
import { showError } from '../../api/errors'
import { useSessionStore } from '../../stores/session'

const session = useSessionStore()
const rows = ref<ItemRow[]>([])
const total = ref(0)
const categories = ref<CategoryRow[]>([])
const brands = ref<BrandRow[]>([])
const suppliers = ref<PartnerRow[]>([])
const users = ref<UserOption[]>([])
const query = reactive({ keyword: '', includeDisabled: false, page: 1, pageSize: 50 })

const SERIAL_LABEL: Record<SerialType, string> = {
  none: '无串号',
  single: '单串号',
  dual: '双串号',
}

const emptyForm = () => ({
  id: undefined as number | undefined,
  name: '',
  categoryId: null as number | null,
  brandId: null as number | null,
  series: '',
  memory1: '',
  memory2: '',
  version: '',
  model: '',
  color: '',
  supplierId: null as number | null,
  serialType: 'single' as SerialType,
  stockMin: 0,
  stockMax: 0,
  isConsignment: false,
  isQuotable: true,
  createdByUserId: undefined as number | undefined,
})
const dialog = ref(false)
const form = reactive(emptyForm())

const catListOpen = ref(false)
const brandListOpen = ref(false)
const catEditOpen = ref(false)
const brandEditOpen = ref(false)
const catForm = reactive({ id: undefined as number | undefined, code: '', name: '', enabled: true })
const brandForm = reactive({ id: undefined as number | undefined, code: '', name: '', enabled: true })

async function loadMeta(): Promise<void> {
  categories.value = await call('category:list', { includeDisabled: true })
  brands.value = await call('brand:list', { includeDisabled: true })
  suppliers.value = await call('partner:list', { kind: 'supplier' })
  users.value = await call('user:options', {})
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
          name: row.name,
          categoryId: row.categoryId,
          brandId: row.brandId,
          series: row.series,
          memory1: row.memory1,
          memory2: row.memory2,
          version: row.version,
          model: row.model,
          color: row.color,
          supplierId: row.supplierId,
          serialType: row.serialType,
          stockMin: row.stockMin,
          stockMax: row.stockMax,
          isConsignment: row.isConsignment,
          isQuotable: row.isQuotable,
          createdByUserId: row.createdBy ?? session.session?.userId,
        }
      : { ...emptyForm(), createdByUserId: session.session?.userId },
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

function editCat(row?: CategoryRow): void {
  Object.assign(catForm, row ? { ...row } : { id: undefined, code: '', name: '', enabled: true })
  catEditOpen.value = true
}

function editBrand(row?: BrandRow): void {
  Object.assign(brandForm, row ? { ...row } : { id: undefined, code: '', name: '', enabled: true })
  brandEditOpen.value = true
}

async function saveCat(): Promise<void> {
  try {
    await call('category:save', { ...catForm })
    ElMessage.success('分类已保存')
    catEditOpen.value = false
    await loadMeta()
  } catch (e) {
    showError(e)
  }
}

async function saveBrand(): Promise<void> {
  try {
    await call('brand:save', { ...brandForm })
    ElMessage.success('品牌已保存')
    brandEditOpen.value = false
    await loadMeta()
  } catch (e) {
    showError(e)
  }
}

onMounted(async () => {
  await loadMeta()
  await load()
})
/** keep-alive 恢复时刷新分类/品牌/供应商/录入人下拉。 */
onActivated(() => {
  void loadMeta()
})
</script>

<template>
  <div class="page">
    <div class="toolbar">
      <el-input
        v-model="query.keyword"
        placeholder="名称 / 系列 / 型号 / 颜色 / 品牌 / 分类 / 供应商"
        clearable
        style="width: 320px"
        @keyup.enter="search"
        @clear="search"
      />
      <el-button type="primary" @click="search">查询</el-button>
      <span class="spacer" />
      <el-button type="primary" @click="brandListOpen = true">品牌</el-button>
      <el-button type="primary" @click="catListOpen = true">分类</el-button>
      <el-button type="primary" @click="edit()">新增商品</el-button>
    </div>

    <el-table :data="rows" border stripe height="100%">
      <el-table-column prop="categoryName" label="商品分类" width="100" />
      <el-table-column prop="brandName" label="品牌" width="100" />
      <el-table-column prop="name" label="商品全称" min-width="160" />
      <el-table-column prop="series" label="系列" width="90" />
      <el-table-column prop="memory1" label="内存1" width="80" />
      <el-table-column prop="memory2" label="内存2" width="80" />
      <el-table-column prop="version" label="版本" width="80" />
      <el-table-column prop="model" label="型号" width="90" />
      <el-table-column prop="color" label="颜色" width="80" />
      <el-table-column prop="supplierName" label="供应商" width="110" />
      <el-table-column label="串号类型" width="90">
        <template #default="{ row }">{{ SERIAL_LABEL[row.serialType as SerialType] ?? row.serialType }}</template>
      </el-table-column>
      <el-table-column prop="stockMax" label="库存上限" width="90" align="right" />
      <el-table-column prop="stockMin" label="库存下限" width="90" align="right" />
      <el-table-column label="是否代销" width="80">
        <template #default="{ row }">{{ row.isConsignment ? '是' : '否' }}</template>
      </el-table-column>
      <el-table-column label="是否报价" width="80">
        <template #default="{ row }">{{ row.isQuotable ? '是' : '否' }}</template>
      </el-table-column>
      <el-table-column prop="createdByName" label="录入人" width="90" />
      <el-table-column prop="createdAt" label="录入时间" width="160" />
      <el-table-column prop="updatedByName" label="修改人" width="90" />
      <el-table-column prop="updatedAt" label="修改时间" width="160" />
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

    <el-dialog v-model="dialog" :title="form.id ? '编辑商品' : '新增商品'" width="720px">
      <el-form label-width="96px" @submit.prevent="save">
        <el-row :gutter="12">
          <el-col :span="12">
            <el-form-item label="商品品牌">
              <el-select v-model="form.brandId" clearable filterable style="width: 100%">
                <el-option v-for="b in brands.filter((x) => x.enabled)" :key="b.id" :label="b.name" :value="b.id" />
              </el-select>
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="商品分类">
              <el-select v-model="form.categoryId" clearable filterable style="width: 100%">
                <el-option v-for="c in categories.filter((x) => x.enabled)" :key="c.id" :label="c.name" :value="c.id" />
              </el-select>
            </el-form-item>
          </el-col>
          <el-col :span="24">
            <el-form-item label="商品全称" required>
              <el-input v-model="form.name" maxlength="128" />
            </el-form-item>
          </el-col>
          <el-col :span="12"><el-form-item label="系列"><el-input v-model="form.series" /></el-form-item></el-col>
          <el-col :span="12"><el-form-item label="型号"><el-input v-model="form.model" /></el-form-item></el-col>
          <el-col :span="12"><el-form-item label="内存1"><el-input v-model="form.memory1" /></el-form-item></el-col>
          <el-col :span="12"><el-form-item label="内存2"><el-input v-model="form.memory2" /></el-form-item></el-col>
          <el-col :span="12"><el-form-item label="版本"><el-input v-model="form.version" /></el-form-item></el-col>
          <el-col :span="12"><el-form-item label="颜色"><el-input v-model="form.color" /></el-form-item></el-col>
          <el-col :span="12">
            <el-form-item label="供应商">
              <el-select v-model="form.supplierId" clearable filterable style="width: 100%">
                <el-option v-for="s in suppliers" :key="s.id" :label="s.name" :value="s.id" />
              </el-select>
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="串号类型" required>
              <el-select v-model="form.serialType" style="width: 100%">
                <el-option label="无串号" value="none" />
                <el-option label="单串号" value="single" />
                <el-option label="双串号" value="dual" />
              </el-select>
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="库存下限">
              <el-input-number v-model="form.stockMin" :min="0" controls-position="right" style="width: 100%" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="库存上限">
              <el-input-number v-model="form.stockMax" :min="0" controls-position="right" style="width: 100%" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="是否代销">
              <el-radio-group v-model="form.isConsignment">
                <el-radio :value="false">否</el-radio>
                <el-radio :value="true">是</el-radio>
              </el-radio-group>
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="是否报价">
              <el-radio-group v-model="form.isQuotable">
                <el-radio :value="true">是</el-radio>
                <el-radio :value="false">否</el-radio>
              </el-radio-group>
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="录入人">
              <el-select v-model="form.createdByUserId" filterable style="width: 100%">
                <el-option v-for="u in users" :key="u.id" :label="u.displayName || u.username" :value="u.id" />
              </el-select>
            </el-form-item>
          </el-col>
        </el-row>
      </el-form>
      <template #footer>
        <el-button @click="dialog = false">取消</el-button>
        <el-button type="primary" @click="save">保存</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="brandListOpen" title="品牌" width="560px">
      <div class="toolbar">
        <el-button type="primary" size="small" @click="editBrand()">新增</el-button>
      </div>
      <el-table :data="brands" border size="small" max-height="360">
        <el-table-column prop="code" label="编码" width="120" />
        <el-table-column prop="name" label="名称" />
        <el-table-column label="状态" width="70">
          <template #default="{ row }">{{ row.enabled ? '启用' : '停用' }}</template>
        </el-table-column>
        <el-table-column label="操作" width="70">
          <template #default="{ row }">
            <el-button link type="primary" @click="editBrand(row)">编辑</el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-dialog>

    <el-dialog v-model="catListOpen" title="分类" width="560px">
      <div class="toolbar">
        <el-button type="primary" size="small" @click="editCat()">新增</el-button>
      </div>
      <el-table :data="categories" border size="small" max-height="360">
        <el-table-column prop="code" label="编码" width="120" />
        <el-table-column prop="name" label="名称" />
        <el-table-column label="状态" width="70">
          <template #default="{ row }">{{ row.enabled ? '启用' : '停用' }}</template>
        </el-table-column>
        <el-table-column label="操作" width="70">
          <template #default="{ row }">
            <el-button link type="primary" @click="editCat(row)">编辑</el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-dialog>

    <el-dialog v-model="brandEditOpen" :title="brandForm.id ? '编辑品牌' : '新增品牌'" width="400px" append-to-body>
      <el-form label-width="70px">
        <el-form-item label="编码" required><el-input v-model="brandForm.code" /></el-form-item>
        <el-form-item label="名称" required><el-input v-model="brandForm.name" /></el-form-item>
        <el-form-item label="启用"><el-switch v-model="brandForm.enabled" /></el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="brandEditOpen = false">取消</el-button>
        <el-button type="primary" @click="saveBrand">保存</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="catEditOpen" :title="catForm.id ? '编辑分类' : '新增分类'" width="400px" append-to-body>
      <el-form label-width="70px">
        <el-form-item label="编码" required><el-input v-model="catForm.code" /></el-form-item>
        <el-form-item label="名称" required><el-input v-model="catForm.name" /></el-form-item>
        <el-form-item label="启用"><el-switch v-model="catForm.enabled" /></el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="catEditOpen = false">取消</el-button>
        <el-button type="primary" @click="saveCat">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>
