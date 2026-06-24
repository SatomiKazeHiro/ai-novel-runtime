<template>
  <div>
    <header class="page-head">
      <div class="page-head__text">
        <span class="cap-eyebrow is-accent">STORIES</span>
        <h1 class="page-head__title">小说管理</h1>
        <p class="page-head__lede cap-body-sm">每个故事是一个独立的运行时沙盒，可关联写作人格与运行模型。</p>
      </div>
      <div class="page-head__actions">
        <button class="cap-pill is-primary" @click="openCreate">+ 新建小说</button>
      </div>
    </header>

    <!-- 工具栏：视图切换 + 封面过滤（仅在有数据时显示） -->
    <div v-if="stories.length" class="stories-toolbar">
      <n-radio-group v-model:value="viewMode" size="small">
        <n-radio-button value="table">☰ 表格</n-radio-button>
        <n-radio-button value="cards">▦ 卡片</n-radio-button>
      </n-radio-group>
      <div class="stories-toolbar__filter">
        <n-switch v-model:value="coverFilterSwitch" size="small" />
        <span class="stories-toolbar__filter-label">仅显示含封面</span>
      </div>
    </div>

    <!-- 内容区 -->
    <div class="cap-card stories-content" :style="{ padding: viewMode === 'cards' ? '20px' : '0', overflow: 'hidden' }">
      <n-data-table
        v-if="viewMode === 'table'"
        :columns="columns"
        :data="filteredStories"
        :loading="loading"
        :bordered="false"
      />
      <StoriesCards
        v-else
        :stories="filteredStories"
        @edit="startEdit"
        @remove="handleDelete"
      />
    </div>

    <!-- 新建 / 编辑 modal -->
    <n-modal v-model:show="showModal" :title="editingId ? '编辑小说' : '新建小说'" preset="card" style="width: 560px">
      <n-form :model="form" label-placement="left" label-width="100">
        <n-form-item label="标题" required>
          <n-input v-model:value="form.title" placeholder="请输入小说标题" />
        </n-form-item>
        <n-form-item label="简介">
          <n-input v-model:value="form.description" type="textarea" placeholder="请输入简介" />
        </n-form-item>
        <n-form-item label="封面">
          <div class="cover-field">
            <div v-if="form.coverPreview" class="cover-field__preview">
              <img :src="form.coverPreview" alt="封面预览" />
              <button class="cover-field__remove" type="button" @click="clearCover">移除封面</button>
            </div>
            <div v-else-if="form.existingCoverUrl" class="cover-field__preview">
              <img :src="form.existingCoverUrl" alt="当前封面" />
              <button class="cover-field__remove" type="button" @click="markRemoveCover">移除封面</button>
            </div>
            <div v-else class="cover-field__empty">
              <span>暂无封面</span>
            </div>
            <input
              ref="fileInputRef"
              type="file"
              accept="image/jpeg,image/png,image/webp"
              style="display:none"
              @change="onFileSelected"
            />
            <button class="cap-pill" type="button" @click="fileInputRef?.click()">选择图片</button>
            <span class="cover-field__hint">JPG / PNG / WebP，最大 2MB</span>
          </div>
        </n-form-item>
        <n-form-item label="写作人格">
          <n-select
            v-model:value="form.runtimeProfileId"
            :options="profileOptions"
            placeholder="选择关联的 Runtime Profile（可选）"
            clearable
          />
        </n-form-item>
        <n-form-item label="运行模型">
          <n-select
            v-model:value="form.aiProviderConfigId"
            :options="modelOptions"
            placeholder="选择运行模型（可选）"
            clearable
          />
        </n-form-item>
      </n-form>
      <template #footer>
        <n-space justify="end">
          <n-button @click="showModal = false">取消</n-button>
          <n-button type="primary" :loading="saving" @click="handleSave">{{ saving ? '保存中…' : '保存' }}</n-button>
        </n-space>
      </template>
    </n-modal>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, h } from 'vue'
import { useRouter } from 'vue-router'
import {
  NSpace, NButton, NDataTable, NModal, NForm, NFormItem, NInput, NSelect,
  NRadioGroup, NRadioButton, NSwitch, useDialog, useMessage, type DataTableColumns
} from 'naive-ui'
import { storiesApi } from '../api/stories'
import { runtimeApi } from '../api/runtime'
import { aiProviderApi } from '../api/ai-provider'
import { useStoriesViewPrefs } from '../composables/useStoriesViewPrefs'
import StoriesCards from '../components/StoriesCards.vue'

