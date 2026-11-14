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
  type UserOption,
  type WarehouseRow,
} from '@shared/dto'
import { call, shellApi } from '../../api'
import { showError } from '../../api/errors'
import { buildDocPrintHtml } from '../../print/docHtml'
import { loadShopPrintInfo } from '../../print/shop'
import { useSessionStore } from '../../stores/session'
import { disableFuture, today, toYuanInput, yuan } from '../../utils/format'
import SerialScanDialog from '../../components/SerialScanDialog.vue'

interface EditLine {
  itemId: number | null
  itemCode: string
  itemName: string
  /** R23：全商品串号；保留字段兼容历史明细展示。 */
  serialManaged: boolean
  qty: number
  unitPrice: string
  costAmount: number | null
  rebatePerUnit: string
  rebateAmount: string
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
const userOptions = ref<UserOption[]>([])
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
  createdByUserId: undefined as number | undefined,
  refDocId: undefined as number | undefined,
  remark: '',
  lines: [] as EditLine[],
})
const loaded = ref(false)
const saving = ref(false)
const serialFind = ref('')
const scanOpen = ref(false)
const scanLineIndex = ref(-1)

const partnerKind = computed(() =>
  docType.value === 'PURCHASE' || docType.value === 'PURCHASE_RETURN' ? 'supplier' : 'customer',
)
const partnerLabel = computed(() => (partnerKind.value === 'supplier' ? '供应商' : '客户'))
const isPurchase = computed(() => docType.value === 'PURCHASE')
/** 新建：店员/老板均可编；已过账：只读；草稿：仅老板可编（R3，与 doc:update 一致）。 */
const canEdit = computed(() => {
  if (isNew.value) return true
  if (form.status === 'posted') return false
  return session.isOwner
})
const lockedPrice = computed(() => isTransfer.value || isReturn.value)
const scanLine = computed(() =>
  scanLineIndex.value >= 0 ? (form.lines[scanLineIndex.value] ?? null) : null,
)

function emptyLine(): EditLine {
  return {
    itemId: null,
    itemCode: '',
    itemName: '',
    serialManaged: true,
    qty: 0,
    unitPrice: '0.00',
    costAmount: null,
    rebatePerUnit: '0.00',
    rebateAmount: '0.00',
    refLineId: null,
    serials: [],
    serialInput: '',
    remark: '',
  }
}

/** 金额 = 单价 × 数量（展示用，落库由后端按同公式写 cost）。 */
function lineAmountYuan(line: EditLine): string {
  const price = Number(line.unitPrice || 0)
  if (!Number.isFinite(price)) return '0.00'
  return (price * line.qty).toFixed(2)
}

function syncLineQty(line: EditLine): void {
  line.qty = line.serials.length
  if (isPurchase.value) {
    const per = Number(line.rebatePerUnit || 0)
    line.rebateAmount = Number.isFinite(per) ? (per * line.qty).toFixed(2) : '0.00'
  }
}

function openScan(idx: number): void {
  if (!canEdit.value) return
  scanLineIndex.value = idx
  scanOpen.value = true
}

function onScanConfirm(serials: string[]): void {
  const line = scanLine.value
  if (!line) return
  line.serials = [...serials]
  syncLineQty(line)
  scanOpen.value = false
  scanLineIndex.value = -1
}

async function loadMeta(): Promise<void> {
  warehouses.value = await call('warehouse:list', {})
  userOptions.value = await call('user:options', {})
  if (!form.createdByUserId && session.session) {
    form.createdByUserId = session.session.userId
  }
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
    serialManaged: true,
    qty: 0,
    unitPrice: toYuanInput(rl.unitPrice),
    costAmount: null,
    rebatePerUnit: '0.00',
    rebateAmount: '0.00',
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
      syncLineQty(line)
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
  line.serialManaged = true
  if (!isTransfer.value) {
    line.unitPrice = toYuanInput(docType.value === 'PURCHASE' ? item.defaultBuyPrice : item.defaultSellPrice)
  }
  line.serials = []
  line.serialInput = ''
  syncLineQty(line)
}

