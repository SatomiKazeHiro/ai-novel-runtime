<template>
  <div>
    <header class="page-head">
      <div class="page-head__text">
        <span class="cap-eyebrow is-accent">V2 · CHAPTERS</span>
        <h1 class="page-head__title">章节工作台</h1>
        <p class="page-head__lede cap-body-sm">管理章节生命周期：草稿 → 生成 → 分析 → 归档。</p>
      </div>
      <div class="page-head__actions">
        <button class="cap-pill is-primary" @click="openCreate">+ 新建章节</button>
      </div>
    </header>

    <div class="cap-card" style="padding: 0; overflow: hidden">
      <n-data-table :columns="columns" :data="chapters" :loading="loading" :bordered="false" />
    </div>

    <!-- 新建章节弹窗 -->
    <n-modal v-model:show="showModal" title="新建章节" preset="card" style="width: 480px">
      <n-form :model="form" label-placement="left" label-width="80">
        <n-form-item label="标题" required>
          <n-input v-model:value="form.title" placeholder="章节标题" />
        </n-form-item>
        <n-form-item label="章节号">
          <n-input-number v-model:value="form.number" :min="1" :step="1" placeholder="不填则自动编号" style="width: 100%" />
        </n-form-item>
      </n-form>
      <template #footer>
        <n-space justify="end">
          <n-button @click="showModal = false">取消</n-button>
          <n-button type="primary" @click="handleCreate">创建</n-button>
        </n-space>
      </template>
    </n-modal>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, h, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  NSpace, NButton, NDataTable, NModal, NForm, NFormItem, NInput, NInputNumber, NTag,
  type DataTableColumns
} from 'naive-ui'
import { v2ChaptersApi, type V2ChapterCreate } from '../api-v2/chapters'

const statusLabels: Record<string, string> = {
  draft: '草稿',
  generating: '生成中',
  analyzing: '分析中',
  archived: '已归档'
}
const statusTagTypes: Record<string, 'default' | 'warning' | 'info' | 'success'> = {
  draft: 'default',
  generating: 'warning',
  analyzing: 'info',
  archived: 'success'
}

const route = useRoute()
const router = useRouter()
const chapters = ref<any[]>([])
const loading = ref(false)
const showModal = ref(false)
const form = ref({ title: '', number: undefined as number | undefined })

const columns: DataTableColumns<any> = [
  { title: '章节号', key: 'number', width: 80 },
  { title: '标题', key: 'title', ellipsis: { tooltip: true } },
  {
    title: '状态', key: 'status', width: 90,
    render: (row) => h(NTag, {
      size: 'small', type: statusTagTypes[row.status] || 'default', bordered: false
    }, { default: () => statusLabels[row.status] || row.status })
  },
  {
    title: '字数', key: 'content', width: 90, align: 'right',
    render: (row) => (row.content || '').length.toLocaleString()
  },
  { title: '更新时间', key: 'updatedAt', width: 170 },
  {
    title: '操作', key: 'actions', width: 140, fixed: 'right',
    render(row) {
      return h(NSpace, null, {
        default: () => [
          h(NButton, { size: 'small', onClick: () => goDesign(row.id) }, { default: () => '设计' }),
          h(NButton, { size: 'small', type: 'error', onClick: () => handleDelete(row.id) }, { default: () => '删除' })
        ]
      })
    }
  }
]

function goDesign(chapterId: string) {
  const sid = route.params.storyId as string
  router.push(`/novel-design-v2/${sid}/chapters/${chapterId}/design`)
}

async function loadChapters() {
  const sid = route.params.storyId as string
  if (!sid) { chapters.value = []; return }
  loading.value = true
  try {
    const res = await v2ChaptersApi.list(sid)
    chapters.value = res.data.data ?? []
  } finally { loading.value = false }
}

function openCreate() {
  form.value = { title: '', number: undefined }
  showModal.value = true
}

async function handleCreate() {
  const sid = route.params.storyId as string
  if (!sid || !form.value.title) return
  const data: V2ChapterCreate = { storyId: sid, title: form.value.title }
  if (form.value.number !== undefined) data.number = form.value.number
  await v2ChaptersApi.create(data)
  showModal.value = false
  await loadChapters()
}

async function handleDelete(id: string) {
  await v2ChaptersApi.remove(id)
  await loadChapters()
}

watch(() => route.params.storyId, () => { loadChapters() })
onMounted(() => { if (route.params.storyId) loadChapters() })
</script>
