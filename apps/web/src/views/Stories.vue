<template>
  <div>
    <n-space justify="space-between" align="center" style="margin-bottom: 16px">
      <n-h1>小说管理</n-h1>
      <n-button type="primary" @click="openCreate">新建小说</n-button>
    </n-space>
    <n-data-table :columns="columns" :data="stories" :loading="loading" />

    <n-modal v-model:show="showModal" :title="editingId ? '编辑小说' : '新建小说'" preset="card" style="width: 500px">
      <n-form :model="form" label-placement="left" label-width="100">
        <n-form-item label="标题" required>
          <n-input v-model:value="form.title" placeholder="请输入小说标题" />
        </n-form-item>
        <n-form-item label="简介">
          <n-input v-model:value="form.description" type="textarea" placeholder="请输入简介" />
        </n-form-item>
        <n-form-item label="Runtime Profile">
          <n-select
            v-model:value="form.runtimeProfileId"
            :options="profileOptions"
            placeholder="选择关联的 Runtime Profile（可选）"
            clearable
          />
        </n-form-item>
      </n-form>
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
import { useRouter } from 'vue-router'
import {
  NH1, NSpace, NButton, NDataTable, NModal, NForm, NFormItem, NInput, NSelect,
  type DataTableColumns
} from 'naive-ui'
import { storiesApi } from '../api/stories'
import { runtimeApi } from '../api/runtime'

const router = useRouter()
const stories = ref<any[]>([])
const profiles = ref<any[]>([])
const loading = ref(false)
const showModal = ref(false)
const editingId = ref<string | null>(null)
const form = ref({ title: '', description: '', runtimeProfileId: null as string | null })

const profileOptions = computed(() => [
  { label: '不关联', value: null },
  ...profiles.value.map(p => ({ label: p.name, value: p.id }))
])

const columns: DataTableColumns<any> = [
  { title: '标题', key: 'title' },
  { title: '简介', key: 'description', ellipsis: { tooltip: true } },
  { title: '状态', key: 'status', width: 100 },
  { title: 'Profile', key: 'runtimeProfile', width: 150, render(row) { return row.runtimeProfile?.name || '-' } },
  { title: '章节数', key: '_count.chapters', width: 80 },
  { title: '角色数', key: '_count.characters', width: 80 },
  { title: '更新时间', key: 'updatedAt', width: 170 },
  {
    title: '操作',
    key: 'actions',
    width: 220,
    render(row) {
      return h(NSpace, null, {
        default: () => [
          h(NButton, { size: 'small', type: 'primary', onClick: () => enterDesign(row.id) }, { default: () => '设计' }),
          h(NButton, { size: 'small', onClick: () => startEdit(row) }, { default: () => '编辑' }),
          h(NButton, { size: 'small', type: 'error', onClick: () => handleDelete(row.id) }, { default: () => '删除' })
        ]
      })
    }
  }
]

async function loadStories() {
  loading.value = true
  try {
    const [storiesRes, profilesRes] = await Promise.all([
      storiesApi.list(),
      runtimeApi.list()
    ])
    stories.value = storiesRes.data.data
    profiles.value = profilesRes.data.data
  } finally {
    loading.value = false
  }
}

function enterDesign(storyId: string) {
  router.push(`/novel-design/${storyId}/characters`)
}

function openCreate() {
  editingId.value = null
  form.value = { title: '', description: '', runtimeProfileId: null }
  showModal.value = true
}

function startEdit(row: any) {
  editingId.value = row.id
  form.value = {
    title: row.title,
    description: row.description || '',
    runtimeProfileId: row.runtimeProfileId || null
  }
  showModal.value = true
}

async function handleSave() {
  if (!form.value.title) return
  const payload = {
    title: form.value.title,
    description: form.value.description,
    runtimeProfileId: form.value.runtimeProfileId
  }
  if (editingId.value) {
    await storiesApi.update(editingId.value, payload)
  } else {
    await storiesApi.create(payload)
  }
  showModal.value = false
  editingId.value = null
  form.value = { title: '', description: '', runtimeProfileId: null }
  await loadStories()
}

async function handleDelete(id: string) {
  await storiesApi.remove(id)
  await loadStories()
}

onMounted(loadStories)
</script>
