<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { DOC_TYPE_LABEL, type DocSummary, type DocType } from '@shared/dto'
import { call } from '../../api'
import { showError } from '../../api/errors'
import { useSessionStore } from '../../stores/session'
import { yuan } from '../../utils/format'

const route = useRoute()
const router = useRouter()
const session = useSessionStore()

const docType = computed(() => route.params['type'] as DocType)
const title = computed(() => DOC_TYPE_LABEL[docType.value] ?? '单据')
const isTransfer = computed(() => docType.value === 'TRANSFER')
const isReturn = computed(() => docType.value === 'PURCHASE_RETURN' || docType.value === 'SALE_RETURN')

const rows = ref<DocSummary[]>([])
const total = ref(0)
const query = reactive({ keyword: '', page: 1, pageSize: 50 })

async function load(): Promise<void> {
  const r = await call('doc:list', {
    docType: docType.value,
    keyword: query.keyword,
    page: query.page,
    pageSize: query.pageSize,
  })
  rows.value = r.rows
  total.value = r.total
}

watch(docType, () => {
  query.page = 1
  query.keyword = ''
  void load()
})

function openNew(): void {
  void router.push(`/docs/${docType.value}/new`)
}

function openDoc(row: DocSummary): void {
  void router.push(`/docs/${docType.value}/${row.id}`)
}

async function unpost(row: DocSummary): Promise<void> {
  try {
    await ElMessageBox.confirm(`确定反过账 ${row.docNo}？`, '反过账', { type: 'warning' })
    await call('doc:unpost', { id: row.id })
    ElMessage.success('已反过账')
    await load()
  } catch (e) {
    if (e !== 'cancel' && e !== 'close') showError(e)
  }
}

onMounted(load)
</script>

<template>
  <div class="page">
    <div class="toolbar">
      <el-input
        v-model="query.keyword"
        placeholder="单号 / 备注"
        clearable
        style="width: 220px"
        @keyup.enter="load"
        @clear="load"
      />
      <el-button @click="load">查询</el-button>
      <span class="spacer" />
      <el-button type="primary" @click="openNew">新建{{ title }}</el-button>
    </div>
    <el-table :data="rows" border stripe height="100%" @row-dblclick="openDoc">
      <el-table-column prop="docNo" label="单号" width="160" />
      <el-table-column prop="bizDate" label="业务日期" width="110" />
      <el-table-column :label="isTransfer ? '调出仓' : '仓库'" width="120" prop="warehouseName" />
      <el-table-column v-if="isTransfer" prop="toWarehouseName" label="调入仓" width="120" />
      <el-table-column
        v-if="!isTransfer"
        prop="partnerName"
        :label="docType === 'PURCHASE' || docType === 'PURCHASE_RETURN' ? '供应商' : '客户'"
        min-width="140"
      />
      <el-table-column v-if="isReturn" prop="refDocNo" label="原单号" width="160" />
      <el-table-column label="数量" width="80" align="right">
        <template #default="{ row }">{{ row.totalQty }}</template>
      </el-table-column>
      <el-table-column v-if="!isTransfer" label="金额" width="110" align="right">
        <template #default="{ row }">{{ yuan(row.totalAmount) }}</template>
      </el-table-column>
      <el-table-column v-if="session.isOwner && !isTransfer" label="成本" width="110" align="right">
        <template #default="{ row }">{{ yuan(row.totalCost) }}</template>
      </el-table-column>
      <el-table-column label="状态" width="80">
        <template #default="{ row }">{{ row.status === 'posted' ? '已过账' : '草稿' }}</template>
      </el-table-column>
      <el-table-column prop="createdByName" label="制单人" width="100" />
      <el-table-column label="操作" width="140" fixed="right">
        <template #default="{ row }">
          <el-button link type="primary" @click="openDoc(row)">查看</el-button>
          <el-button v-if="session.isOwner && row.status === 'posted'" link type="warning" @click="unpost(row)">
            反过账
          </el-button>
        </template>
      </el-table-column>
    </el-table>
    <el-pagination
      v-model:current-page="query.page"
      v-model:page-size="query.pageSize"
      :total="total"
      :page-sizes="[50, 100]"
      layout="total, sizes, prev, pager, next"
      @current-change="load"
      @size-change="
        () => {
          query.page = 1
          load()
        }
      "
    />
  </div>
</template>
