<template>
  <div>
    <header class="page-head">
      <div class="page-head__text">
        <span class="cap-eyebrow">MEMORY</span>
        <h1 class="page-head__title">记忆管理</h1>
        <p class="page-head__lede cap-body-sm">global / chapter / scene / temporary — 四层记忆自动装配到 prompt。</p>
      </div>
      <div class="page-head__actions">
        <button class="cap-pill is-primary" @click="showModal = true">+ 添加记忆</button>
      </div>
    </header>

    <div class="cap-card" style="padding: 16px">
      <n-tabs v-model:value="activeLayer" type="segment" @update:value="loadMemory">
        <n-tab-pane v-for="layer in layerOptions" :key="layer.value" :name="layer.value" :tab="layer.label" />
      </n-tabs>
      <div style="margin-top: 16px">
        <n-data-table :columns="columns" :data="memories" :loading="loading" :bordered="false" />
      </div>
    </div>

    <n-modal v-model:show="showModal" title="添加记忆" preset="card" style="width: 500px">
      <n-form :model="form" label-placement="left" label-width="80">
        <n-form-item label="层级" required>
          <n-select v-model:value="form.layer" :options="layerOptions" />
        </n-form-item>
        <n-form-item label="内容" required>
          <n-input v-model:value="form.content" type="textarea" :rows="4" placeholder="记忆内容" />
        </n-form-item>
        <n-form-item label="重要度">
          <n-slider v-model:value="form.importance" :min="1" :max="10" />
        </n-form-item>
        <n-form-item label="分类">
          <n-select v-model:value="form.category" :options="categoryOptions" clearable placeholder="默认事件" />
        </n-form-item>
        <n-form-item label="参与者">
          <n-input v-model:value="form.participants" placeholder="逗号分隔的参与者姓名，可留空" />
        </n-form-item>
        <n-form-item v-if="form.layer === 'temporary'" label="关联章节">
          <n-select
            v-model:value="form.chapterId"
            :options="chapters.map(c => ({ label: `第${c.number}章 ${c.title || ''}`, value: c.id }))"
            placeholder="选择生效章节（临时记忆只在该章生成时注入）"
            clearable
          />
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
import { ref, onMounted, watch } from 'vue'
import { useRoute } from 'vue-router'
import { NSpace, NButton, NSelect, NTabs, NTabPane, NDataTable, NModal, NForm, NFormItem, NInput, NSlider } from 'naive-ui'
import { memoryApi } from '../api/memory'
import { chaptersApi } from '../api/chapters'

const layerOptions = [
  { value: 'global', label: '全局记忆' },
  { value: 'chapter', label: '章节记忆' },
  { value: 'scene', label: '场景记忆' },
  { value: 'temporary', label: '临时记忆' }
]

const categoryOptions = [
  { value: 'event_memory', label: '事件' },
  { value: 'state', label: '状态' },
  { value: 'relationship_change', label: '关系变化' },
  { value: 'foreshadowing', label: '伏笔' },
  { value: 'emotional_change', label: '情绪变化' }
]

const route = useRoute()
const activeLayer = ref('global')
const memories = ref<any[]>([])
const loading = ref(false)
const showModal = ref(false)
const form = ref({ layer: 'global', content: '', importance: 5, chapterId: '', category: '', participants: '' })
const chapters = ref<any[]>([])

function categoryLabel(category: string): string {
  return {
    relationship_change: '关系变化', foreshadowing: '伏笔',
    emotional_change: '情绪变化', event_memory: '事件', state: '状态'
  }[category] ?? category
}

const columns = [
  { title: '层级', key: 'layer', width: 90 },
  {
    title: '章节',
    key: 'chapter',
    width: 140,
    render(row: any) {
      if (!row.chapterNumber && !row.chapterTitle) return '-'
      const num = row.chapterNumber !== undefined ? `第${row.chapterNumber}章` : ''
      const title = row.chapterTitle || ''
      return title ? `${num} · ${title}` : num
    }
  },
  { title: '内容', key: 'content', ellipsis: { tooltip: true } },
  { title: '分类', key: 'category', width: 100, render(row: any) { return categoryLabel(row.category) } },
  { title: '参与者', key: 'participants', width: 120 },
  { title: '重要度', key: 'importance', width: 80 },
  { title: '创建时间', key: 'createdAt', width: 170 }
]

async function loadMemory() {
  if (!route.params.storyId) {
    memories.value = []
    return
  }
  loading.value = true
  try {
    const res = await memoryApi.list(route.params.storyId as string, activeLayer.value)
    memories.value = res.data.data
  } finally {
    loading.value = false
  }
}

async function handleCreate() {
  if (!route.params.storyId || !form.value.content) return
  await memoryApi.create(route.params.storyId as string, { ...form.value })
  showModal.value = false
  form.value = { layer: activeLayer.value, content: '', importance: 5, chapterId: '', category: '', participants: '' }
  await loadMemory()
}

watch(() => route.params.storyId, () => {
  loadMemory()
})

onMounted(async () => {
  if (route.params.storyId) {
    loadMemory()
    try {
      const res = await chaptersApi.list(route.params.storyId as string)
      chapters.value = res.data?.data ?? []
    } catch { /* 静默 */ }
  }
})
</script>
