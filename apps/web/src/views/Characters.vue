<template>
  <div>
    <n-space justify="space-between" align="center" style="margin-bottom: 16px">
      <n-h1>角色管理</n-h1>
      <n-space>
        <n-select v-model:value="versions.selectedVersionBranchId" :options="versions.versionBranchOptions" style="width: 180px" size="small" placeholder="版本" @update:value="loadCharacters" />
        <n-button type="primary" @click="openCreate">新建角色</n-button>
      </n-space>
    </n-space>

    <n-data-table :columns="columns" :data="displayCharacters" :loading="loading" />

    <!-- 新建/编辑角色弹窗 -->
    <n-modal v-model:show="showModal" :title="isEdit ? '编辑角色' : '新建角色'" preset="card" style="width: 640px">
      <n-form :model="form" label-placement="left" label-width="80">
        <n-form-item label="标识" required :disabled="isEdit">
          <n-input v-model:value="form.slug" placeholder="英文标识，如 linfan" :disabled="isEdit" />
        </n-form-item>
        <n-form-item label="姓名" required>
          <n-input v-model:value="form.name" placeholder="角色姓名" />
        </n-form-item>
        <n-form-item label="身份">
          <n-dynamic-tags v-model:value="form.identity" />
        </n-form-item>
        <n-form-item label="外貌">
          <n-dynamic-tags v-model:value="form.appearance" />
        </n-form-item>
        <n-form-item label="气质">
          <n-dynamic-tags v-model:value="form.temperament" />
        </n-form-item>
        <n-form-item label="性格">
          <n-dynamic-tags v-model:value="form.personality" />
        </n-form-item>
        <n-form-item label="说话风格">
          <n-dynamic-tags v-model:value="form.speechStyle" />
        </n-form-item>
        <n-form-item v-if="isEdit" label="版本">
          <n-select v-model:value="form.versionBranchId" :options="versions.versionBranchOptions" style="width: 180px" size="small" />
        </n-form-item>
        <n-form-item label="关系">
          <n-input v-model:value="relationshipsJson" type="textarea" :rows="3" placeholder='{"张三": "兄弟", "李四": "敌对"}' />
        </n-form-item>
        <n-form-item label="状态">
          <n-input v-model:value="statusJson" type="textarea" :rows="3" placeholder='{"realm": "筑基", "location": "青云宗"}' />
        </n-form-item>
      </n-form>
      <template #footer>
        <n-space justify="end">
          <n-button @click="showModal = false">取消</n-button>
          <n-button type="primary" @click="handleSubmit">{{ isEdit ? '保存' : '创建' }}</n-button>
        </n-space>
      </template>
    </n-modal>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, h, computed, watch } from 'vue'
import { useRoute } from 'vue-router'
import {
  NH1, NSpace, NButton, NSelect, NDataTable, NModal, NForm, NFormItem, NInput, NDynamicTags,
  type DataTableColumns
} from 'naive-ui'
import { charactersApi } from '../api/characters'
import { useVersionBranches } from '../composables/useVersionBranches'

const route = useRoute()
const versions = useVersionBranches(() => route.params.storyId as string | undefined)
const characters = ref<any[]>([])
const loading = ref(false)
const showModal = ref(false)
const isEdit = ref(false)
const editId = ref('')

const form = ref({
  slug: '',
  name: '',
  identity: [] as string[],
  appearance: [] as string[],
  temperament: [] as string[],
  personality: [] as string[],
  speechStyle: [] as string[],
  versionBranchId: '',
  relationships: {} as Record<string, any>,
  status: {} as Record<string, any>
})

const relationshipsJson = computed({
  get: () => JSON.stringify(form.value.relationships, null, 2),
  set: (v: string) => { try { form.value.relationships = JSON.parse(v) } catch {} }
})

const statusJson = computed({
  get: () => JSON.stringify(form.value.status, null, 2),
  set: (v: string) => { try { form.value.status = JSON.parse(v) } catch {} }
})

function formatTags(jsonStr: string): string {
  try {
    const arr = JSON.parse(jsonStr || '[]') as string[]
    return arr.join(', ')
  } catch {
    return ''
  }
}

function formatJson(jsonStr: string): string {
  try {
    const obj = JSON.parse(jsonStr || '{}')
    return Object.entries(obj).map(([k, v]) => `${k}:${v}`).join(', ')
  } catch {
    return ''
  }
}

