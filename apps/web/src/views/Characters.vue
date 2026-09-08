<template>
  <div>
    <header class="page-head">
      <div class="page-head__text">
        <span class="cap-eyebrow is-accent">CHARACTERS</span>
        <h1 class="page-head__title">角色管理</h1>
        <p class="page-head__lede cap-body-sm">人物是叙事的载体 — 定义身份、性格、关系网。</p>
      </div>
      <div class="page-head__actions">
        <button class="cap-pill is-primary" @click="openCreate">+ 新建角色</button>
      </div>
    </header>

    <!-- 章节切换器 (v4: 三字段独立查快照) -->
    <div class="cap-card" style="margin-bottom: 12px; padding: 12px 16px">
      <n-space align="center" :wrap="false">
        <n-text depth="3">查看章节快照:</n-text>
        <n-select
          v-model:value="viewChapter"
          :options="chapterOptions"
          placeholder="最新有数据(默认)"
          clearable
          style="width: 280px"
        />
        <n-text v-if="viewChapter !== null" depth="3" style="font-size: 12px">
          切换后只显示该章节的快照数据,无字段则为 null
        </n-text>
      </n-space>
    </div>

    <div class="cap-card" style="padding: 0; overflow: hidden">
      <n-data-table :columns="columns" :data="characters" :loading="loading" :bordered="false" />
    </div>

    <!-- 新建/编辑角色弹窗 (v4: 不再编辑关系/状态,走 PUT append snapshot) -->
    <n-modal v-model:show="showModal" :title="isEdit ? '编辑角色' : '新建角色'" preset="card" style="width: 640px">
      <n-form :model="form" label-placement="left" label-width="80">
        <n-form-item label="标识" required :disabled="isEdit">
          <n-input v-model:value="form.slug" placeholder="英文标识，如 linfan" :disabled="isEdit" />
        </n-form-item>
        <n-form-item label="姓名" required>
          <n-input v-model:value="form.name" placeholder="角色姓名" />
        </n-form-item>
        <n-form-item label="主角">
          <n-checkbox v-model:checked="form.protagonist"></n-checkbox>
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
        <n-alert type="info" :show-icon="true" style="margin-top: 8px">
          关系 / 状态 / 衣着 字段由归档时 AI 抽取并落入快照,不在此处编辑。
          创建时可设置基础关系/状态;查看章节快照请使用上方章节切换器。
        </n-alert>
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
import { useRoute } from 'vue-router'
import {
  NSpace, NButton, NDataTable, NModal, NForm, NFormItem, NInput, NCheckbox,
  NText, NSelect, NAlert, NTag,
  type DataTableColumns
} from 'naive-ui'
import { charactersApi, type CharacterDisplayRow, type FieldDisplay } from '../api/characters'
import { chaptersApi } from '../api/chapters'
import DynamicTags from '../components/DynamicTags.vue'

const route = useRoute()
const characters = ref<CharacterDisplayRow[]>([])
const loading = ref(false)
const showModal = ref(false)
const isEdit = ref(false)
const editId = ref('')
const viewChapter = ref<number | null>(null)  // null = 默认(最新有数据)
const chapterOptions = ref<Array<{ label: string; value: number }>>([])

const form = ref({
  slug: '',
  name: '',
  protagonist: false,
  identity: [] as string[],
  appearance: [] as string[],
  temperament: [] as string[],
  personality: [] as string[],
  speechStyle: [] as string[]
  // 关系/状态 不再在此编辑;基础值走 POST,快照由归档流程写入
})

function formatTags(arr: string[]): string {
  if (!Array.isArray(arr)) return ''
  return arr.join(', ')
}

/** 格式化 Record<string, any> → "k:v, k:v" */
function formatObject(obj: Record<string, any> | null | undefined): string {
  if (!obj || typeof obj !== 'object') return '(无)'
  const entries = Object.entries(obj)
  if (entries.length === 0) return '(无)'
  return entries.map(([k, v]) => {
    if (typeof v === 'object' && v !== null) return `${k}: ${JSON.stringify(v)}`
    return `${k}: ${v}`
  }).join(', ')
}

/** 渲染快照字段:值 + 来源标签 */
function renderSnapshot(value: string | null, sourceChapter: number | null) {
  return h('div', null, [
    h('div', { style: 'word-break: break-word' }, value || '(无)'),
    sourceChapter !== null
      ? h(NTag, { size: 'tiny', type: 'info', style: 'margin-top: 4px' },
          { default: () => `来源: 第 ${sourceChapter} 章` })
      : h(NTag, { size: 'tiny', style: 'margin-top: 4px' },
          { default: () => '来源: 基础' })
  ])
}

