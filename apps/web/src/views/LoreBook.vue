<template>
  <div>
    <n-space justify="space-between" align="center" style="margin-bottom: 16px">
      <n-h1>世界观管理</n-h1>
      <n-button type="primary" @click="showModal = true">新建条目</n-button>
    </n-space>

    <n-tabs v-model:value="activeCategory" type="segment" @update:value="loadLore">
      <n-tab-pane v-for="cat in categories" :key="cat.key" :name="cat.key" :tab="cat.label" />
    </n-tabs>

    <n-data-table :columns="columns" :data="loreItems" :loading="loading" style="margin-top: 16px" />

    <n-modal v-model:show="showModal" title="新建世界观条目" preset="card" style="width: 600px">
      <n-form :model="form" label-placement="left" label-width="80">
        <n-form-item label="分类" required>
          <n-select v-model:value="form.category" :options="categories" placeholder="选择分类" />
        </n-form-item>
        <n-form-item label="标识" required>
          <n-input v-model:value="form.slug" placeholder="英文标识" />
        </n-form-item>
        <n-form-item label="名称" required>
          <n-input v-model:value="form.name" placeholder="条目名称" />
        </n-form-item>
        <n-form-item label="内容">
          <n-input v-model:value="form.content" type="textarea" :rows="6" placeholder="详细内容" />
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
import { useRoute } from 'vue-router'
import {
  NH1, NSpace, NButton, NDataTable, NModal, NForm, NFormItem, NInput, NSelect, NTabs, NTabPane,
  type DataTableColumns
} from 'naive-ui'
import { loreApi } from '../api/lore'

const categories = [
  { key: 'realm', label: '境界' },
  { key: 'map', label: '地图' },
  { key: 'technique', label: '功法' },
  { key: 'faction', label: '势力' },
  { key: 'item', label: '物品' },
  { key: 'rule', label: '规则' }
]

const route = useRoute()
const activeCategory = ref('realm')
const loreItems = ref<any[]>([])
const loading = ref(false)
const showModal = ref(false)
const form = ref({ category: 'realm', slug: '', name: '', content: '' })

const columns: DataTableColumns<any> = [
  { title: '标识', key: 'slug', width: 120 },
  { title: '名称', key: 'name', width: 150 },
  { title: '内容', key: 'content', ellipsis: { tooltip: true } },
  {
    title: '操作',
    key: 'actions',
    width: 100,
    render(row) {
      return h(NButton, { size: 'small', type: 'error', onClick: () => handleDelete(row.id) }, { default: () => '删除' })
    }
  }
]

async function loadLore() {
  if (!route.params.storyId) {
    loreItems.value = []
    return
  }
  loading.value = true
  try {
    const res = await loreApi.list(route.params.storyId as string, activeCategory.value)
    loreItems.value = res.data.data
  } finally {
    loading.value = false
  }
}

async function handleCreate() {
  if (!route.params.storyId || !form.value.slug || !form.value.name) return
  await loreApi.create(route.params.storyId as string, form.value)
  showModal.value = false
  form.value = { category: activeCategory.value, slug: '', name: '', content: '' }
  await loadLore()
}

async function handleDelete(id: string) {
  await loreApi.remove(id)
  await loadLore()
}

watch(() => route.params.storyId, loadLore)

onMounted(() => {
  if (route.params.storyId) loadLore()
})
</script>