const router = useRouter()
const dialog = useDialog()
const message = useMessage()
const { viewMode, coverFilter } = useStoriesViewPrefs()

const stories = ref<any[]>([])
const profiles = ref<any[]>([])
const models = ref<any[]>([])
const loading = ref(false)
const saving = ref(false)
const showModal = ref(false)
const editingId = ref<string | null>(null)
const fileInputRef = ref<HTMLInputElement | null>(null)

const form = ref<{
  title: string
  description: string
  runtimeProfileId: string | null
  aiProviderConfigId: string | null
  coverFile: File | null
  coverPreview: string | null
  existingCoverUrl: string | null
  removeCover: boolean
}>({
  title: '',
  description: '',
  runtimeProfileId: null,
  aiProviderConfigId: null,
  coverFile: null,
  coverPreview: null,
  existingCoverUrl: null,
  removeCover: false
})

const profileOptions = computed(() =>
  profiles.value.map(p => ({ label: p.name, value: p.id }))
)
const modelOptions = computed(() =>
  models.value.map(m => ({
    label: `${m.name} / ${m.model}` + (m.isDefault ? ' (默认)' : ''),
    value: m.id
  }))
)

// 双向桥接: coverFilter (string) <-> coverFilterSwitch (boolean)
const coverFilterSwitch = computed<boolean>({
  get: () => coverFilter.value === 'with-cover',
  set: v => { coverFilter.value = v ? 'with-cover' : 'all' }
})

const filteredStories = computed(() => {
  if (coverFilter.value === 'all') return stories.value
  return stories.value.filter(s => !!s.coverUrl)
})

const columns: DataTableColumns<any> = [
  { title: '封面', key: 'coverUrl', width: 60, render(row) {
    return row.coverUrl
      ? h('img', { src: row.coverUrl, style: 'width:32px;height:42px;object-fit:cover;border-radius:4px' })
      : h('div', { style: 'width:32px;height:42px;background:var(--color-stone-gray);border-radius:4px;display:flex;align-items:center;justify-content:center;font-size:10px;color:#aaa' }, '—')
  }},
  { title: '标题', key: 'title' },
  { title: '简介', key: 'description', ellipsis: { tooltip: true } },
  { title: '状态', key: 'status', width: 100 },
  { title: '写作助手', key: 'runtimeProfile', width: 150, render(row) { return row.runtimeProfile?.name || '-' } },
  { title: '运行模型', key: 'defaultAiProvider', width: 180, render(row) {
    return row.defaultAiProvider ? `${row.defaultAiProvider.name} / ${row.defaultAiProvider.model}` : '系统默认'
  }},
  { title: '章节数', key: '_count.chapters', width: 80 },
  { title: '角色数', key: '_count.characters', width: 80 },
  { title: '更新时间', key: 'updatedAt', width: 170 },
  {
    title: '操作',
    key: 'actions',
    width: 220,
    render(row) {
      return h(NSpace, null, {
        default: () => [
          h(NButton, { size: 'small', type: 'primary', onClick: () => enterDesign(row.id) }, { default: () => '设计' }),
          h(NButton, { size: 'small', onClick: () => startEdit(row) }, { default: () => '编辑' }),
          h(NButton, { size: 'small', type: 'error', onClick: () => handleDelete(row) }, { default: () => '删除' })
        ]
      })
    }
  }
]

async function loadStories() {
  loading.value = true
  try {
    const [storiesRes, profilesRes, modelsRes] = await Promise.all([
      storiesApi.list(),
      runtimeApi.list(),
      aiProviderApi.list()
    ])
    stories.value = (storiesRes as any).data.data
    profiles.value = (profilesRes as any).data.data
    models.value = (modelsRes as any).data.data
  } finally {
    loading.value = false
  }
}

function enterDesign(storyId: string) {
  router.push(`/novel-design/${storyId}/characters`)
}

function openCreate() {
  editingId.value = null
  resetForm()
  showModal.value = true
}

function startEdit(row: any) {
  editingId.value = row.id
  form.value = {
    title: row.title,
    description: row.description || '',
    runtimeProfileId: row.runtimeProfileId || null,
    aiProviderConfigId: row.aiProviderConfigId || null,
    coverFile: null,
    coverPreview: null,
    existingCoverUrl: row.coverUrl || null,
    removeCover: false
  }
  showModal.value = true
}

