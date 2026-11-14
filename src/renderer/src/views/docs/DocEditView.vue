<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import {
  DOC_TYPE_LABEL,
  type DocDetail,
  type DocSummary,
  type DocType,
  type ItemRow,
  type PartnerRow,
  type ReturnableLine,
  type WarehouseRow,
} from '@shared/dto'
import { call } from '../../api'
import { showError } from '../../api/errors'
import { useSessionStore } from '../../stores/session'
import { disableFuture, today, toYuanInput, yuan } from '../../utils/format'

interface EditLine {
  itemId: number | null
  itemCode: string
  itemName: string
  serialManaged: boolean
  qty: number
  unitPrice: string
  costAmount: number | null
  refLineId: number | null
  serials: string[]
  serialInput: string
  remark: string
}

const route = useRoute()
const router = useRouter()
const session = useSessionStore()

const docType = computed(() => route.params['type'] as DocType)
const docIdParam = computed(() => route.params['id'] as string)
const isNew = computed(() => docIdParam.value === 'new')
const title = computed(() => DOC_TYPE_LABEL[docType.value] ?? '单据')
const isTransfer = computed(() => docType.value === 'TRANSFER')
const isReturn = computed(() => docType.value === 'PURCHASE_RETURN' || docType.value === 'SALE_RETURN')
const origDocType = computed(() => (docType.value === 'PURCHASE_RETURN' ? 'PURCHASE' : 'SALE'))

const warehouses = ref<WarehouseRow[]>([])
const partners = ref<PartnerRow[]>([])
const itemOptions = ref<ItemRow[]>([])
const origDocs = ref<DocSummary[]>([])
const returnable = ref<ReturnableLine[]>([])

const form = reactive({
  id: undefined as number | undefined,
  docNo: '',
  status: 'draft' as 'draft' | 'posted',
  bizDate: today(),
  warehouseId: undefined as number | undefined,
  toWarehouseId: undefined as number | undefined,
  partnerId: undefined as number | undefined,
  refDocId: undefined as number | undefined,
  remark: '',
  lines: [] as EditLine[],
})
const loaded = ref(false)
const saving = ref(false)
const serialFind = ref('')

const partnerKind = computed(() =>
  docType.value === 'PURCHASE' || docType.value === 'PURCHASE_RETURN' ? 'supplier' : 'customer',
)
const readOnlyPosted = computed(() => form.status === 'posted' && !isNew.value)
const lockedPrice = computed(() => isTransfer.value || isReturn.value)

function emptyLine(): EditLine {
  return {
    itemId: null,
    itemCode: '',
    itemName: '',
    serialManaged: false,
    qty: 1,
    unitPrice: '0.00',
    costAmount: null,
    refLineId: null,
    serials: [],
    serialInput: '',
    remark: '',
  }
}

async function loadMeta(): Promise<void> {
  warehouses.value = await call('warehouse:list', {})
  if (!isTransfer.value) {
    partners.value = await call('partner:list', { kind: partnerKind.value })
  }
  if (!form.warehouseId && warehouses.value[0]) form.warehouseId = warehouses.value[0].id
  if (isReturn.value) {
    const list = await call('doc:list', { docType: origDocType.value as DocType, page: 1, pageSize: 100 })
    origDocs.value = list.rows.filter((d) => d.status === 'posted')
  }
}

async function searchItems(q: string): Promise<void> {
  const r = await call('item:list', { keyword: q, page: 1, pageSize: 30 })
  itemOptions.value = r.rows
}

async function onRefDocChange(id: number | undefined): Promise<void> {
  form.refDocId = id
  form.lines = []
  returnable.value = []
  if (!id) return
  const r = await call('doc:returnable', { refDocId: id })
  returnable.value = r.lines.filter((l) => l.availableQty > 0)
  form.partnerId = r.refDoc.partnerId ?? undefined
  form.warehouseId = r.refDoc.warehouseId
}

