<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'

const props = defineProps<{
  modelValue: boolean
  itemName: string
  unitPriceText: string
  initialSerials: string[]
}>()

const emit = defineEmits<{
  'update:modelValue': [boolean]
  confirm: [serials: string[]]
}>()

const input = ref('')
const serials = ref<string[]>([])
const inputRef = ref<{ focus: () => void } | null>(null)

const open = computed({
  get: () => props.modelValue,
  set: (v: boolean) => emit('update:modelValue', v),
})

watch(
  () => props.modelValue,
  async (v) => {
    if (!v) return
    serials.value = [...props.initialSerials]
    input.value = ''
    await nextTick()
    inputRef.value?.focus()
  },
)

function addSerial(): void {
  const sn = input.value.trim()
  if (!sn) return
  if (serials.value.includes(sn)) {
    ElMessage.warning(`串号重复：${sn}`)
    input.value = ''
    return
  }
  serials.value.push(sn)
  input.value = ''
}

function removeAt(idx: number): void {
  serials.value.splice(idx, 1)
}

function confirm(): void {
  emit('confirm', [...serials.value])
  open.value = false
}
</script>

<template>
  <el-dialog v-model="open" title="扫串号" width="640px" destroy-on-close>
    <div class="meta">
      <div>商品名称：{{ itemName || '—' }}</div>
      <div>已扫数：{{ serials.length }}　单价：{{ unitPriceText }}</div>
    </div>
    <div class="scan-row">
      <el-input
        ref="inputRef"
        v-model="input"
        placeholder="串号扫码框（扫码后回车）"
        @keyup.enter="addSerial"
      />
      <el-button type="primary" @click="addSerial">加入</el-button>
    </div>
    <el-table :data="serials.map((s) => ({ serial: s }))" border height="280" style="margin-top: 12px">
      <el-table-column type="index" label="#" width="50" />
      <el-table-column prop="serial" label="已扫串号" />
      <el-table-column label="操作" width="80">
        <template #default="{ $index }">
          <el-button link type="danger" @click="removeAt($index)">删除</el-button>
        </template>
      </el-table-column>
    </el-table>
    <template #footer>
      <el-button @click="open = false">取消</el-button>
      <el-button type="primary" @click="confirm">确定（数量 = {{ serials.length }}）</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.meta {
  display: flex;
  justify-content: space-between;
  margin-bottom: 12px;
  color: #606266;
}
.scan-row {
  display: flex;
  gap: 8px;
}
</style>
