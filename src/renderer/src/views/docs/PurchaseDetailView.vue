<script setup lang="ts">
/**
 * 采购入库默认页（R25 / D44）：按串号展开的入库明细台账。
 * 工具栏提供采购统计（R27）与新增入库明细。
 */
import { onMounted, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import type { PartnerRow, PurchaseDetailRow, PurchaseStatRow, WarehouseRow } from '@shared/dto'
import { call } from '../../api'
import { showError } from '../../api/errors'
import { toYuanInput, yuan } from '../../utils/format'

const router = useRouter()
const rows = ref<PurchaseDetailRow[]>([])
const total = ref(0)
const warehouses = ref<WarehouseRow[]>([])
const partners = ref<PartnerRow[]>([])
const query = reactive({
  keyword: '',
  dateFrom: '' as string | null,
  dateTo: '' as string | null,
  partnerId: undefined as number | undefined,
  warehouseId: undefined as number | undefined,
  page: 1,
  pageSize: 50,
})

const rebateDialog = ref(false)
const rebateForm = reactive({
  lineId: 0,
  lineQty: 1,
  rebatePerUnit: '0.00',
  rebateAmount: '0.00',
})

const statsOpen = ref(false)
const statsLoading = ref(false)
const statsRows = ref<PurchaseStatRow[]>([])
const statsQuery = reactive({
  keyword: '',
  dateFrom: '' as string | null,
  dateTo: '' as string | null,
  partnerId: undefined as number | undefined,
  warehouseId: undefined as number | undefined,
})

async function loadMeta(): Promise<void> {
  warehouses.value = await call('warehouse:list', {})
  partners.value = await call('partner:list', { kind: 'supplier' })
}

function listFilter() {
  return {
    keyword: query.keyword,
    dateFrom: query.dateFrom || undefined,
    dateTo: query.dateTo || undefined,
    partnerId: query.partnerId,
    warehouseId: query.warehouseId,
  }
}

async function load(): Promise<void> {
  const r = await call('purchase:detailList', {
    ...listFilter(),
    page: query.page,
    pageSize: query.pageSize,
  })
  rows.value = r.rows
  total.value = r.total
}

function search(): void {
  query.page = 1
  void load()
}

function openNew(): void {
  void router.push('/docs/PURCHASE/new')
}

function openDoc(row: PurchaseDetailRow): void {
  void router.push(`/docs/PURCHASE/${row.docId}`)
}

function openSerial(row: PurchaseDetailRow): void {
  void router.push({ path: '/serials', query: { serial: row.serial } })
}

function editRebate(row: PurchaseDetailRow): void {
  rebateForm.lineId = row.lineId
  rebateForm.lineQty = Math.max(1, row.lineQty)
  rebateForm.rebatePerUnit = toYuanInput(row.rebatePerUnit)
  onRebatePerChange()
  rebateDialog.value = true
}

function onRebatePerChange(): void {
  const per = Number(rebateForm.rebatePerUnit || 0)
  const sum = Number.isFinite(per) ? per * rebateForm.lineQty : 0
  rebateForm.rebateAmount = sum.toFixed(2)
}

async function saveRebate(): Promise<void> {
  try {
    onRebatePerChange()
    await call('purchase:updateRebate', {
      lineId: rebateForm.lineId,
      rebatePerUnit: rebateForm.rebatePerUnit,
      rebateAmount: rebateForm.rebateAmount,
    })
    ElMessage.success('返利已保存')
    rebateDialog.value = false
    await load()
  } catch (e) {
    showError(e)
  }
}

/** 打开统计：默认带上明细页当前筛选条件。 */
function openStats(): void {
  Object.assign(statsQuery, {
    keyword: query.keyword,
    dateFrom: query.dateFrom,
    dateTo: query.dateTo,
    partnerId: query.partnerId,
    warehouseId: query.warehouseId,
  })
  statsOpen.value = true
  void loadStats()
}

async function loadStats(): Promise<void> {
  statsLoading.value = true
  try {
    statsRows.value = await call('purchase:statList', {
      keyword: statsQuery.keyword,
      dateFrom: statsQuery.dateFrom || undefined,
      dateTo: statsQuery.dateTo || undefined,
      partnerId: statsQuery.partnerId,
      warehouseId: statsQuery.warehouseId,
    })
  } catch (e) {
    showError(e)
  } finally {
    statsLoading.value = false
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
        placeholder="单号 / 商品 / 串号"
        clearable
        style="width: 200px"
        @keyup.enter="search"
        @clear="search"
      />
      <el-date-picker
        v-model="query.dateFrom"
        type="date"
        value-format="YYYY-MM-DD"
        placeholder="开始日期"
        style="width: 140px"
      />
      <el-date-picker
        v-model="query.dateTo"
        type="date"
        value-format="YYYY-MM-DD"
        placeholder="结束日期"
        style="width: 140px"
      />
      <el-select v-model="query.partnerId" clearable placeholder="供应商" style="width: 160px">
        <el-option v-for="p in partners" :key="p.id" :label="p.name" :value="p.id" />
      </el-select>
      <el-select v-model="query.warehouseId" clearable placeholder="仓库" style="width: 140px">
        <el-option v-for="w in warehouses" :key="w.id" :label="w.name" :value="w.id" />
      </el-select>
      <el-button type="primary" @click="search">查询</el-button>
      <span class="spacer" />
      <el-button type="primary" @click="openStats">采购统计</el-button>
      <el-button type="primary" @click="openNew">新增入库明细</el-button>
    </div>

    <el-table :data="rows" border stripe height="100%">
      <el-table-column prop="bizDate" label="日期" width="110" />
      <el-table-column label="单号" width="160">
        <template #default="{ row }">
          <el-button link type="primary" @click="openDoc(row)">{{ row.docNo }}</el-button>
        </template>
      </el-table-column>
      <el-table-column prop="partnerName" label="供应商" min-width="120" />
      <el-table-column prop="warehouseName" label="仓库" width="100" />
      <el-table-column prop="categoryName" label="分类" width="90" />
      <el-table-column prop="brandName" label="品牌" width="90" />
      <el-table-column prop="itemCode" label="商品编码" width="110" />
      <el-table-column prop="itemName" label="商品名称" min-width="140" />
      <el-table-column prop="qty" label="数量" width="70" align="right" />
      <el-table-column label="单价" width="90" align="right">
        <template #default="{ row }">{{ yuan(row.unitPrice) }}</template>
      </el-table-column>
      <el-table-column label="金额" width="90" align="right">
        <template #default="{ row }">{{ yuan(row.amount) }}</template>
      </el-table-column>
      <el-table-column label="单台返利" width="90" align="right">
        <template #default="{ row }">{{ yuan(row.rebatePerUnit) }}</template>
      </el-table-column>
      <el-table-column label="返利金额" width="90" align="right">
        <template #default="{ row }">{{ yuan(row.rebateAmount) }}</template>
      </el-table-column>
      <el-table-column label="串号" min-width="140">
        <template #default="{ row }">
          <el-button link type="primary" @click="openSerial(row)">{{ row.serial }}</el-button>
        </template>
      </el-table-column>
      <el-table-column prop="createdByName" label="录入人" width="90" />
      <el-table-column prop="createdAt" label="录入时间" width="160" />
      <el-table-column prop="updatedByName" label="修改人" width="90" />
      <el-table-column prop="updatedAt" label="修改时间" width="160" />
      <el-table-column label="操作" width="80" fixed="right">
        <template #default="{ row }">
          <el-button link type="primary" @click="editRebate(row)">返利</el-button>
        </template>
      </el-table-column>
    </el-table>

    <div class="pager">
      <el-pagination
        v-model:current-page="query.page"
        v-model:page-size="query.pageSize"
        :total="total"
        layout="total, prev, pager, next"
        @current-change="load"
      />
    </div>

    <el-dialog v-model="rebateDialog" title="编辑返利（仅展示预留，不进成本）" width="420px">
      <el-form label-width="96px">
        <el-form-item label="单台返利">
          <el-input v-model="rebateForm.rebatePerUnit" @change="onRebatePerChange" />
        </el-form-item>
        <el-form-item label="返利金额">
          <el-input v-model="rebateForm.rebateAmount" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="rebateDialog = false">取消</el-button>
        <el-button type="primary" @click="saveRebate">保存</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="statsOpen" title="采购统计" width="720px" destroy-on-close>
      <div class="toolbar stats-bar">
        <el-input
          v-model="statsQuery.keyword"
          placeholder="单号 / 商品 / 串号"
          clearable
          style="width: 180px"
          @keyup.enter="loadStats"
        />
        <el-date-picker
          v-model="statsQuery.dateFrom"
          type="date"
          value-format="YYYY-MM-DD"
          placeholder="开始日期"
          style="width: 140px"
        />
        <el-date-picker
          v-model="statsQuery.dateTo"
          type="date"
          value-format="YYYY-MM-DD"
          placeholder="结束日期"
          style="width: 140px"
        />
        <el-select v-model="statsQuery.partnerId" clearable placeholder="供应商" style="width: 140px">
          <el-option v-for="p in partners" :key="p.id" :label="p.name" :value="p.id" />
        </el-select>
        <el-select v-model="statsQuery.warehouseId" clearable placeholder="仓库" style="width: 120px">
          <el-option v-for="w in warehouses" :key="w.id" :label="w.name" :value="w.id" />
        </el-select>
        <el-button type="primary" :loading="statsLoading" @click="loadStats">查询</el-button>
      </div>
      <el-table v-loading="statsLoading" :data="statsRows" border stripe max-height="420">
        <el-table-column prop="itemName" label="商品名称" min-width="180" />
        <el-table-column prop="qty" label="数量" width="100" align="right" />
        <el-table-column label="单价" width="120" align="right">
          <template #default="{ row }">{{ yuan(row.unitPrice) }}</template>
        </el-table-column>
        <el-table-column label="金额" width="120" align="right">
          <template #default="{ row }">{{ yuan(row.amount) }}</template>
        </el-table-column>
      </el-table>
    </el-dialog>
  </div>
</template>

<style scoped>
.pager {
  display: flex;
  justify-content: flex-end;
  padding: 8px 0;
}
.stats-bar {
  margin-bottom: 12px;
  flex-wrap: wrap;
}
</style>