function addReturnLine(rl: ReturnableLine): void {
  if (form.lines.some((l) => l.refLineId === rl.refLineId)) {
    ElMessage.warning('该原单行已添加')
    return
  }
  form.lines.push({
    itemId: rl.itemId,
    itemCode: rl.itemCode,
    itemName: rl.itemName,
    serialManaged: rl.serialManaged,
    qty: rl.availableQty,
    unitPrice: toYuanInput(rl.unitPrice),
    costAmount: null,
    refLineId: rl.refLineId,
    serials: [],
    serialInput: '',
    remark: '',
  })
}

async function findBySerial(): Promise<void> {
  const sn = serialFind.value.trim()
  if (!sn || !isReturn.value) return
  const hit = await call('doc:findBySerial', { serial: sn, docType: origDocType.value as 'PURCHASE' | 'SALE' })
  if (!hit) {
    ElMessage.warning('未找到包含该串号的原单')
    return
  }
  await onRefDocChange(hit.docId)
  const rl = returnable.value.find((l) => l.refLineId === hit.lineId)
  if (rl) {
    addReturnLine(rl)
    const line = form.lines.find((l) => l.refLineId === hit.lineId)
    if (line && !line.serials.includes(sn)) {
      line.serials.push(sn)
      line.qty = line.serials.length
    }
  }
  serialFind.value = ''
}

function addLine(): void {
  if (isReturn.value) return
  form.lines.push(emptyLine())
}

function removeLine(idx: number): void {
  form.lines.splice(idx, 1)
}

function pickItem(line: EditLine, item: ItemRow | null | undefined): void {
  if (!item) return
  line.itemId = item.id
  line.itemCode = item.code
  line.itemName = item.name
  line.serialManaged = item.serialManaged
  if (!isTransfer.value) {
    line.unitPrice = toYuanInput(docType.value === 'PURCHASE' ? item.defaultBuyPrice : item.defaultSellPrice)
  }
  line.serials = []
  line.serialInput = ''
}

function commitSerial(line: EditLine): void {
  const sn = line.serialInput.trim()
  if (!sn) return
  if (line.serials.includes(sn)) {
    ElMessage.warning(`串号重复：${sn}`)
    line.serialInput = ''
    return
  }
  line.serials.push(sn)
  line.qty = line.serials.length
  line.serialInput = ''
}

function removeSerial(line: EditLine, sn: string): void {
  line.serials = line.serials.filter((s) => s !== sn)
  line.qty = Math.max(1, line.serials.length)
}

function fromDetail(d: DocDetail): void {
  form.id = d.id
  form.docNo = d.docNo
  form.status = d.status
  form.bizDate = d.bizDate
  form.warehouseId = d.warehouseId
  form.toWarehouseId = d.toWarehouseId ?? undefined
  form.partnerId = d.partnerId ?? undefined
  form.refDocId = d.refDocId ?? undefined
  form.remark = d.remark
  form.lines = d.lines.map((l) => ({
    itemId: l.itemId,
    itemCode: l.itemCode,
    itemName: l.itemName,
    serialManaged: l.serialManaged,
    qty: l.qty,
    unitPrice: toYuanInput(l.unitPrice),
    costAmount: l.costAmount ?? null,
    refLineId: l.refLineId,
    serials: [...l.serials],
    serialInput: '',
    remark: l.remark,
  }))
}

async function load(): Promise<void> {
  await loadMeta()
  if (isNew.value) {
    if (!isReturn.value) form.lines = [emptyLine()]
  } else {
    fromDetail(await call('doc:get', { id: Number(docIdParam.value) }))
  }
  loaded.value = true
}

