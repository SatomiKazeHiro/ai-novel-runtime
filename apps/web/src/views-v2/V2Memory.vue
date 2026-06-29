<template>
  <div>
    <header class="page-head">
      <div class="page-head__text">
        <span class="cap-eyebrow is-accent">V2 · MEMORY</span>
        <h1 class="page-head__title">记忆管理</h1>
        <p class="page-head__lede cap-body-sm">global / chapter / scene / temporary — 四层记忆，按类型与分类筛选浏览。</p>
      </div>
      <div class="page-head__actions">
        <button v-if="activeType === 'temporary'" class="cap-pill is-primary" @click="openCreate">+ 添加临时记忆</button>
      </div>
    </header>

    <div class="cap-card" style="padding: 16px">
      <n-tabs v-model:value="activeType" type="segment" @update:value="loadMemories">
        <n-tab-pane v-for="t in typeOptions" :key="t.value" :name="t.value" :tab="t.label" />
      </n-tabs>

      <div style="margin: 12px 0; display: flex; gap: 12px; align-items: center">
        <n-select
          v-model:value="filterCategory"
          :options="categoryOptions"
          placeholder="按分类筛选"
          clearable
          style="width: 180px"
          @update:value="loadMemories"
        />
        <n-switch v-model:value="showInactive" @update:value="loadMemories">
          <template #checked>含已失效</template>
          <template #unchecked>仅活跃</template>
        </n-switch>
      </div>

      <n-data-table :columns="columns" :data="memories" :loading="loading" :bordered="false" />
    </div>

    <!-- 新增/编辑临时记忆弹窗 -->
    <n-modal v-model:show="showModal" :title="isEdit ? '编辑临时记忆' : '添加临时记忆'" preset="card" style="width: 560px">
      <n-form :model="form" label-placement="left" label-width="80">
        <n-form-item label="分类" required>
          <n-select v-model:value="form.category" :options="categoryOptions.slice(1)" placeholder="选择分类" />
        </n-form-item>
        <n-form-item label="内容" required>
          <n-input v-model:value="form.content" type="textarea" :rows="4" placeholder="记忆内容" />
        </n-form-item>
        <n-form-item label="参与者">
          <n-input v-model:value="form.participants" placeholder="可选，逗号分隔，如：张三,李四" />
        </n-form-item>
        <n-form-item label="重要度">
          <n-slider v-model:value="form.importance" :min="0" :max="10" :step="1" />
          <span style="margin-left: 12px; font-weight: var(--weight-semibold); color: var(--color-ink-black)">{{ form.importance }}</span>
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
import { useRoute } from 'vue-router'
import {
  NSpace, NButton, NSelect, NSwitch, NTabs, NTabPane, NDataTable,
  NModal, NForm, NFormItem, NInput, NSlider, NTag,
  type DataTableColumns
} from 'naive-ui'
import { v2MemoriesApi, type V2TemporaryMemoryCreate, type V2TemporaryMemoryUpdate } from '../api-v2/memories'

const categoryLabels: Record<string, string> = {
  relationship_change: '关系变化',
  foreshadowing: '可能的伏笔',
  emotional_change: '情绪情感变化',
  event_memory: '事件记忆'
}

const route = useRoute()
const memories = ref<any[]>([])
const loading = ref(false)
const activeType = ref('all')
const filterCategory = ref<string | null>(null)
const showInactive = ref(false)
const showModal = ref(false)
const isEdit = ref(false)
const editId = ref('')

const form = ref({
  category: 'event_memory',
  content: '',
  importance: 4,
  participants: ''
})

const typeOptions = [
  { value: 'all', label: '全部' },
  { value: 'global', label: '全局记忆' },
  { value: 'chapter', label: '章节记忆' },
  { value: 'scene', label: '场景记忆' },
  { value: 'temporary', label: '临时记忆' }
]

const categoryOptions = [
  { value: '', label: '全部分类', disabled: true },
  { value: 'relationship_change', label: '关系变化' },
  { value: 'foreshadowing', label: '可能的伏笔' },
  { value: 'emotional_change', label: '情绪情感变化' },
  { value: 'event_memory', label: '事件记忆' }
]

const columns: DataTableColumns<any> = [
  {
    title: '分类', key: 'category', width: 110,
    render: (row) => categoryLabels[row.category] || row.category
  },
  { title: '内容', key: 'content', ellipsis: { tooltip: true }, minWidth: 220 },
  {
    title: '重要度', key: 'importance', width: 80, align: 'center',
    render: (row) => h('span', {
      style: {
        fontWeight: 'var(--weight-semibold)',
        color: row.importance >= 7 ? 'var(--color-protagonist)' : 'var(--color-ink-black)'
      }
    }, row.importance)
  },
  {
    title: '参与者', key: 'participants', width: 120, ellipsis: { tooltip: true },
    render: (row) => row.participants || '-'
  },
  {
    title: '来源章节', key: 'originChapterNumber', width: 90,
    render: (row) => row.originChapterNumber ? `第${row.originChapterNumber}章` : '-'
  },
  {
    title: '状态', key: 'isActive', width: 70, align: 'center',
    render: (row) => row.isActive
      ? h(NTag, { size: 'small', type: 'success', bordered: false }, { default: () => '活跃' })
      : h(NTag, { size: 'small', type: 'default', bordered: false }, { default: () => '失效' })
  },
  { title: '创建时间', key: 'createdAt', width: 170 },
  {
    title: '操作', key: 'actions', width: 120, fixed: 'right',
    render(row) {
      if (row.type !== 'temporary') return ''
      return h(NSpace, null, {
        default: () => [
          h(NButton, { size: 'small', onClick: () => openEdit(row) }, { default: () => '编辑' }),
          h(NButton, { size: 'small', type: 'error', onClick: () => handleDelete(row.id) }, { default: () => '删除' })
        ]
      })
    }
  }
]

async function loadMemories() {
  const sid = route.params.storyId as string
  if (!sid) {
    memories.value = []
    return
  }
  loading.value = true
  try {
    const res = await v2MemoriesApi.list({
      storyId: sid,
      type: activeType.value === 'all' ? undefined : activeType.value,
      category: filterCategory.value || undefined,
      isActive: showInactive.value ? undefined : true
    })
    memories.value = res.data.data ?? []
  } finally {
    loading.value = false
  }
}

function resetForm() {
  form.value = { category: 'event_memory', content: '', importance: 4, participants: '' }
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
    category: row.category,
    content: row.content,
    importance: row.importance,
    participants: row.participants || ''
  }
  showModal.value = true
}

async function handleSubmit() {
  const sid = route.params.storyId as string
  if (!sid || !form.value.content) return

  if (isEdit.value && editId.value) {
    const data: V2TemporaryMemoryUpdate = {
      category: form.value.category,
      content: form.value.content,
      importance: form.value.importance,
      participants: form.value.participants || undefined
    }
    await v2MemoriesApi.updateTemporary(editId.value, data)
  } else {
    const data: V2TemporaryMemoryCreate = {
      storyId: sid,
      category: form.value.category,
      content: form.value.content,
      importance: form.value.importance,
      participants: form.value.participants || undefined
    }
    await v2MemoriesApi.createTemporary(data)
  }

  showModal.value = false
  resetForm()
  await loadMemories()
}

async function handleDelete(id: string) {
  await v2MemoriesApi.removeTemporary(id)
  await loadMemories()
}

watch(() => route.params.storyId, () => { loadMemories() })
onMounted(() => { if (route.params.storyId) loadMemories() })
</script>
