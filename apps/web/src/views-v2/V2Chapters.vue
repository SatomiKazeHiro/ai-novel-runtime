<template>
  <div>
    <header class="page-head">
      <div class="page-head__text">
        <span class="cap-eyebrow is-accent">V2 · CHAPTERS</span>
        <h1 class="page-head__title">章节工作台</h1>
        <p class="page-head__lede cap-body-sm">管理章节生命周期：草稿 → 生成 → 分析 → 归档。</p>
      </div>
      <div class="page-head__actions">
        <button
          class="cap-pill is-primary"
          :disabled="hasPendingFirstChapter"
          :title="hasPendingFirstChapter ? '第 1 章正在创作中（草稿/分析中），请先归档或删除它' : ''"
          @click="openCreate"
        >+ 新建章节</button>
      </div>
    </header>

    <div class="cap-card" style="padding: 0; overflow: hidden">
      <n-data-table :columns="columns" :data="chapters" :loading="loading" :bordered="false" />
    </div>

    <!-- 新建章节弹窗 -->
    <n-modal v-model:show="showModal" :title="`新建第 ${nextNumber} 章`" preset="card" style="width: 480px">
      <n-form :model="form" label-placement="left" label-width="80">
        <n-form-item label="标题" required>
          <n-input v-model:value="form.title" placeholder="章节标题" />
        </n-form-item>
        <p class="cap-body-sm" style="margin: 0; color: var(--cap-text-muted, #999)">
          章节号 <strong>{{ nextNumber }}</strong> 由系统自动分配，无需手动指定。
        </p>
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
import { ref, computed, onMounted, h, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  NSpace, NButton, NDataTable, NModal, NForm, NFormItem, NInput, NTag, NPopconfirm,
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
const form = ref({ title: '' })

// 下一个章节号：主线 max+1，无章节=1
const nextNumber = computed(() => {
  if (chapters.value.length === 0) return 1
  return Math.floor(Math.max(...chapters.value.map(c => c.number))) + 1
})

// 第一章是否正在创作中（草稿/分析中）— 用于禁用右上角新建按钮
const hasPendingFirstChapter = computed(() =>
  chapters.value.some(c => c.number === 1 && c.status !== 'archived')
)

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
    title: '操作', key: 'actions', width: 200, fixed: 'right',
    render(row) {
      const btns: any[] = [
        h(NButton, { size: 'small', onClick: () => goDesign(row.id) }, { default: () => '设计' }),
      ]
      if (row.canDelete !== false) {
        btns.push(h(NPopconfirm, {
          onPositiveClick: () => handleDelete(row.id)
        }, {
          trigger: () => h(NButton, { size: 'small', type: 'error' }, { default: () => '删除' }),
          default: () => row.status === 'archived'
            ? '归档章节删除后将丢失所有关联数据（角色快照、记忆、时间线事件、剧情弧线草稿），不可恢复。确认删除？'
            : '确认删除该章节？'
        }))
      }
      if (row.status === 'archived') {
        btns.unshift(
          h(NButton, { size: 'small', type: 'primary', onClick: () => handleDevelop(row) }, { default: () => '发展' })
        )
      }
      return h(NSpace, null, { default: () => btns })
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
  form.value = { title: '' }
  showModal.value = true
}

async function handleCreate() {
  const sid = route.params.storyId as string
  if (!sid || !form.value.title.trim()) return
  const data: V2ChapterCreate = { storyId: sid, title: form.value.title.trim() }
  // number 不传 — 由后端 allocateNextNumber 统一分配
  await v2ChaptersApi.create(data)
  showModal.value = false
  await loadChapters()
}

async function handleDevelop(row: any) {
  const sid = route.params.storyId as string
  // 下一章节号由后端 allocateNextNumber 分配（主线 max+1，与此处期望一致）
  const res = await v2ChaptersApi.create({ storyId: sid, title: `第${Math.floor(row.number) + 1}章` })
  if (res.data.success) {
    goDesign(res.data.data.id)
  } else if ((res.data as any).error?.includes('已存在')) {
    // 章节号已存在，直接跳转到已有的章节设计页
    const all = await v2ChaptersApi.list(sid)
    const expected = Math.floor(row.number) + 1
    const existing = all.data.data?.find((c: any) => c.number === expected)
    if (existing) goDesign(existing.id)
  }
}

async function handleDelete(id: string) {
  await v2ChaptersApi.remove(id)
  await loadChapters()
}

watch(() => route.params.storyId, () => { loadChapters() })
onMounted(() => { if (route.params.storyId) loadChapters() })
</script>
