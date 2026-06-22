<template>
  <div>
    <header class="page-head">
      <div class="page-head__text">
        <span class="cap-eyebrow is-accent">WORKER TASKS</span>
        <h1 class="page-head__title">全局任务模板</h1>
        <p class="page-head__lede cap-body-sm">生成、评分、记忆、图谱、改写 — 每种 worker 一个 prompt 模板，全局可覆盖。</p>
      </div>
      <div class="page-head__actions">
        <n-select v-model:value="filterWorkerType" :options="[{ label: '全部类型', value: '' }, ...workerTypeOptions]" style="width: 160px" placeholder="筛选类型" clearable />
        <button class="cap-pill is-primary" @click="openCreate">+ 新建 Task</button>
      </div>
    </header>

    <div class="cap-card" style="margin-bottom: 16px; padding: 14px 18px; background: var(--accent-info-tint); border-color: transparent;">
      <span class="cap-body-sm" style="color: var(--accent-link);">
        此处配置的是全局任务模板。系统内置的 Task 不可编辑删除，但你可以"以此为基础新建"自己的版本。
      </span>
    </div>

    <div class="cap-card" style="padding: 0; overflow: hidden">
      <n-data-table :columns="columns" :data="filteredTasks" :loading="loading" :bordered="false" />
    </div>

    <n-modal v-model:show="showModal" :title="editingId ? '编辑 Task' : '新建 Task'" preset="card" style="width: 750px; max-height: 90vh">
      <n-scrollbar style="max-height: 75vh">
        <n-form :model="form" label-placement="left" label-width="110">
          <n-form-item label="名称">
            <n-input v-model:value="form.name" placeholder="Task 名称，如：默认生成策略" />
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
import {
  NSpace, NButton, NDataTable, NModal, NForm, NFormItem, NInput, NSelect, NSwitch, NScrollbar, NTag,
  type DataTableColumns
} from 'naive-ui'
import { workerTaskApi } from '../api/worker-task'

const tasks = ref<any[]>([])
const loading = ref(false)
const showModal = ref(false)
const editingId = ref<string | null>(null)
const filterWorkerType = ref('')

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

const filteredTasks = computed(() => {
  let list = tasks.value
  if (filterWorkerType.value) list = list.filter(t => t.workerType === filterWorkerType.value)
  return list
})

const columns: DataTableColumns<any> = [
  { title: '名称', key: 'name', width: 180, render(row) { return row.name || '-' } },
  {
    title: '类型', key: 'type', width: 100, render(row) {
      return row.type === 'system'
        ? h(NTag, { type: 'warning', size: 'small' }, { default: () => '系统内置' })
        : h(NTag, { type: 'default', size: 'small' }, { default: () => '自定义' })
    }
  },
  { title: 'Worker 类型', key: 'workerType', width: 150 },
  { title: 'Task Prompt', key: 'taskPrompt', ellipsis: { tooltip: true } },
  { title: '启用', key: 'enabled', width: 80, render(row) { return row.enabled ? '是' : '否' } },
  {
    title: '操作',
    key: 'actions',
    width: 180,
    render(row) {
      if (row.type === 'system') {
        return h(NSpace, null, {
          default: () => [
            h(NButton, { size: 'small', onClick: () => cloneFromSystem(row) }, { default: () => '以此为基础新建' })
          ]
        })
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
    const res = await workerTaskApi.list()
    tasks.value = res.data.data
  } finally {
    loading.value = false
  }
}

function openCreate() {
  editingId.value = null
  form.value = { name: '', workerType: 'generation', taskPrompt: '', enabled: true }
  showModal.value = true
}

function cloneFromSystem(row: any) {
  editingId.value = null
  form.value = {
    name: row.name ? row.name.replace('[系统] ', '').replace('（系统）', '') + '（自定义）' : '',
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
    await workerTaskApi.create({ ...payload, storyId: null })
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
