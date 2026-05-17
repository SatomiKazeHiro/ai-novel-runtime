<template>
  <div>
    <n-space justify="space-between" align="center" style="margin-bottom: 16px">
      <n-h1>Worker Task 配置</n-h1>
      <n-space>
        <n-select v-model:value="filterScope" :options="scopeOptions" style="width: 140px" />
        <n-select v-model:value="filterWorkerType" :options="[{ label: '全部类型', value: '' }, ...workerTypeOptions]" style="width: 160px" placeholder="筛选类型" clearable />
        <n-button type="primary" @click="openCreate">新建 Task</n-button>
      </n-space>
    </n-space>

    <n-alert type="info" style="margin-bottom: 16px">
      当前小说专属的 Worker Task 会覆盖全局默认。未覆盖的类型将自动回退到全局配置。
    </n-alert>

    <n-data-table :columns="columns" :data="filteredTasks" :loading="loading" />

    <n-modal v-model:show="showModal" :title="editingId ? '编辑 Task' : '新建 Task'" preset="card" style="width: 750px; max-height: 90vh">
      <n-scrollbar style="max-height: 75vh">
        <n-form :model="form" label-placement="left" label-width="110">
          <n-form-item label="名称">
            <n-input v-model:value="form.name" placeholder="Task 名称，如：本章生成策略" />
          </n-form-item>
          <n-form-item label="Worker 类型" required>
            <n-select v-model:value="form.workerType" :options="workerTypeOptions" placeholder="选择 Worker 类型" />
          </n-form-item>
          <n-form-item label="Task Prompt" required>
            <n-input v-model:value="form.taskPrompt" type="textarea" :rows="10" placeholder="该 Worker 的 Task Layer 内容..." />
          </n-form-item>
          <n-form-item label="启用">
            <n-switch v-model:value="form.enabled" />
          </n-form-item>
        </n-form>
      </n-scrollbar>
      <template #footer>
        <n-space justify="end">
          <n-button @click="showModal = false">取消</n-button>
          <n-button type="primary" @click="handleSave">保存</n-button>
        </n-space>
      </template>
    </n-modal>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, h, computed } from 'vue'
import { useRoute } from 'vue-router'
import {
  NH1, NSpace, NButton, NDataTable, NModal, NForm, NFormItem, NInput, NSelect, NSwitch, NScrollbar, NAlert, NTag,
  type DataTableColumns
} from 'naive-ui'
import { workerTaskApi } from '../api/worker-task'

const route = useRoute()
const storyId = computed(() => route.params.storyId as string)

const tasks = ref<any[]>([])
const loading = ref(false)
const showModal = ref(false)
const editingId = ref<string | null>(null)
const filterWorkerType = ref('')
const filterScope = ref('all')

const form = ref({
  name: '',
  workerType: 'generation',
  taskPrompt: '',
  enabled: true
})

const workerTypeOptions = [
  { label: 'Generation（生成）', value: 'generation' },
  { label: 'Scoring（评分）', value: 'scoring' },
  { label: 'Memory（记忆提取）', value: 'memory' },
  { label: 'Graph（图谱提取）', value: 'graph' },
  { label: 'Timeline（时间线）', value: 'timeline' },
  { label: 'Rewrite（改写）', value: 'rewrite' }
]

const scopeOptions = [
  { label: '全部', value: 'all' },
  { label: '当前小说', value: 'story' },
  { label: '全局继承', value: 'global' }
]

const filteredTasks = computed(() => {
  let list = tasks.value
  if (filterScope.value === 'story') list = list.filter(t => t.storyId === storyId.value)
  if (filterScope.value === 'global') list = list.filter(t => !t.storyId)
  if (filterWorkerType.value) list = list.filter(t => t.workerType === filterWorkerType.value)
  return list
})

const columns: DataTableColumns<any> = [
  { title: '名称', key: 'name', width: 180, render(row) { return row.name || '-' } },
  { title: '来源', key: 'scope', width: 100, render(row) {
    return row.storyId
      ? h(NTag, { type: 'success', size: 'small' }, { default: () => '当前小说' })
      : h(NTag, { type: 'default', size: 'small' }, { default: () => '全局继承' })
  }},
  { title: 'Worker 类型', key: 'workerType', width: 150 },
  { title: 'Task Prompt', key: 'taskPrompt', ellipsis: { tooltip: true } },
  { title: '启用', key: 'enabled', width: 80, render(row) { return row.enabled ? '是' : '否' } },
  {
    title: '操作',
    key: 'actions',
    width: 150,
    render(row) {
      if (!row.storyId) {
        return h(NButton, { size: 'small', onClick: () => copyFromGlobal(row) }, { default: () => '复制并覆盖' })
      }
      return h(NSpace, null, {
        default: () => [
          h(NButton, { size: 'small', onClick: () => startEdit(row) }, { default: () => '编辑' }),
          h(NButton, { size: 'small', type: 'error', onClick: () => handleDelete(row.id) }, { default: () => '删除' })
        ]
      })
    }
  }
]

async function loadTasks() {
  loading.value = true
  try {
    const [storyRes, globalRes] = await Promise.all([
      workerTaskApi.list({ storyId: storyId.value }),
      workerTaskApi.list({ storyId: 'null' })
    ])
    const storyTasks = storyRes.data.data.map((t: any) => ({ ...t, scope: 'story' }))
    const globalTasks = globalRes.data.data.map((t: any) => ({ ...t, scope: 'global' }))
    // 去重：如果当前小说有某类型的 Task，则该全局 Task 被覆盖，不显示
    const storyTypes = new Set(storyTasks.map((t: any) => t.workerType))
    const visibleGlobals = globalTasks.filter((t: any) => !storyTypes.has(t.workerType))
    tasks.value = [...storyTasks, ...visibleGlobals]
  } finally {
    loading.value = false
  }
}

function openCreate() {
  editingId.value = null
  form.value = { name: '', workerType: 'generation', taskPrompt: '', enabled: true }
  showModal.value = true
}

function copyFromGlobal(row: any) {
  editingId.value = null
  form.value = {
    name: row.name ? `${row.name} (覆盖)` : '',
    workerType: row.workerType,
    taskPrompt: row.taskPrompt,
    enabled: row.enabled
  }
  showModal.value = true
}

function startEdit(row: any) {
  editingId.value = row.id
  form.value = {
    name: row.name || '',
    workerType: row.workerType,
    taskPrompt: row.taskPrompt,
    enabled: row.enabled
  }
  showModal.value = true
}

async function handleSave() {
  const payload = {
    name: form.value.name,
    workerType: form.value.workerType,
    taskPrompt: form.value.taskPrompt,
    enabled: form.value.enabled
  }
  if (editingId.value) {
    await workerTaskApi.update(editingId.value, payload)
  } else {
    await workerTaskApi.create({ ...payload, storyId: storyId.value })
  }
  showModal.value = false
  editingId.value = null
  form.value = { name: '', workerType: 'generation', taskPrompt: '', enabled: true }
  await loadTasks()
}

async function handleDelete(id: string) {
  await workerTaskApi.remove(id)
  await loadTasks()
}

onMounted(loadTasks)
</script>