function fromDetail(d: DocDetail): void {
  form.id = d.id
  form.docNo = d.docNo
  form.status = d.status
  form.bizDate = d.bizDate
  form.warehouseId = d.warehouseId
  form.toWarehouseId = d.toWarehouseId ?? undefined
  form.partnerId = d.partnerId ?? undefined
  form.createdByUserId = d.createdBy
  form.refDocId = d.refDocId ?? undefined
  form.remark = d.remark
  form.lines = d.lines.map((l) => ({
    itemId: l.itemId,
    itemCode: l.itemCode,
    itemName: l.itemName,
    serialManaged: true,
    qty: l.serials.length || l.qty,
    unitPrice: toYuanInput(l.unitPrice),
    costAmount: l.costAmount ?? null,
    rebatePerUnit: toYuanInput(l.rebatePerUnit ?? 0),
    rebateAmount: toYuanInput(l.rebateAmount ?? 0),
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
    ElMessage.warning(`请选择${partnerLabel.value}`)
    return
  }
  if (isReturn.value && !form.refDocId) {
    ElMessage.warning('请选择原单')
    return
  }
  if (form.lines.length === 0 || form.lines.some((l) => !l.itemId || l.serials.length === 0)) {
    ElMessage.warning('请完善明细并扫入串号（数量=串号个数）')
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
      ...(form.createdByUserId ? { createdByUserId: form.createdByUserId } : {}),
      remark: form.remark,
      lines: form.lines.map((l) => ({
        itemId: l.itemId!,
        qty: l.serials.length,
        unitPrice: l.unitPrice,
        ...(isPurchase.value
          ? { rebatePerUnit: l.rebatePerUnit, rebateAmount: l.rebateAmount }
          : {}),
        ...(l.refLineId ? { refLineId: l.refLineId } : {}),
        serials: l.serials,
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

/** 已保存单据才能打印：需要完整 DocDetail（含单号、行成本隐藏字段等）。 */
async function printDoc(asPdf: boolean): Promise<void> {
  if (!form.id) {
    ElMessage.warning('请先保存单据')
    return
  }
  try {
    const doc = await call('doc:get', { id: form.id })
    const shop = await loadShopPrintInfo()
    const html = buildDocPrintHtml(doc, shop)
    if (asPdf) {
      const path = await shellApi().printToPdf({ html, defaultPath: `${doc.docNo}.pdf` })
      if (path) ElMessage.success(`已保存 PDF：${path}`)
    } else {
      const r = await shellApi().print({ html })
      if (!r.ok) ElMessage.error(r.error || '打印失败')
    }
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
      <el-button v-if="form.id" @click="printDoc(false)">打印</el-button>
      <el-button v-if="form.id" @click="printDoc(true)">导出 PDF</el-button>
      <el-button v-if="form.status === 'posted' && !isNew && session.isOwner" type="warning" @click="doUnpost">
        反过账
      </el-button>
      <el-button v-if="canEdit" type="primary" :loading="saving" @click="save">保存并过账</el-button>
    </div>

    <el-form label-width="84px" class="head" :disabled="!canEdit">
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
              <el-option v-for="w in warehouses" :key="w.id" :label="w.name" :value="w.id" />
            </el-select>
          </el-form-item>
        </el-col>
        <el-col v-if="isTransfer" :span="6">
          <el-form-item label="调入仓" required>
            <el-select v-model="form.toWarehouseId" style="width: 100%">
              <el-option v-for="w in warehouses" :key="w.id" :label="w.name" :value="w.id" />
            </el-select>
          </el-form-item>
        </el-col>
        <el-col v-if="!isTransfer" :span="6">
          <el-form-item :label="partnerKind === 'supplier' ? '供应商' : '客户'" required>
            <el-select v-model="form.partnerId" filterable style="width: 100%" :disabled="isReturn">
              <el-option v-for="p in partners" :key="p.id" :label="p.name" :value="p.id" />
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
        <el-col :span="6">
          <el-form-item label="录入人" required>
            <el-select v-model="form.createdByUserId" filterable style="width: 100%">
              <el-option
                v-for="u in userOptions"
                :key="u.id"
                :label="u.displayName || u.username"
                :value="u.id"
              />
            </el-select>
          </el-form-item>
        </el-col>
        <el-col :span="18">
          <el-form-item label="备注"><el-input v-model="form.remark" maxlength="255" /></el-form-item>
        </el-col>
      </el-row>
    </el-form>

    <div v-if="isReturn && canEdit" class="toolbar">
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
      <el-button v-if="!isReturn && canEdit" @click="addLine">加行</el-button>
    </div>

    <el-table :data="form.lines" border style="width: 100%">
      <el-table-column label="商品" min-width="200">
        <template #default="{ row }">
          <template v-if="isReturn || !canEdit">
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
      <el-table-column label="数量" width="90" align="right">
        <template #default="{ row }">{{ row.qty }}</template>
      </el-table-column>
      <el-table-column v-if="!isTransfer" label="单价" width="110">
        <template #default="{ row }">
          <el-input v-model="row.unitPrice" :disabled="lockedPrice || !canEdit" />
        </template>
      </el-table-column>
      <el-table-column v-if="!isTransfer" label="金额" width="100" align="right">
        <template #default="{ row }">{{ lineAmountYuan(row) }}</template>
      </el-table-column>
      <el-table-column v-if="isPurchase" label="单台返利" width="110">
        <template #default="{ row }">
          <el-input
            v-model="row.rebatePerUnit"
            :disabled="!canEdit"
            @change="syncLineQty(row)"
          />
        </template>
      </el-table-column>
      <el-table-column v-if="isPurchase" label="返利金额" width="100" align="right">
        <template #default="{ row }">{{ row.rebateAmount }}</template>
      </el-table-column>
      <el-table-column label="串号" min-width="220">
        <template #default="{ row, $index }">
          <div
            class="serial-cell"
            :class="{ clickable: canEdit }"
            @click="openScan($index)"
          >
            <template v-if="row.serials.length">
              <el-tag v-for="sn in row.serials" :key="sn" size="small">{{ sn }}</el-tag>
            </template>
            <span v-else class="muted">{{ canEdit ? '点击扫串号' : '—' }}</span>
          </div>
        </template>
      </el-table-column>
      <el-table-column v-if="session.isOwner" label="成本" width="100" align="right">
        <template #default="{ row }">{{ row.costAmount === null ? '—' : yuan(row.costAmount) }}</template>
      </el-table-column>
      <el-table-column label="操作" width="70">
        <template #default="{ $index }">
          <el-button v-if="canEdit" link type="danger" @click="removeLine($index)">删</el-button>
        </template>
      </el-table-column>
    </el-table>

    <SerialScanDialog
      v-model="scanOpen"
      :item-name="scanLine ? `${scanLine.itemCode} ${scanLine.itemName}` : ''"
      :unit-price-text="scanLine?.unitPrice ?? '0.00'"
      :initial-serials="scanLine?.serials ?? []"
      @confirm="onScanConfirm"
    />
  </div>
</template>

<style scoped>
.head {
  background: #fff;
  padding: 12px 12px 0;
  border: 1px solid #ebeef5;
}
.serial-cell {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  min-height: 28px;
  align-items: center;
}
.serial-cell.clickable {
  cursor: pointer;
}
.muted {
  color: #c0c4cc;
}
</style>
