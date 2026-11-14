<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { DOC_TYPE_LABEL, type DocDetail, type DocType, type ItemRow, type PartnerRow, type WarehouseRow } from '@shared/dto'
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
  /** 已过账单据的行成本（分）；仅老板可见，编辑时不提交。 */
  costAmount: number | null
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

const warehouses = ref<WarehouseRow[]>([])
const partners = ref<PartnerRow[]>([])
const itemKeyword = ref('')
const itemOptions = ref<ItemRow[]>([])

const form = reactive({
  id: undefined as number | undefined,
  docNo: '',
  status: 'draft' as 'draft' | 'posted',
  bizDate: today(),
  warehouseId: undefined as number | undefined,
  partnerId: undefined as number | undefined,
  remark: '',
  lines: [] as EditLine[],
})
const loaded = ref(false)
const saving = ref(false)

const partnerKind = computed(() => (docType.value === 'PURCHASE' ? 'supplier' : 'customer'))
const canEdit = computed(() => isNew.value || form.status === 'draft' || session.isOwner)
const readOnlyPosted = computed(() => form.status === 'posted' && !isNew.value)

function emptyLine(): EditLine {
  return {
    itemId: null,
    itemCode: '',
    itemName: '',
    serialManaged: false,
    qty: 1,
    unitPrice: '0.00',
    costAmount: null,
    serials: [],
    serialInput: '',
    remark: '',
  }
}

async function loadMeta(): Promise<void> {
  warehouses.value = await call('warehouse:list', {})
  partners.value = await call('partner:list', { kind: partnerKind.value })
  if (!form.warehouseId && warehouses.value[0]) form.warehouseId = warehouses.value[0].id
}

async function searchItems(q: string): Promise<void> {
  itemKeyword.value = q
  const r = await call('item:list', { keyword: q, page: 1, pageSize: 30 })
  itemOptions.value = r.rows
}

function addLine(): void {
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
  line.unitPrice = toYuanInput(docType.value === 'PURCHASE' ? item.defaultBuyPrice : item.defaultSellPrice)
  line.serials = []
  line.serialInput = ''
  if (line.serialManaged) line.qty = Math.max(line.qty, 1)
}

/** 扫码枪：回车即提交一个串号（设计文档 11.2）。 */
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
  form.partnerId = d.partnerId ?? undefined
  form.remark = d.remark
  form.lines = d.lines.map((l) => ({
    itemId: l.itemId,
    itemCode: l.itemCode,
    itemName: l.itemName,
    serialManaged: l.serialManaged,
    qty: l.qty,
    unitPrice: toYuanInput(l.unitPrice),
    costAmount: l.costAmount ?? null,
    serials: [...l.serials],
    serialInput: '',
    remark: l.remark,
  }))
}

async function load(): Promise<void> {
  await loadMeta()
  if (isNew.value) {
    form.lines = [emptyLine()]
  } else {
    const d = await call('doc:get', { id: Number(docIdParam.value) })
    fromDetail(d)
  }
  loaded.value = true
}

async function save(): Promise<void> {
  if (saving.value || !form.warehouseId || !form.partnerId) {
    if (!form.warehouseId || !form.partnerId) ElMessage.warning('请选择仓库和往来单位')
    return
  }
  if (form.lines.length === 0 || form.lines.some((l) => !l.itemId)) {
    ElMessage.warning('请完善明细商品')
    return
  }
  saving.value = true
  try {
    const payload = {
      docType: docType.value,
      bizDate: form.bizDate,
      warehouseId: form.warehouseId,
      partnerId: form.partnerId,
      remark: form.remark,
      lines: form.lines.map((l) => ({
        itemId: l.itemId!,
        qty: l.serialManaged ? l.serials.length || l.qty : l.qty,
        unitPrice: l.unitPrice,
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
    const d = await call('doc:unpost', { id: form.id })
    fromDetail(d)
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
      <template v-if="readOnlyPosted && session.isOwner">
        <el-button type="warning" @click="doUnpost">反过账</el-button>
      </template>
      <el-button v-if="canEdit && (!readOnlyPosted || form.status === 'draft')" type="primary" :loading="saving" @click="save">
        保存并过账
      </el-button>
    </div>

    <el-form label-width="80px" class="head" :disabled="readOnlyPosted && form.status === 'posted'">
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
          <el-form-item label="仓库" required>
            <el-select v-model="form.warehouseId" style="width: 100%">
              <el-option v-for="w in warehouses" :key="w.id" :label="`${w.code} ${w.name}`" :value="w.id" />
            </el-select>
          </el-form-item>
        </el-col>
        <el-col :span="6">
          <el-form-item :label="partnerKind === 'supplier' ? '供应商' : '客户'" required>
            <el-select v-model="form.partnerId" filterable style="width: 100%">
              <el-option v-for="p in partners" :key="p.id" :label="`${p.code} ${p.name}`" :value="p.id" />
            </el-select>
          </el-form-item>
        </el-col>
        <el-col :span="24">
          <el-form-item label="备注"><el-input v-model="form.remark" maxlength="255" /></el-form-item>
        </el-col>
      </el-row>
    </el-form>

    <div class="toolbar">
      <strong>{{ title }}明细</strong>
      <span class="spacer" />
      <el-button v-if="!(readOnlyPosted && form.status === 'posted')" @click="addLine">加行</el-button>
    </div>

    <el-table :data="form.lines" border style="width: 100%">
      <el-table-column label="商品" min-width="220">
        <template #default="{ row }">
          <el-select
            :model-value="row.itemId"
            filterable
            remote
            :remote-method="searchItems"
            placeholder="编码/名称/条码"
            style="width: 100%"
            :disabled="readOnlyPosted && form.status === 'posted'"
            @change="(id: number) => pickItem(row, itemOptions.find((i) => i.id === id) ?? null)"
          >
            <el-option
              v-for="i in itemOptions"
              :key="i.id"
              :label="`${i.code} ${i.name}`"
              :value="i.id"
            />
            <el-option v-if="row.itemId && !itemOptions.some((i) => i.id === row.itemId)" :label="`${row.itemCode} ${row.itemName}`" :value="row.itemId" />
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
      <el-table-column label="单价" width="120">
        <template #default="{ row }">
          <el-input v-model="row.unitPrice" :disabled="readOnlyPosted && form.status === 'posted'" />
        </template>
      </el-table-column>
      <el-table-column label="串号" min-width="220">
        <template #default="{ row }">
          <template v-if="row.serialManaged">
            <div class="serials">
              <el-tag v-for="sn in row.serials" :key="sn" closable :disable-transitions="true" @close="removeSerial(row, sn)">
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