async function save(): Promise<void> {
  if (saving.value || !form.warehouseId) {
    ElMessage.warning('请选择仓库')
    return
  }
  if (isTransfer.value && !form.toWarehouseId) {
    ElMessage.warning('请选择调入仓')
    return
  }
  if (!isTransfer.value && !form.partnerId) {
    ElMessage.warning('请选择往来单位')
    return
  }
  if (isReturn.value && !form.refDocId) {
    ElMessage.warning('请选择原单')
    return
  }
  if (form.lines.length === 0 || form.lines.some((l) => !l.itemId)) {
    ElMessage.warning('请完善明细')
    return
  }
  saving.value = true
  try {
    const payload = {
      docType: docType.value,
      bizDate: form.bizDate,
      warehouseId: form.warehouseId,
      ...(isTransfer.value ? { toWarehouseId: form.toWarehouseId } : {}),
      ...(!isTransfer.value ? { partnerId: form.partnerId } : {}),
      ...(isReturn.value ? { refDocId: form.refDocId } : {}),
      remark: form.remark,
      lines: form.lines.map((l) => ({
        itemId: l.itemId!,
        qty: l.serialManaged ? l.serials.length || l.qty : l.qty,
        unitPrice: l.unitPrice,
        ...(l.refLineId ? { refLineId: l.refLineId } : {}),
        serials: l.serialManaged ? l.serials : [],
        remark: l.remark,
      })),
    }
    const saved = form.id
      ? await call('doc:update', { id: form.id, ...payload })
      : await call('doc:create', payload)
    ElMessage.success(`已保存并过账：${saved.docNo}`)
    await router.replace(`/docs/${docType.value}/${saved.id}`)
    fromDetail(saved)
  } catch (e) {
    showError(e)
  } finally {
    saving.value = false
  }
}

async function doUnpost(): Promise<void> {
  if (!form.id) return
  try {
    fromDetail(await call('doc:unpost', { id: form.id }))
    ElMessage.success('已反过账，可修改后重新保存')
  } catch (e) {
    showError(e)
  }
}

onMounted(load)
</script>