// 按当前选中的版本合并角色数据和分支状态
const displayCharacters = computed(() => {
  return characters.value.map(c => {
    const bs = c.branchStates?.find((s: any) => s.versionBranchId === versions.selectedVersionBranchId)
    return {
      ...c,
      relationships: bs?.relationships || '{}',
      status: bs?.status || '{}'
    }
  })
})

const columns: DataTableColumns<any> = [
  { title: '标识', key: 'slug', width: 100 },
  { title: '姓名', key: 'name', width: 100 },
  { title: '身份', key: 'identity', ellipsis: { tooltip: true }, width: 120, render: (row) => formatTags(row.identity) },
  { title: '外貌', key: 'appearance', ellipsis: { tooltip: true }, width: 120, render: (row) => formatTags(row.appearance) },
  { title: '气质', key: 'temperament', ellipsis: { tooltip: true }, width: 120, render: (row) => formatTags(row.temperament) },
  { title: '性格', key: 'personality', ellipsis: { tooltip: true }, width: 120, render: (row) => formatTags(row.personality) },
  { title: '说话风格', key: 'speechStyle', ellipsis: { tooltip: true }, width: 120, render: (row) => formatTags(row.speechStyle) },
  { title: '关系', key: 'relationships', ellipsis: { tooltip: true }, width: 140, render: (row) => formatJson(row.relationships) },
  { title: '状态', key: 'status', ellipsis: { tooltip: true }, width: 140, render: (row) => formatJson(row.status) },
  {
    title: '操作',
    key: 'actions',
    width: 140,
    fixed: 'right',
    render(row) {
      return h(NSpace, null, {
        default: () => [
          h(NButton, { size: 'small', onClick: () => openEdit(row) }, { default: () => '编辑' }),
          h(NButton, { size: 'small', type: 'error', onClick: () => handleDelete(row.id) }, { default: () => '删除' })
        ]
      })
    }
  }
]

async function loadCharacters() {
  if (!route.params.storyId) {
    characters.value = []
    return
  }
  loading.value = true
  try {
    const res = await charactersApi.list(route.params.storyId as string)
    characters.value = res.data.data
  } finally {
    loading.value = false
  }
}

function resetForm() {
  form.value = {
    slug: '', name: '',
    identity: [], appearance: [], temperament: [],
    personality: [], speechStyle: [],
    versionBranchId: versions.selectedVersionBranchId,
    relationships: {}, status: {}
  }
}

function openCreate() {
  isEdit.value = false
  editId.value = ''
  resetForm()
  showModal.value = true
}

function openEdit(row: any) {
  isEdit.value = true
  editId.value = row.id
  const bs = row.branchStates?.find((s: any) => s.versionBranchId === versions.selectedVersionBranchId)
  form.value = {
    slug: row.slug,
    name: row.name,
    identity: JSON.parse(row.identity || '[]'),
    appearance: JSON.parse(row.appearance || '[]'),
    temperament: JSON.parse(row.temperament || '[]'),
    personality: JSON.parse(row.personality || '[]'),
    speechStyle: JSON.parse(row.speechStyle || '[]'),
    versionBranchId: versions.selectedVersionBranchId,
    relationships: JSON.parse(bs?.relationships || '{}'),
    status: JSON.parse(bs?.status || '{}')
  }
  showModal.value = true
}

async function handleSubmit() {
  if (!route.params.storyId) return
  const data = {
    name: form.value.name,
    identity: form.value.identity,
    appearance: form.value.appearance,
    temperament: form.value.temperament,
    personality: form.value.personality,
    speechStyle: form.value.speechStyle,
    versionBranchId: form.value.versionBranchId,
    relationships: form.value.relationships,
    status: form.value.status
  }

  if (isEdit.value && editId.value) {
    await charactersApi.update(editId.value, data)
  } else {
    if (!form.value.slug || !form.value.name) return
    await charactersApi.create(route.params.storyId as string, {
      slug: form.value.slug,
      ...data
    })
  }

  showModal.value = false
  resetForm()
  await loadCharacters()
}

async function handleDelete(id: string) {
  await charactersApi.remove(id)
  await loadCharacters()
}

watch(() => route.params.storyId, () => {
  versions.loadVersionBranches().then(loadCharacters)
})

onMounted(() => {
  if (route.params.storyId) {
    versions.loadVersionBranches().then(loadCharacters)
  }
})
</script>
