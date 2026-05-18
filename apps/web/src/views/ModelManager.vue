<template>
  <div>
    <n-space justify="space-between" align="center" style="margin-bottom: 16px">
      <n-h1>模型管理</n-h1>
      <n-button type="primary" @click="openCreate">添加模型</n-button>
    </n-space>

    <n-data-table :columns="columns" :data="configs" :loading="loading" />

    <n-modal v-model:show="showModal" :title="editingId ? '编辑模型' : '添加模型'" preset="card" style="width: 560px">
      <n-form :model="form" label-placement="left" label-width="120">
        <n-form-item label="模型商" required>
          <n-select v-model:value="form.name" :options="providerOptions" placeholder="选择模型商" />
        </n-form-item>
        <n-form-item label="模型名称" required>
          <n-input v-model:value="form.model" placeholder="如 deepseek-chat" />
        </n-form-item>
        <n-form-item label="API Key">
          <n-input v-model:value="form.apiKey" type="password" show-password-on="click" placeholder="留空表示不修改（编辑时）" />
        </n-form-item>
        <n-form-item label="Base URL">
          <n-input v-model:value="form.baseUrl" placeholder="如 https://api.deepseek.com" />
        </n-form-item>
        <n-form-item label="上下文长度">
          <n-input-number v-model:value="form.contextLength" :min="1024" :max="200000" :step="1024" style="width: 100%" />
        </n-form-item>
        <n-form-item label="最大输出长度">
          <n-input-number v-model:value="form.maxTokens" :min="256" :max="32768" :step="256" style="width: 100%" />
        </n-form-item>
        <n-form-item label="温度">
          <n-slider v-model:value="form.temperature" :min="0" :max="2" :step="0.05" :marks="{ 0: '0', 1: '1', 2: '2' }" />
        </n-form-item>
        <n-form-item label="设为默认">
          <n-switch v-model:value="form.isDefault" />
        </n-form-item>
      </n-form>
      <template #footer>
        <n-space justify="end">
          <n-button @click="showModal = false">取消</n-button>
          <n-button type="primary" @click="handleSave">保存</n-button>
        </n-space>
      </template>
    </n-modal>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, h } from 'vue'
import {
  NH1, NSpace, NButton, NDataTable, NModal, NForm, NFormItem,
  NInput, NInputNumber, NSelect, NSwitch, NSlider, NTag,
  type DataTableColumns
} from 'naive-ui'
import { aiProviderApi } from '../api/ai-provider'

interface AiProviderConfig {
  id: string
  name: string
  apiKey: string | null
  baseUrl: string | null
  model: string
  contextLength: number
  maxTokens: number
  temperature: number
  isDefault: boolean
}

const loading = ref(false)
const configs = ref<AiProviderConfig[]>([])
const showModal = ref(false)
const editingId = ref<string | null>(null)
const form = ref({
  name: 'deepseek',
  model: 'deepseek-chat',
  apiKey: '',
  baseUrl: 'https://api.deepseek.com',
  contextLength: 64000,
  maxTokens: 4096,
  temperature: 0.7,
  isDefault: false
})

const providerOptions = [
  { label: 'DeepSeek', value: 'deepseek' }
]

function maskKey(key: string | null): string {
  if (!key) return '-'
  if (key.length <= 8) return '****'
  return key.slice(0, 4) + '****' + key.slice(-4)
}

const columns: DataTableColumns<AiProviderConfig> = [
  { title: '模型商', key: 'name', width: 120 },
  { title: '模型', key: 'model', width: 160 },
  { title: 'API Key', key: 'apiKey', width: 160, render(row) {
    return h(NTag, { size: 'small', type: 'default' }, { default: () => maskKey(row.apiKey) })
  }},
  { title: '上下文长度', key: 'contextLength', width: 120 },
  { title: '最大输出', key: 'maxTokens', width: 100 },
  { title: '温度', key: 'temperature', width: 80 },
  { title: '默认', key: 'isDefault', width: 80, render(row) {
    return row.isDefault ? h(NTag, { type: 'success', size: 'small' }, { default: () => '是' }) : '-'
  }},
  {
    title: '操作',
    key: 'actions',
    width: 240,
    render(row) {
      return h(NSpace, { size: 'small' }, {
        default: () => [
          !row.isDefault
            ? h(NButton, { size: 'tiny', type: 'primary', onClick: () => handleSetDefault(row.id) }, { default: () => '设为默认' })
            : null,
          h(NButton, { size: 'tiny', onClick: () => startEdit(row) }, { default: () => '编辑' }),
          h(NButton, { size: 'tiny', type: 'error', onClick: () => handleDelete(row.id) }, { default: () => '删除' })
        ]
      })
    }
  }
]

async function loadConfigs() {
  loading.value = true
  try {
    const res = await aiProviderApi.list()
    configs.value = res.data.data
  } finally {
    loading.value = false
  }
}

function openCreate() {
  editingId.value = null
  form.value = {
    name: 'deepseek',
    model: 'deepseek-chat',
    apiKey: '',
    baseUrl: 'https://api.deepseek.com',
    contextLength: 64000,
    maxTokens: 4096,
    temperature: 0.7,
    isDefault: false
  }
  showModal.value = true
}

function startEdit(row: AiProviderConfig) {
  editingId.value = row.id
  form.value = {
    name: row.name,
    model: row.model,
    apiKey: '',
    baseUrl: row.baseUrl || '',
    contextLength: row.contextLength,
    maxTokens: row.maxTokens,
    temperature: row.temperature,
    isDefault: row.isDefault
  }
  showModal.value = true
}

async function handleSave() {
  const payload: any = {
    name: form.value.name,
    model: form.value.model,
    baseUrl: form.value.baseUrl || null,
    contextLength: form.value.contextLength,
    maxTokens: form.value.maxTokens,
    temperature: form.value.temperature,
    isDefault: form.value.isDefault
  }
  if (form.value.apiKey) {
    payload.apiKey = form.value.apiKey
  }

  if (editingId.value) {
    await aiProviderApi.update(editingId.value, payload)
  } else {
    await aiProviderApi.create(payload)
  }
  showModal.value = false
  await loadConfigs()
}

async function handleSetDefault(id: string) {
  await aiProviderApi.setDefault(id)
  await loadConfigs()
}

async function handleDelete(id: string) {
  await aiProviderApi.remove(id)
  await loadConfigs()
}

onMounted(loadConfigs)
</script>
