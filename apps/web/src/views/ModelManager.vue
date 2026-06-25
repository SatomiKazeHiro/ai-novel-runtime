<template>
  <div>
    <header class="page-head">
      <div class="page-head__text">
        <span class="cap-eyebrow is-accent">MODELS</span>
        <h1 class="page-head__title">模型管理</h1>
        <p class="page-head__lede cap-body-sm">配置 AI Provider、API Key、模型参数。运行时热切换，全局默认与故事级覆盖。</p>
      </div>
      <div class="page-head__actions">
        <button class="cap-pill is-primary" @click="openCreate">+ 添加模型</button>
      </div>
    </header>

    <div class="cap-card" style="padding: 0; overflow: hidden">
      <n-data-table :columns="columns" :data="configs" :loading="loading" :bordered="false" />
    </div>

    <n-modal v-model:show="showModal" :title="editingId ? '编辑模型' : '添加模型'" preset="card" style="width: 560px">
      <n-form :model="form" label-placement="left" label-width="120">
        <n-form-item label="模型商" required>
          <n-select v-model:value="form.name" :options="providerOptions" placeholder="选择模型商" @update:value="onProviderChange" />
        </n-form-item>
        <n-form-item label="模型名称" required>
          <n-input v-model:value="form.model" placeholder="如 deepseek-chat" />
        </n-form-item>
        <n-form-item label="API Key">
          <n-input v-model:value="form.apiKey" type="password" show-password-on="click" placeholder="留空表示不修改（编辑时）" />
        </n-form-item>
        <n-form-item label="Base URL">
          <n-input v-model:value="form.baseUrl" placeholder="留空使用默认值" />
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
        <n-form-item label="备注/说明">
          <n-input v-model:value="form.remarks" type="textarea" :rows="2" placeholder="如：用于生成章节，余额充足" />
        </n-form-item>
        <n-form-item label="设为默认">
          <n-switch v-model:value="form.isDefault" />
        </n-form-item>
      </n-form>
      <template #footer>
        <n-space justify="end">
          <n-button :loading="testing" @click="handleTest">检测连通性</n-button>
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
  NSpace, NButton, NDataTable, NModal, NForm, NFormItem,
  NInput, NInputNumber, NSelect, NSwitch, NSlider, NTag,
  useMessage, type DataTableColumns
} from 'naive-ui'
import { aiProviderApi } from '../api/ai-provider'

interface AiProviderConfig {
  id: string
  type: string
  name: string
  apiKey: string | null
  baseUrl: string | null
  model: string
  contextLength: number
  maxTokens: number
  temperature: number
  isDefault: boolean
  remarks: string | null
}

const loading = ref(false)
const configs = ref<AiProviderConfig[]>([])
const showModal = ref(false)
const editingId = ref<string | null>(null)
const form = ref({
  name: 'deepseek',
  model: 'deepseek-chat',
  apiKey: '',
  baseUrl: '',
  contextLength: 64000,
  maxTokens: 4096,
  temperature: 0.7,
  remarks: '',
  isDefault: false
})

const message = useMessage()
const testing = ref(false)

const providerOptions = [
  { label: 'DeepSeek', value: 'deepseek' },
  { label: 'OpenAI', value: 'openai' },
  { label: 'OpenRouter', value: 'openrouter' },
  { label: 'Moonshot (Kimi)', value: 'moonshot' },
  { label: 'SiliconFlow', value: 'siliconflow' }
]

const defaultProviderConfigs: Record<string, { model: string; baseUrl: string; contextLength: number }> = {
  deepseek: { model: 'deepseek-chat', baseUrl: 'https://api.deepseek.com', contextLength: 64000 },
  openai: { model: 'gpt-4o', baseUrl: 'https://api.openai.com', contextLength: 128000 },
  openrouter: { model: 'anthropic/claude-3.5-sonnet', baseUrl: 'https://openrouter.ai/api', contextLength: 200000 },
  moonshot: { model: 'moonshot-v1-8k', baseUrl: 'https://api.moonshot.cn', contextLength: 8000 },
  siliconflow: { model: 'deepseek-ai/DeepSeek-V3', baseUrl: 'https://api.siliconflow.cn', contextLength: 64000 }
}

