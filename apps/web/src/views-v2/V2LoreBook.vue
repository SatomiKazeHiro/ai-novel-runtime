<template>
  <div>
    <header class="page-head">
      <div class="page-head__text">
        <span class="cap-eyebrow is-accent">V2 · WORLDBUILDING</span>
        <h1 class="page-head__title">世界观</h1>
        <p class="page-head__lede cap-body-sm">地理、势力、典故、术语 — 一致性的基石。</p>
      </div>
      <div class="page-head__actions">
        <button class="cap-pill is-primary" @click="openCreate">+ 新建条目</button>
      </div>
    </header>

    <div class="cap-card" style="padding: 16px">
      <n-tabs v-model:value="activeCategory" type="segment" @update:value="loadLore">
        <n-tab-pane v-for="cat in categories" :key="cat.value" :name="cat.value" :tab="cat.label" />
      </n-tabs>
      <div style="margin-top: 16px">
        <n-data-table :columns="columns" :data="loreItems" :loading="loading" :bordered="false" />
      </div>
    </div>

    <n-modal v-model:show="showModal" :title="isEdit ? '编辑世界观条目' : '新建世界观条目'" preset="card" style="width: 600px">
      <n-form :model="form" label-placement="left" label-width="80">
        <n-form-item label="分类" required>
          <n-select v-model:value="form.category" :options="categories" placeholder="选择分类" :disabled="isEdit" />
        </n-form-item>
        <n-form-item label="标识" required>
          <n-input v-model:value="form.slug" placeholder="英文标识" :disabled="isEdit" />
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
  NSpace, NButton, NDataTable, NModal, NForm, NFormItem, NInput, NSelect, NTabs, NTabPane,
  useDialog, type DataTableColumns
} from 'naive-ui'
import { v2LoreApi } from '../api-v2/lore'

const categories = [
  { value: 'rank', label: '等级' },
  { value: 'map', label: '地图' },
  { value: 'skill', label: '技能' },
  { value: 'faction', label: '势力' },
  { value: 'item', label: '物品' },
  { value: 'rule', label: '规则' }
]

const route = useRoute()
const dialog = useDialog()
const activeCategory = ref('rank')
const loreItems = ref<any[]>([])
const loading = ref(false)
const showModal = ref(false)
const isEdit = ref(false)
const editId = ref<string | null>(null)
const form = ref({ category: 'rank', slug: '', name: '', content: '' })

const columns: DataTableColumns<any> = [
  { title: '标识', key: 'slug', width: 120 },
  { title: '名称', key: 'name', width: 150 },
  { title: '内容', key: 'content', ellipsis: { tooltip: true } },
  {
    title: '操作',
    key: 'actions',
    width: 160,
    render(row) {
      return h(NSpace, null, {
        default: () => [
          h(NButton, { size: 'small', onClick: () => openEdit(row) }, { default: () => '编辑' }),
          h(NButton, { size: 'small', type: 'error', onClick: () => handleDelete(row) }, { default: () => '删除' })
        ]
      })
    }
  }
]

async function loadLore() {
  const sid = route.params.storyId as string
  if (!sid) {
    loreItems.value = []
    return
  }
  loading.value = true
  try {
    const res = await v2LoreApi.list(sid)
    // 后端返回所有分类，前端按当前选中分类过滤
    loreItems.value = (res.data.data || []).filter((item: any) => item.category === activeCategory.value)
  } finally {
    loading.value = false
  }
}

function openCreate() {
  isEdit.value = false
  editId.value = null
  form.value = { category: activeCategory.value, slug: '', name: '', content: '' }
  showModal.value = true
}

function openEdit(row: any) {
  isEdit.value = true
  editId.value = row.id
  form.value = {
    category: row.category,
    slug: row.slug,
    name: row.name,
    content: row.content || ''
  }
  showModal.value = true
}

async function handleSubmit() {
  const sid = route.params.storyId as string
  if (!sid || !form.value.slug || !form.value.name) return

  if (isEdit.value && editId.value) {
    await v2LoreApi.update(editId.value, { name: form.value.name, content: form.value.content })
  } else {
    await v2LoreApi.create({
      storyId: sid,
      category: form.value.category,
      slug: form.value.slug,
      name: form.value.name,
      content: form.value.content
    })
  }

  showModal.value = false
  isEdit.value = false
  editId.value = null
  form.value = { category: activeCategory.value, slug: '', name: '', content: '' }
  await loadLore()
}

function handleDelete(row: any) {
  dialog.warning({
    title: '确认删除',
    content: `确定要删除条目「${row.name}」吗？删除后不可恢复。`,
    positiveText: '删除',
    negativeText: '取消',
    positiveButtonProps: { type: 'error' },
    onPositiveClick: async () => {
      await v2LoreApi.remove(row.id)
      await loadLore()
    }
  })
}

watch(() => route.params.storyId, loadLore)

onMounted(() => {
  if (route.params.storyId) loadLore()
})
</script>