function resetForm() {
  form.value = {
    title: '', description: '', runtimeProfileId: null, aiProviderConfigId: null,
    coverFile: null, coverPreview: null, existingCoverUrl: null, removeCover: false
  }
}

function onFileSelected(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return

  if (!['image/jpeg','image/png','image/webp'].includes(file.type)) {
    message.error('仅支持 JPG / PNG / WebP 格式')
    input.value = ''
    return
  }
  if (file.size > 2 * 1024 * 1024) {
    message.error('文件不能超过 2MB')
    input.value = ''
    return
  }

  form.value.coverFile = file
  form.value.removeCover = false
  const reader = new FileReader()
  reader.onload = ev => { form.value.coverPreview = ev.target?.result as string }
  reader.readAsDataURL(file)
}

function clearCover() {
  form.value.coverFile = null
  form.value.coverPreview = null
  if (fileInputRef.value) fileInputRef.value.value = ''
  if (editingId.value && form.value.existingCoverUrl) {
    form.value.removeCover = true
    form.value.existingCoverUrl = null
  }
}

function markRemoveCover() {
  form.value.removeCover = true
  form.value.existingCoverUrl = null
}

async function handleSave() {
  if (!form.value.title) {
    message.error('请输入标题')
    return
  }
  saving.value = true
  try {
    if (form.value.coverFile) {
      const fd = new FormData()
      fd.append('title', form.value.title)
      fd.append('description', form.value.description)
      if (form.value.runtimeProfileId) fd.append('runtimeProfileId', form.value.runtimeProfileId)
      if (form.value.aiProviderConfigId) fd.append('aiProviderConfigId', form.value.aiProviderConfigId)
      fd.append('cover', form.value.coverFile)
      if (form.value.removeCover) fd.append('removeCover', 'true')
      if (editingId.value) {
        await storiesApi.update(editingId.value, fd)
      } else {
        await storiesApi.create(fd as any)
      }
    } else {
      const payload: any = {
        title: form.value.title,
        description: form.value.description,
        runtimeProfileId: form.value.runtimeProfileId,
        aiProviderConfigId: form.value.aiProviderConfigId
      }
      if (form.value.removeCover) payload.removeCover = 'true'
      if (editingId.value) {
        await storiesApi.update(editingId.value, payload)
      } else {
        await storiesApi.create(payload)
      }
    }
    showModal.value = false
    editingId.value = null
    resetForm()
    await loadStories()
    message.success('已保存')
  } catch (err: any) {
    message.error('保存失败: ' + (err?.message || '未知错误'))
  } finally {
    saving.value = false
  }
}

function handleDelete(row: any) {
  const chapterCount = row._count?.chapters ?? 0
  const characterCount = row._count?.characters ?? 0
  dialog.warning({
    title: '确认删除',
    content: `确定要删除小说《${row.title}》吗？${chapterCount > 0 || characterCount > 0 ? `该小说包含 ${chapterCount} 个章节、${characterCount} 个角色，删除后不可恢复。` : '删除后不可恢复。'}`,
    positiveText: '删除',
    negativeText: '取消',
    positiveButtonProps: { type: 'error' },
    onPositiveClick: async () => {
      await storiesApi.remove(row.id)
      await loadStories()
    }
  })
}

onMounted(loadStories)
</script>

<style scoped>
.stories-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 0 14px 0;
}
.stories-toolbar__filter {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  color: var(--text-tertiary, #888);
}
.stories-content {
  background: var(--color-pure-white, #fff);
}
.cover-field {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}
.cover-field__preview {
  display: flex;
  align-items: center;
  gap: 8px;
}
.cover-field__preview img {
  width: 64px;
  height: 84px;
  object-fit: cover;
  border-radius: 6px;
  border: 1px solid var(--border-default, #e5e5e5);
}
.cover-field__remove {
  background: transparent;
  border: none;
  color: #c8392f;
  font-size: 12px;
  cursor: pointer;
  text-decoration: underline;
}
.cover-field__empty {
  width: 64px;
  height: 84px;
  background: var(--color-stone-gray, #f0f0ee);
  border: 1px dashed var(--border-default, #d0d0d0);
  border-radius: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  color: var(--text-tertiary, #aaa);
}
.cover-field__hint {
  font-size: 11px;
  color: var(--text-tertiary, #aaa);
}
</style>