function renderField(field: FieldDisplay<string> | null) {
  return renderSnapshot(field?.value ?? null, field?.sourceChapterNumber ?? null)
}

function renderJsonField(field: FieldDisplay<Record<string, any>> | null) {
  const formatted = formatObject(field?.value)
  return renderSnapshot(formatted, field?.sourceChapterNumber ?? null)
}

const columns: DataTableColumns<CharacterDisplayRow> = [
  { title: '标识', key: 'slug', width: 90 },
  { title: '姓名', key: 'name', width: 90 },
  { title: '主角', key: 'protagonist', width: 50, render: (row) => row.protagonist ? h('span', { style: 'color: var(--color-protagonist)' }, '★') : '' },
  { title: '身份', key: 'identity', ellipsis: { tooltip: true }, width: 120, render: (row) => formatTags(row.identity) },
  { title: '外貌', key: 'appearance', ellipsis: { tooltip: true }, width: 120, render: (row) => formatTags(row.appearance) },
  { title: '气质', key: 'temperament', ellipsis: { tooltip: true }, width: 120, render: (row) => formatTags(row.temperament) },
  { title: '性格', key: 'personality', ellipsis: { tooltip: true }, width: 120, render: (row) => formatTags(row.personality) },
  { title: '说话风格', key: 'speechStyle', ellipsis: { tooltip: true }, width: 120, render: (row) => formatTags(row.speechStyle) },
  {
    title: () => h('span', null, ['关系', h(NTag, { size: 'tiny', type: 'info', style: 'margin-left: 4px' }, { default: '快照' })]),
    key: 'relationships', width: 180,
    render: (row) => renderJsonField(row.relationships)
  },
  {
    title: () => h('span', null, ['状态', h(NTag, { size: 'tiny', type: 'info', style: 'margin-left: 4px' }, { default: '快照' })]),
    key: 'status', width: 180,
    render: (row) => renderJsonField(row.status)
  },
  {
    title: () => h('span', null, ['衣着', h(NTag, { size: 'tiny', type: 'info', style: 'margin-left: 4px' }, { default: '快照' })]),
    key: 'costume', width: 160,
    render: (row) => renderField(row.costume)
  },
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
    const res = await charactersApi.display(route.params.storyId as string, viewChapter.value)
    characters.value = res.data.data ?? []
  } finally {
    loading.value = false
  }
}

async function loadChapterOptions() {
  if (!route.params.storyId) return
  try {
    const res = await chaptersApi.list(route.params.storyId as string)
    chapterOptions.value = (res.data?.data ?? [])
      .filter((ch: any) => ch.status === 'archived')
      .map((ch: any) => ({ label: `第 ${ch.number} 章: ${ch.title || ''}`, value: ch.number }))
      .sort((a: { value: number }, b: { value: number }) => b.value - a.value)
  } catch {
    // 静默:章节列表失败不影响主表格
  }
}

function resetForm() {
  form.value = {
    slug: '', name: '', protagonist: false,
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

function openEdit(row: CharacterDisplayRow) {
  isEdit.value = true
  editId.value = row.id
  form.value = {
    slug: row.slug,
    name: row.name,
    protagonist: row.protagonist ?? false,
    identity: Array.isArray(row.identity) ? row.identity : [],
    appearance: Array.isArray(row.appearance) ? row.appearance : [],
    temperament: Array.isArray(row.temperament) ? row.temperament : [],
    personality: Array.isArray(row.personality) ? row.personality : [],
    speechStyle: Array.isArray(row.speechStyle) ? row.speechStyle : []
  }
  showModal.value = true
}

async function handleSubmit() {
  if (!route.params.storyId) return
  const data = {
    name: form.value.name,
    protagonist: form.value.protagonist,
    identity: form.value.identity,
    appearance: form.value.appearance,
    temperament: form.value.temperament,
    personality: form.value.personality,
    speechStyle: form.value.speechStyle
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

watch(viewChapter, () => {
  loadCharacters()
})

watch(() => route.params.storyId, () => {
  loadCharacters()
  loadChapterOptions()
})

onMounted(() => {
  if (route.params.storyId) {
    loadCharacters()
    loadChapterOptions()
  }
})
</script>
