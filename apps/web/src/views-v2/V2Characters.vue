<template>
  <div>
    <header class="page-head">
      <div class="page-head__text">
        <span class="cap-eyebrow is-accent">V2 · CHARACTERS</span>
        <h1 class="page-head__title">角色管理</h1>
        <p class="page-head__lede cap-body-sm">管理角色初始设定，查看各章节快照变化。</p>
      </div>
      <div class="page-head__actions">
        <button class="cap-pill is-primary" @click="openCreate">+ 新建角色</button>
      </div>
    </header>

    <div class="cap-card" style="padding: 0; overflow: hidden">
      <n-data-table :columns="columns" :data="characters" :loading="loading" :bordered="false" />
    </div>

    <!-- 新建/编辑角色弹窗 -->
    <n-modal v-model:show="showModal" :title="isEdit ? '编辑角色' : '新建角色'" preset="card" style="width: 640px">
      <n-form :model="form" label-placement="left" label-width="80">
        <n-form-item label="标识" required>
          <n-input v-model:value="form.slug" placeholder="英文标识，如 linfan" :disabled="isEdit" />
        </n-form-item>
        <n-form-item label="姓名" required>
          <n-input v-model:value="form.name" placeholder="角色姓名" />
        </n-form-item>
        <n-form-item label="主角">
          <n-checkbox v-model:checked="form.isProtagonist" />
        </n-form-item>
        <n-form-item label="身份">
          <DynamicTags v-model="form.identity" />
        </n-form-item>
        <n-form-item label="外貌">
          <DynamicTags v-model="form.appearance" />
        </n-form-item>
        <n-form-item label="气质">
          <DynamicTags v-model="form.temperament" />
        </n-form-item>
        <n-form-item label="性格">
          <DynamicTags v-model="form.personality" />
        </n-form-item>
        <n-form-item label="说话风格">
          <DynamicTags v-model="form.speechStyle" />
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
import { ref, onMounted, h, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  NSpace, NButton, NDataTable, NModal, NForm, NFormItem, NInput, NCheckbox,
  type DataTableColumns
} from 'naive-ui'
import { v2CharactersApi, type V2CharacterCreate, type V2CharacterUpdate } from '../api-v2/characters'
import { safeJsonParse } from '@novel-runtime/shared'
import DynamicTags from '../components/DynamicTags.vue'

const route = useRoute()
const router = useRouter()
const characters = ref<any[]>([])
const loading = ref(false)
const showModal = ref(false)
const isEdit = ref(false)
const editId = ref('')

const form = ref({
  slug: '',
  name: '',
  isProtagonist: false,
  identity: [] as string[],
  appearance: [] as string[],
  temperament: [] as string[],
  personality: [] as string[],
  speechStyle: [] as string[]
})

function formatTags(jsonStr: string): string {
  const arr = safeJsonParse<string[]>(jsonStr, [])
  return arr.join(', ')
}

const columns: DataTableColumns<any> = [
  { title: '标识', key: 'slug', width: 100 },
  { title: '姓名', key: 'name', width: 100 },
  {
    title: '主角', key: 'isProtagonist', width: 60,
    render: (row) => row.isProtagonist
      ? h('span', { style: 'color: var(--color-protagonist)' }, '★')
      : ''
  },
  { title: '身份', key: 'identity', ellipsis: { tooltip: true }, width: 120, render: (row) => formatTags(row.identity) },
  { title: '外貌', key: 'appearance', ellipsis: { tooltip: true }, width: 120, render: (row) => formatTags(row.appearance) },
  { title: '气质', key: 'temperament', ellipsis: { tooltip: true }, width: 120, render: (row) => formatTags(row.temperament) },
  { title: '性格', key: 'personality', ellipsis: { tooltip: true }, width: 120, render: (row) => formatTags(row.personality) },
  { title: '说话风格', key: 'speechStyle', ellipsis: { tooltip: true }, width: 120, render: (row) => formatTags(row.speechStyle) },
  {
    title: '操作',
    key: 'actions',
    width: 180,
    fixed: 'right',
    render(row) {
      return h(NSpace, null, {
        default: () => [
          h(NButton, { size: 'small', onClick: () => goDetail(row.id) }, { default: () => '查看' }),
          h(NButton, { size: 'small', onClick: () => openEdit(row) }, { default: () => '编辑' }),
          h(NButton, { size: 'small', type: 'error', onClick: () => handleDelete(row.id) }, { default: () => '删除' })
        ]
      })
    }
  }
]

function goDetail(charId: string) {
  const sid = route.params.storyId as string
  router.push(`/novel-design-v2/${sid}/characters/${charId}`)
}

async function loadCharacters() {
  const sid = route.params.storyId as string
  if (!sid) {
    characters.value = []
    return
  }
  loading.value = true
  try {
    const res = await v2CharactersApi.list(sid)
    characters.value = res.data.data ?? []
  } finally {
    loading.value = false
  }
}

function resetForm() {
  form.value = {
    slug: '', name: '', isProtagonist: false,
    identity: [], appearance: [], temperament: [],
    personality: [], speechStyle: []
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
  form.value = {
    slug: row.slug,
    name: row.name,
    isProtagonist: row.isProtagonist ?? false,
    identity: safeJsonParse<string[]>(row.identity, []),
    appearance: safeJsonParse<string[]>(row.appearance, []),
    temperament: safeJsonParse<string[]>(row.temperament, []),
    personality: safeJsonParse<string[]>(row.personality, []),
    speechStyle: safeJsonParse<string[]>(row.speechStyle, [])
  }
  showModal.value = true
}

async function handleSubmit() {
  const sid = route.params.storyId as string
  if (!sid) return

  if (isEdit.value && editId.value) {
    const data: V2CharacterUpdate = {
      name: form.value.name,
      isProtagonist: form.value.isProtagonist,
      identity: form.value.identity,
      appearance: form.value.appearance,
      temperament: form.value.temperament,
      personality: form.value.personality,
      speechStyle: form.value.speechStyle
    }
    await v2CharactersApi.update(editId.value, data)
  } else {
    if (!form.value.slug || !form.value.name) return
    const data: V2CharacterCreate = {
      storyId: sid,
      slug: form.value.slug,
      name: form.value.name,
      isProtagonist: form.value.isProtagonist,
      identity: form.value.identity,
      appearance: form.value.appearance,
      temperament: form.value.temperament,
      personality: form.value.personality,
      speechStyle: form.value.speechStyle
    }
    await v2CharactersApi.create(data)
  }

  showModal.value = false
  resetForm()
  await loadCharacters()
}

async function handleDelete(id: string) {
  await v2CharactersApi.remove(id)
  await loadCharacters()
}

watch(() => route.params.storyId, () => { loadCharacters() })
onMounted(() => { if (route.params.storyId) loadCharacters() })
</script>