function onProviderChange(value: string) {
  const defaults = defaultProviderConfigs[value]
  if (defaults && !editingId.value) {
    form.value.model = defaults.model
    form.value.baseUrl = defaults.baseUrl
    form.value.contextLength = defaults.contextLength
  }
}

function maskKey(key: string | null): string {
  if (!key) return '-'
  if (key.length <= 8) return '****'
  return key.slice(0, 4) + '****' + key.slice(-4)
}

const columns: DataTableColumns<AiProviderConfig> = [
  {
    title: '类型', key: 'type', width: 100, render(row) {
      return row.type === 'system'
        ? h(NTag, { type: 'warning', size: 'small' }, { default: () => '系统默认' })
        : h(NTag, { type: 'default', size: 'small' }, { default: () => '自定义' })
    }
  },
  { title: '模型商', key: 'name', width: 120 },
  { title: '模型', key: 'model', width: 160 },
  { title: 'API Key', key: 'apiKey', width: 120, render(row) {
    return h(NTag, { size: 'small', type: 'default' }, { default: () => maskKey(row.apiKey) })
  }},
  { title: '上下文长度', key: 'contextLength', width: 120 },
  { title: '最大输出', key: 'maxTokens', width: 96 },
  { title: '温度', key: 'temperature', width: 60 },
  { title: '备注', key: 'remarks', width: 120, ellipsis: { tooltip: true } },
  { title: '默认', key: 'isDefault', width: 80, render(row) {
    return row.isDefault ? h(NTag, { type: 'success', size: 'small' }, { default: () => '是' }) : '-'
  }},
  {
    title: '操作',
    key: 'actions',
    width: 160,
    render(row) {
      if (row.type === 'system') {
        return h(NTag, { size: 'small', type: 'info' }, { default: () => '来自 .env' })
      }
      return h(NSpace, null, {
        default: () => [
          h(NButton, { size: 'small', onClick: () => startEdit(row) }, { default: () => '编辑' }),
          h(NButton, { size: 'small', type: 'error', onClick: () => handleDelete(row.id) }, { default: () => '删除' }),
          !row.isDefault
            ? h(NButton, { size: 'small', type: 'primary', onClick: () => setDefault(row.id) }, { default: () => '设为默认' })
            : null
        ].filter(Boolean)
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
    baseUrl: '',
    contextLength: 64000,
    maxTokens: 4096,
    temperature: 0.7,
    remarks: '',
    isDefault: false
  }
  showModal.value = true
}

function startEdit(row: AiProviderConfig) {
  editingId.value = row.id
  form.value = {
    name: row.name,
    model: row.model,
    apiKey: row.apiKey || '',
    baseUrl: row.baseUrl || '',
    contextLength: row.contextLength,
    maxTokens: row.maxTokens,
    temperature: row.temperature,
    remarks: row.remarks || '',
    isDefault: row.isDefault
  }
  showModal.value = true
}

async function handleTest() {
  if (!form.value.name || !form.value.model) {
    message.error('请先填写模型商和模型名称')
    return
  }
  testing.value = true
  try {
    const res = await aiProviderApi.test({
      name: form.value.name,
      apiKey: form.value.apiKey || undefined,
      baseUrl: form.value.baseUrl || undefined,
      model: form.value.model,
      id: editingId.value || undefined
    })
    const result = res.data
    if (result.success) {
      message.success(result.message)
    } else {
      message.error(result.message)
    }
  } catch (err: any) {
    message.error(err.response?.data?.error || err.message || '检测失败')
  } finally {
    testing.value = false
  }
}

async function handleSave() {
  const payload = {
    name: form.value.name,
    model: form.value.model,
    apiKey: form.value.apiKey || undefined,
    baseUrl: form.value.baseUrl || undefined,
    contextLength: form.value.contextLength,
    maxTokens: form.value.maxTokens,
    temperature: form.value.temperature,
    remarks: form.value.remarks || undefined,
    isDefault: form.value.isDefault
  }
  if (editingId.value) {
    await aiProviderApi.update(editingId.value, payload)
  } else {
    await aiProviderApi.create(payload)
  }
  showModal.value = false
  editingId.value = null
  await loadConfigs()
}

async function handleDelete(id: string) {
  await aiProviderApi.remove(id)
  await loadConfigs()
}

async function setDefault(id: string) {
  await aiProviderApi.setDefault(id)
  await loadConfigs()
}

onMounted(loadConfigs)
</script>
