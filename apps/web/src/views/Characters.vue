<template>
  <div>
    <n-space justify="space-between" align="center" style="margin-bottom: 16px">
      <n-h1>角色管理</n-h1>
      <n-button type="primary" @click="showModal = true">新建角色</n-button>
    </n-space>

    <n-data-table :columns="columns" :data="characters" :loading="loading" />

    <n-modal v-model:show="showModal" title="新建角色" preset="card" style="width: 600px">
      <n-form :model="form" label-placement="left" label-width="80">
        <n-form-item label="标识" required>
          <n-input v-model:value="form.slug" placeholder="英文标识，如 linfan" />
        </n-form-item>
        <n-form-item label="姓名" required>
          <n-input v-model:value="form.name" placeholder="角色姓名" />
        </n-form-item>
        <n-form-item label="性格">
          <n-dynamic-tags v-model:value="form.personality" />
        </n-form-item>
        <n-form-item label="说话风格">
          <n-dynamic-tags v-model:value="form.speechStyle" />
        </n-form-item>
        <n-form-item label="状态">
          <n-input v-model:value="statusJson" type="textarea" placeholder='{"realm":"筑基","location":"青云宗"}' />
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
import { ref, onMounted, h, computed, watch } from 'vue'
import { useRoute } from 'vue-router'
import {
  NH1, NSpace, NButton, NDataTable, NModal, NForm, NFormItem, NInput, NDynamicTags,
  type DataTableColumns
} from 'naive-ui'
import { charactersApi } from '../api/characters'

const route = useRoute()
const characters = ref<any[]>([])
const loading = ref(false)
const showModal = ref(false)
const form = ref({ slug: '', name: '', personality: [] as string[], speechStyle: [] as string[], status: {} })
const statusJson = computed({
  get: () => JSON.stringify(form.value.status, null, 2),
  set: (v: string) => { try { form.value.status = JSON.parse(v) } catch {} }
})

const columns: DataTableColumns<any> = [
  { title: '标识', key: 'slug', width: 120 },
  { title: '姓名', key: 'name', width: 120 },
  { title: '性格', key: 'personality', ellipsis: { tooltip: true } },
  { title: '状态', key: 'status', ellipsis: { tooltip: true } },
  {
    title: '操作',
    key: 'actions',
    width: 100,
    render(row) {
      return h(NButton, { size: 'small', type: 'error', onClick: () => handleDelete(row.id) }, { default: () => '删除' })
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
    characters.value = res.data.data.map((c: any) => ({
      ...c,
      personality: JSON.parse(c.personality).join(', '),
      status: JSON.stringify(JSON.parse(c.status))
    }))
  } finally {
    loading.value = false
  }
}

async function handleCreate() {
  if (!route.params.storyId || !form.value.slug || !form.value.name) return
  await charactersApi.create(route.params.storyId as string, {
    slug: form.value.slug,
    name: form.value.name,
    personality: form.value.personality,
    speechStyle: form.value.speechStyle,
    status: form.value.status
  })
  showModal.value = false
  form.value = { slug: '', name: '', personality: [], speechStyle: [], status: {} }
  await loadCharacters()
}

async function handleDelete(id: string) {
  await charactersApi.remove(id)
  await loadCharacters()
}

watch(() => route.params.storyId, loadCharacters)

onMounted(() => {
  if (route.params.storyId) loadCharacters()
})
</script>