<template>
  <div v-if="loaded" class="page">
    <div class="toolbar">
      <el-button @click="router.push(`/docs/${docType}`)">返回列表</el-button>
      <span class="spacer" />
      <el-button v-if="readOnlyPosted && session.isOwner" type="warning" @click="doUnpost">反过账</el-button>
      <el-button v-if="!readOnlyPosted || form.status === 'draft'" type="primary" :loading="saving" @click="save">
        保存并过账
      </el-button>
    </div>

    <el-form label-width="84px" class="head" :disabled="readOnlyPosted && form.status === 'posted'">
      <el-row :gutter="12">
        <el-col :span="6">
          <el-form-item label="单号"><el-input :model-value="form.docNo || '（保存后生成）'" disabled /></el-form-item>
        </el-col>
        <el-col :span="6">
          <el-form-item label="业务日期" required>
            <el-date-picker
              v-model="form.bizDate"
              type="date"
              value-format="YYYY-MM-DD"
              :disabled-date="disableFuture"
              style="width: 100%"
            />
          </el-form-item>
        </el-col>
        <el-col :span="6">
          <el-form-item :label="isTransfer ? '调出仓' : '仓库'" required>
            <el-select v-model="form.warehouseId" style="width: 100%">
              <el-option v-for="w in warehouses" :key="w.id" :label="`${w.code} ${w.name}`" :value="w.id" />
            </el-select>
          </el-form-item>
        </el-col>
        <el-col v-if="isTransfer" :span="6">
          <el-form-item label="调入仓" required>
            <el-select v-model="form.toWarehouseId" style="width: 100%">
              <el-option v-for="w in warehouses" :key="w.id" :label="`${w.code} ${w.name}`" :value="w.id" />
            </el-select>
          </el-form-item>
        </el-col>
        <el-col v-if="!isTransfer" :span="6">
          <el-form-item :label="partnerKind === 'supplier' ? '供应商' : '客户'" required>
            <el-select v-model="form.partnerId" filterable style="width: 100%" :disabled="isReturn">
              <el-option v-for="p in partners" :key="p.id" :label="`${p.code} ${p.name}`" :value="p.id" />
            </el-select>
          </el-form-item>
        </el-col>
        <el-col v-if="isReturn" :span="12">
          <el-form-item label="原单" required>
            <el-select
              :model-value="form.refDocId"
              filterable
              style="width: 100%"
              placeholder="选择原单"
              @change="onRefDocChange"
            >
              <el-option
                v-for="d in origDocs"
                :key="d.id"
                :label="`${d.docNo} ${d.bizDate} ${d.partnerName ?? ''}`"
                :value="d.id"
              />
            </el-select>
          </el-form-item>
        </el-col>
        <el-col v-if="isReturn" :span="12">
          <el-form-item label="扫串号找原单">
            <el-input v-model="serialFind" placeholder="扫码后回车" @keyup.enter="findBySerial" />
          </el-form-item>
        </el-col>
        <el-col :span="24">
          <el-form-item label="备注"><el-input v-model="form.remark" maxlength="255" /></el-form-item>
        </el-col>
      </el-row>
    </el-form>

    <div v-if="isReturn && !(readOnlyPosted && form.status === 'posted')" class="toolbar">
      <span>可退明细：</span>
      <el-button
        v-for="rl in returnable"
        :key="rl.refLineId"
        size="small"
        @click="addReturnLine(rl)"
      >
        {{ rl.itemCode }} 可退 {{ rl.availableQty }}
      </el-button>
    </div>

    <div class="toolbar">
      <strong>{{ title }}明细</strong>
      <span class="spacer" />
      <el-button v-if="!isReturn && !(readOnlyPosted && form.status === 'posted')" @click="addLine">加行</el-button>
    </div>

    <el-table :data="form.lines" border style="width: 100%">
      <el-table-column label="商品" min-width="200">
        <template #default="{ row }">
          <template v-if="isReturn || (readOnlyPosted && form.status === 'posted')">
            {{ row.itemCode }} {{ row.itemName }}
          </template>
          <el-select
            v-else
            :model-value="row.itemId"
            filterable
            remote
            :remote-method="searchItems"
            style="width: 100%"
            @change="(id: number) => pickItem(row, itemOptions.find((i) => i.id === id) ?? null)"
          >
            <el-option v-for="i in itemOptions" :key="i.id" :label="`${i.code} ${i.name}`" :value="i.id" />
            <el-option
              v-if="row.itemId && !itemOptions.some((i) => i.id === row.itemId)"
              :label="`${row.itemCode} ${row.itemName}`"
              :value="row.itemId"
            />
          </el-select>
        </template>
      </el-table-column>
      <el-table-column label="数量" width="100">
        <template #default="{ row }">
          <el-input-number
            v-model="row.qty"
            :min="1"
            :disabled="row.serialManaged || (readOnlyPosted && form.status === 'posted')"
            controls-position="right"
            style="width: 100%"
          />
        </template>
      </el-table-column>
      <el-table-column v-if="!isTransfer" label="单价" width="110">
        <template #default="{ row }">
          <el-input v-model="row.unitPrice" :disabled="lockedPrice || (readOnlyPosted && form.status === 'posted')" />
        </template>
      </el-table-column>
      <el-table-column label="串号" min-width="200">
        <template #default="{ row }">
          <template v-if="row.serialManaged">
            <div class="serials">
              <el-tag
                v-for="sn in row.serials"
                :key="sn"
                :closable="!(readOnlyPosted && form.status === 'posted')"
                @close="removeSerial(row, sn)"
              >
                {{ sn }}
              </el-tag>
            </div>
            <el-input
              v-if="!(readOnlyPosted && form.status === 'posted')"
              v-model="row.serialInput"
              placeholder="扫码后回车"
              @keyup.enter="commitSerial(row)"
            />
          </template>
          <span v-else class="muted">—</span>
        </template>
      </el-table-column>
      <el-table-column v-if="session.isOwner" label="成本" width="100" align="right">
        <template #default="{ row }">{{ row.costAmount === null ? '—' : yuan(row.costAmount) }}</template>
      </el-table-column>
      <el-table-column label="操作" width="70">
        <template #default="{ $index }">
          <el-button
            v-if="!(readOnlyPosted && form.status === 'posted')"
            link
            type="danger"
            @click="removeLine($index)"
          >
            删
          </el-button>
        </template>
      </el-table-column>
    </el-table>
  </div>
</template>

<style scoped>
.head {
  background: #fff;
  padding: 12px 12px 0;
  border: 1px solid #ebeef5;
}
.serials {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-bottom: 4px;
}
.muted {
  color: #c0c4cc;
}
</style>
