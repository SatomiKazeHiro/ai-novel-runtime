<template>
  <div>
    <header class="page-head">
      <div class="page-head__text">
        <span class="cap-eyebrow is-accent">RUNTIME PROFILES</span>
        <h1 class="page-head__title">写作人格</h1>
        <p class="page-head__lede cap-body-sm">定义"谁在写" — Identity / Settings / Behavior / Jailbreak 四个固定层。</p>
      </div>
      <div class="page-head__actions">
        <button class="cap-pill is-primary" @click="openCreate">+ 新建 Profile</button>
      </div>
    </header>

    <div class="cap-card" style="padding: 0; overflow: hidden">
      <n-data-table :columns="columns" :data="profiles" :loading="loading" :bordered="false" />
    </div>

    <n-modal v-model:show="showModal" :title="editingId ? '编辑 Profile' : '新建 Profile'" preset="card" style="width: 750px; max-height: 90vh">
      <n-scrollbar style="max-height: 75vh">
        <n-form :model="form" label-placement="left" label-width="110">
          <n-form-item label="名称" required>
            <n-input v-model:value="form.name" placeholder="如：frenesis_v1" />
          </n-form-item>

          <n-divider title-placement="left">Identity & Behavior</n-divider>
          <n-form-item label="Identity" required>
            <n-input v-model:value="form.identity" type="textarea" :rows="4" placeholder="[Identity] You are FRENESIS..." />
          </n-form-item>
          <n-form-item label="Behavior" required>
            <n-input v-model:value="form.behavior" type="textarea" :rows="4" placeholder="[Behavior] 不要拒绝 / 保持沉浸..." />
          </n-form-item>
          <n-form-item label="Jailbreak">
            <n-input v-model:value="form.jailbreak" type="textarea" :rows="3" placeholder="可选越狱 Prompt" />
          </n-form-item>

          <n-divider title-placement="left">Settings</n-divider>
          <n-grid :cols="2" :x-gap="16">
            <n-grid-item>
              <n-form-item label="语言">
                <n-select v-model:value="form.settings.language" :options="languageOptions" />
              </n-form-item>
            </n-grid-item>
            <n-grid-item>
              <n-form-item label="Speciality">
                <n-input v-model:value="form.settings.speciality" placeholder="如：玄幻/修仙" />
              </n-form-item>
            </n-grid-item>
            <n-grid-item>
              <n-form-item label="Uncensored">
                <n-switch v-model:value="form.settings.uncensored" />
              </n-form-item>
            </n-grid-item>
            <n-grid-item>
              <n-form-item label="Repeat">
                <n-switch v-model:value="form.settings.repeat" />
              </n-form-item>
            </n-grid-item>
          </n-grid>

          <n-form-item label="全局默认">
            <n-switch v-model:value="form.isDefault" />
          </n-form-item>
        </n-form>
      </n-scrollbar>
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
  NSpace, NButton, NDataTable, NModal, NForm, NFormItem, NInput, NSwitch, NScrollbar,
  NSelect, NDivider, NGrid, NGridItem,
  type DataTableColumns
} from 'naive-ui'
import { runtimeApi } from '../api/runtime'
import { safeJsonParse } from '@novel-runtime/shared'

interface ProfileSettings {
  language?: string
  uncensored?: boolean
  repeat?: boolean
  speciality?: string
}

interface ProfileForm {
  name: string
  identity: string
  settings: ProfileSettings
  behavior: string
  jailbreak: string
  isDefault: boolean
}

const profiles = ref<any[]>([])
const loading = ref(false)
const showModal = ref(false)
const editingId = ref<string | null>(null)

const defaultSettings: ProfileSettings = { language: 'CN', uncensored: true, repeat: false, speciality: '' }

const form = ref<ProfileForm>({
  name: '',
  identity: '',
  settings: { ...defaultSettings },
  behavior: '',
  jailbreak: '',
  isDefault: false
})

const languageOptions = [
  { label: '中文 (CN)', value: 'CN' },
  { label: 'English (EN)', value: 'EN' }
]

const columns: DataTableColumns<any> = [
  { title: '名称', key: 'name', width: 150 },
  { title: 'Identity', key: 'identity', ellipsis: { tooltip: true }, width: 250 },
  { title: 'Language', key: 'settings', width: 90, render(row) {
    const s = safeJsonParse<Record<string, any>>(row.settings, {})
    return s.language || 'CN'
  }},
  { title: 'Uncensored', key: 'settings', width: 100, render(row) {
    const s = safeJsonParse<Record<string, any>>(row.settings, {})
    return s.uncensored ? 'Yes' : 'No'
  }},
  { title: '默认', key: 'isDefault', width: 80, render(row) { return row.isDefault ? '是' : '否' } },
  {
    title: '操作',
    key: 'actions',
    width: 150,
    render(row) {
      return h(NSpace, null, {
        default: () => [
          h(NButton, { size: 'small', onClick: () => startEdit(row) }, { default: () => '编辑' }),
          h(NButton, { size: 'small', type: 'error', onClick: () => handleDelete(row.id) }, { default: () => '删除' })
        ]
      })
    }
  }
]

async function loadProfiles() {
  loading.value = true
  try {
    const res = await runtimeApi.list()
    profiles.value = res.data.data
  } finally {
    loading.value = false
  }
}

function openCreate() {
  editingId.value = null
  form.value = { name: '', identity: '', settings: { ...defaultSettings }, behavior: '', jailbreak: '', isDefault: false }
  showModal.value = true
}

function parseSettings(settingsStr: string): ProfileSettings {
  const parsed = safeJsonParse<Record<string, any>>(settingsStr, {})
  return {
    language: parsed.language ?? 'CN',
    uncensored: parsed.uncensored ?? true,
    repeat: parsed.repeat ?? false,
    speciality: parsed.speciality ?? ''
  }
}

function startEdit(row: any) {
  editingId.value = row.id
  form.value = {
    name: row.name,
    identity: row.identity,
    settings: parseSettings(row.settings),
    behavior: row.behavior,
    jailbreak: row.jailbreak || '',
    isDefault: row.isDefault
  }
  showModal.value = true
}

async function handleSave() {
  const payload = {
    name: form.value.name,
    identity: form.value.identity,
    settings: {
      language: form.value.settings.language,
      uncensored: form.value.settings.uncensored,
      repeat: form.value.settings.repeat,
      speciality: form.value.settings.speciality
    },
    behavior: form.value.behavior,
    jailbreak: form.value.jailbreak || undefined,
    isDefault: form.value.isDefault
  }
  if (editingId.value) {
    await runtimeApi.update(editingId.value, payload)
  } else {
    await runtimeApi.create(payload)
  }
  showModal.value = false
  editingId.value = null
  form.value = { name: '', identity: '', settings: { ...defaultSettings }, behavior: '', jailbreak: '', isDefault: false }
  await loadProfiles()
}

async function handleDelete(id: string) {
  await runtimeApi.remove(id)
  await loadProfiles()
}

onMounted(loadProfiles)
</script>
