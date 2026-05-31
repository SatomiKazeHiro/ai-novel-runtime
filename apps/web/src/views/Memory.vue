<template>
  <div>
    <n-space justify="space-between" align="center" style="margin-bottom: 16px">
      <n-h1>记忆管理</n-h1>
      <n-space>
        <n-select v-model:value="versions.selectedVersionBranchId" :options="versions.versionBranchOptions" style="width: 180px" size="small" placeholder="版本" @update:value="loadMemory" />
        <n-button type="primary" @click="showModal = true">添加记忆</n-button>
      </n-space>
    </n-space>

    <n-tabs v-model:value="activeLayer" type="segment" @update:value="loadMemory">
      <n-tab-pane v-for="layer in layerOptions" :key="layer.value" :name="layer.value" :tab="layer.label" />
    </n-tabs>

    <n-data-table :columns="columns" :data="memories" :loading="loading" style="margin-top: 16px" />

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
import { NH1, NSpace, NButton, NSelect, NTabs, NTabPane, NDataTable, NModal, NForm, NFormItem, NInput, NSlider } from 'naive-ui'
import { memoryApi } from '../api/memory'
import { useVersionBranches } from '../composables/useVersionBranches'

const layerOptions = [
  { value: 'global', label: '全局记忆' },
  { value: 'chapter', label: '章节记忆' },
  { value: 'scene', label: '场景记忆' },
  { value: 'temporary', label: '临时记忆' }
]

const route = useRoute()
const versions = useVersionBranches(() => route.params.storyId as string | undefined)
const activeLayer = ref('global')
const memories = ref<any[]>([])
const loading = ref(false)
const showModal = ref(false)
const form = ref({ layer: 'global', content: '', importance: 5, versionBranchId: '' })

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
    const res = await memoryApi.list(route.params.storyId as string, activeLayer.value, versions.selectedVersionBranchId)
    memories.value = res.data.data
  } finally {
    loading.value = false
  }
}

async function handleCreate() {
  if (!route.params.storyId || !form.value.content) return
  await memoryApi.create(route.params.storyId as string, { ...form.value, versionBranchId: versions.selectedVersionBranchId })
  showModal.value = false
  form.value = { layer: activeLayer.value, content: '', importance: 5, versionBranchId: versions.selectedVersionBranchId }
  await loadMemory()
}

watch(() => route.params.storyId, () => {
  versions.loadVersionBranches().then(loadMemory)
})

onMounted(() => {
  if (route.params.storyId) {
    versions.loadVersionBranches().then(loadMemory)
  }
})
</script>
