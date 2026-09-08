<template>
  <div>
    <header class="page-head">
      <div class="page-head__text">
        <span class="cap-eyebrow is-accent">CHARACTERS</span>
        <h1 class="page-head__title">角色管理</h1>
        <p class="page-head__lede cap-body-sm">人物是叙事的载体 — 定义身份、性格、关系网。</p>
      </div>
      <div class="page-head__actions">
        <button class="cap-pill is-primary" @click="openCreate">+ 新建角色</button>
      </div>
    </header>

    <!-- 章节切换器 (v4: 三字段独立查快照) -->
    <div class="cap-card" style="margin-bottom: 16px; padding: 14px 18px">
      <n-space align="center" :wrap="false">
        <n-text depth="3">查看章节快照:</n-text>
        <n-select
          v-model:value="viewChapter"
          :options="chapterOptions"
          placeholder="最新有数据(默认)"
          clearable
          style="width: 280px"
        />
        <n-text v-if="viewChapter !== null" depth="3" style="font-size: 12px">
          切换后只显示该章节的快照数据,无字段则为 null
        </n-text>
      </n-space>
    </div>

    <n-spin :show="loading">
      <n-empty
        v-if="!loading && characters.length === 0"
        description="暂无角色, 点击右上角新建"
        style="margin-top: 48px"
      />
      <n-grid
        v-else
        cols="2 s:1 m:2 l:2 xl:3"
        x-gap="14"
        y-gap="14"
        responsive="screen"
      >
        <n-gi v-for="(char, idx) in characters" :key="char.id">
          <article class="char-card cap-rise" :data-rise="String(Math.min(idx + 1, 7))">
            <!-- 头部: slug + name + 主角 + 操作 -->
            <header class="char-card__head">
              <div class="char-card__id">
                <span class="char-card__slug">{{ char.slug }}</span>
                <h3 class="char-card__name">
                  {{ char.name }}
                  <span v-if="char.protagonist" class="char-card__protagonist" title="主角">★</span>
                </h3>
              </div>
              <n-space size="small">
                <n-button size="small" @click="openEdit(char)">编辑</n-button>
                <n-button size="small" type="error" @click="handleDelete(char.id)">删除</n-button>
              </n-space>
            </header>

            <!-- 基础属性 -->
            <div class="char-card__section">
              <span class="char-card__label">基础属性</span>
              <div v-if="hasAnyBaseAttr(char)" class="char-card__tags">
                <n-tag
                  v-for="tag in char.identity"
                  :key="'id-' + tag"
                  size="small"
                  type="info"
                >身份 · {{ tag }}</n-tag>
                <n-tag
                  v-for="tag in char.appearance"
                  :key="'ap-' + tag"
                  size="small"
                >外貌 · {{ tag }}</n-tag>
                <n-tag
                  v-for="tag in char.temperament"
                  :key="'te-' + tag"
                  size="small"
                  type="warning"
                >气质 · {{ tag }}</n-tag>
                <n-tag
                  v-for="tag in char.personality"
                  :key="'pe-' + tag"
                  size="small"
                  type="success"
                >性格 · {{ tag }}</n-tag>
                <n-tag
                  v-for="tag in char.speechStyle"
                  :key="'ss-' + tag"
                  size="small"
                  type="error"
                >说话 · {{ tag }}</n-tag>
              </div>
              <n-text v-else depth="3" style="font-size: 12px">(未填写)</n-text>
            </div>

            <!-- 快照 — 横排:每个字段一行,左标签右内容 -->
            <div class="char-card__section">
              <span class="char-card__label">章节快照</span>
              <div class="char-card__snapshot-list">
                <div class="char-card__snapshot-row">
                  <span class="char-card__snapshot-label">关系</span>
                  <div class="char-card__snapshot-content">
                    <div class="char-card__snapshot-value">{{ formatObject(char.relationships?.value) }}</div>
                    <n-tag size="tiny" :type="sourceTagType(char.relationships?.sourceChapterNumber)">
                      {{ sourceLabel(char.relationships?.sourceChapterNumber) }}
                    </n-tag>
                  </div>
                </div>
                <div class="char-card__snapshot-row">
                  <span class="char-card__snapshot-label">状态</span>
                  <div class="char-card__snapshot-content">
                    <div class="char-card__snapshot-value">{{ formatObject(char.status?.value) }}</div>
                    <n-tag size="tiny" :type="sourceTagType(char.status?.sourceChapterNumber)">
                      {{ sourceLabel(char.status?.sourceChapterNumber) }}
                    </n-tag>
                  </div>
                </div>
                <div class="char-card__snapshot-row">
                  <span class="char-card__snapshot-label">衣着</span>
                  <div class="char-card__snapshot-content">
                    <div class="char-card__snapshot-value">{{ char.costume?.value || '(无)' }}</div>
                    <n-tag
                      v-if="char.costume?.sourceChapterNumber !== null && char.costume?.sourceChapterNumber !== undefined"
                      size="tiny"
                      type="info"
                    >来源: 第 {{ char.costume.sourceChapterNumber }} 章</n-tag>
                    <n-text
                      v-else
                      depth="3"
                      style="font-size: 11px"
                    >(无快照)</n-text>
                  </div>
                </div>
              </div>
            </div>
          </article>
        </n-gi>
      </n-grid>
    </n-spin>

    <!-- 新建/编辑角色弹窗 (v4: 不再编辑关系/状态,走 PUT append snapshot) -->
    <n-modal v-model:show="showModal" :title="isEdit ? '编辑角色' : '新建角色'" preset="card" style="width: 640px">
      <n-form :model="form" label-placement="left" label-width="80">
        <n-form-item label="标识" required :disabled="isEdit">
          <n-input v-model:value="form.slug" placeholder="英文标识,如 linfan" :disabled="isEdit" />
        </n-form-item>
        <n-form-item label="姓名" required>
          <n-input v-model:value="form.name" placeholder="角色姓名" />
        </n-form-item>
        <n-form-item label="主角">
          <n-checkbox v-model:checked="form.protagonist"></n-checkbox>
        </n-form-item>
        <n-form-item label="身份">
          <DynamicTags v-model="form.identity" />
        </n-form-item>
        <n-form-item label="外貌">
          <DynamicTags v-model="form.appearance" />
        </n-form-item>
        <n-form-item label="气质">
          <DynamicTags v-model="form.temperament" />
        </n-form-item>
        <n-form-item label="性格">
          <DynamicTags v-model="form.personality" />
        </n-form-item>
        <n-form-item label="说话风格">
          <DynamicTags v-model="form.speechStyle" />
        </n-form-item>
        <n-alert type="info" :show-icon="true" style="margin-top: 8px">
          关系 / 状态 / 衣着 字段由归档时 AI 抽取并落入快照,不在此处编辑。
          创建时可设置基础关系/状态;查看章节快照请使用上方章节切换器。
        </n-alert>
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
import { ref, onMounted, watch } from 'vue'
import { useRoute } from 'vue-router'
import {
  NSpace, NButton, NModal, NForm, NFormItem, NInput, NCheckbox,
  NText, NSelect, NAlert, NTag, NSpin, NEmpty, NGrid, NGi
} from 'naive-ui'
import { charactersApi, type CharacterDisplayRow } from '../api/characters'
import { chaptersApi } from '../api/chapters'
import DynamicTags from '../components/DynamicTags.vue'

const route = useRoute()
const characters = ref<CharacterDisplayRow[]>([])
const loading = ref(false)
const showModal = ref(false)
const isEdit = ref(false)
const editId = ref('')
const viewChapter = ref<number | null>(null)  // null = 默认(最新有数据)
const chapterOptions = ref<Array<{ label: string; value: number }>>([])

const form = ref({
  slug: '',
  name: '',
  protagonist: false,
  identity: [] as string[],
  appearance: [] as string[],
  temperament: [] as string[],
  personality: [] as string[],
  speechStyle: [] as string[]
})

function formatObject(obj: Record<string, any> | null | undefined): string {
  if (!obj || typeof obj !== 'object') return '(无)'
  const entries = Object.entries(obj)
  if (entries.length === 0) return '(无)'
  return entries.map(([k, v]) => {
    if (typeof v === 'object' && v !== null) return `${k}: ${JSON.stringify(v)}`
    return `${k}: ${v}`
  }).join(', ')
}

function hasAnyBaseAttr(c: CharacterDisplayRow): boolean {
  return (
    (Array.isArray(c.identity) && c.identity.length > 0) ||
    (Array.isArray(c.appearance) && c.appearance.length > 0) ||
    (Array.isArray(c.temperament) && c.temperament.length > 0) ||
    (Array.isArray(c.personality) && c.personality.length > 0) ||
    (Array.isArray(c.speechStyle) && c.speechStyle.length > 0)
  )
}

/** 来源标签:number → "第 N 章" info 标签;null → "基础" 默认标签;undefined → "(无)" */
function sourceLabel(ch: number | null | undefined): string {
  if (ch === null || ch === undefined) return '(无快照)'
  return `来源: 第 ${ch} 章`
}
function sourceTagType(ch: number | null | undefined): 'info' | 'default' {
  return ch === null || ch === undefined ? 'default' : 'info'
}

async function loadCharacters() {
  if (!route.params.storyId) {
    characters.value = []
    return
  }
  loading.value = true
  try {
    const res = await charactersApi.display(route.params.storyId as string, viewChapter.value)
    characters.value = res.data.data ?? []
  } finally {
    loading.value = false
  }
}

async function loadChapterOptions() {
  if (!route.params.storyId) return
  try {
    const res = await chaptersApi.list(route.params.storyId as string)
    chapterOptions.value = (res.data?.data ?? [])
      .filter((ch: any) => ch.status === 'archived')
      .map((ch: any) => ({ label: `第 ${ch.number} 章: ${ch.title || ''}`, value: ch.number }))
      .sort((a: { value: number }, b: { value: number }) => b.value - a.value)
  } catch {
    // 静默:章节列表失败不影响主表格
  }
}

function resetForm() {
  form.value = {
    slug: '', name: '', protagonist: false,
    identity: [], appearance: [], temperament: [],
    personality: [], speechStyle: []
  }
}

function openCreate() {
  isEdit.value = false
  editId.value = ''
  resetForm()
  showModal.value = true
}

function openEdit(row: CharacterDisplayRow) {
  isEdit.value = true
  editId.value = row.id
  form.value = {
    slug: row.slug,
    name: row.name,
    protagonist: row.protagonist ?? false,
    identity: Array.isArray(row.identity) ? row.identity : [],
    appearance: Array.isArray(row.appearance) ? row.appearance : [],
    temperament: Array.isArray(row.temperament) ? row.temperament : [],
    personality: Array.isArray(row.personality) ? row.personality : [],
    speechStyle: Array.isArray(row.speechStyle) ? row.speechStyle : []
  }
  showModal.value = true
}

async function handleSubmit() {
  if (!route.params.storyId) return
  const data = {
    name: form.value.name,
    protagonist: form.value.protagonist,
    identity: form.value.identity,
    appearance: form.value.appearance,
    temperament: form.value.temperament,
    personality: form.value.personality,
    speechStyle: form.value.speechStyle
  }

  if (isEdit.value && editId.value) {
    await charactersApi.update(editId.value, data)
  } else {
    if (!form.value.slug || !form.value.name) return
    await charactersApi.create(route.params.storyId as string, {
      slug: form.value.slug,
      ...data
    })
  }

  showModal.value = false
  resetForm()
  await loadCharacters()
}

async function handleDelete(id: string) {
  await charactersApi.remove(id)
  await loadCharacters()
}

watch(viewChapter, () => {
  loadCharacters()
})

watch(() => route.params.storyId, () => {
  loadCharacters()
  loadChapterOptions()
})

onMounted(() => {
  if (route.params.storyId) {
    loadCharacters()
    loadChapterOptions()
  }
})
</script>

<style scoped>
.char-card {
  background: var(--bg-card);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-card);
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 14px;
  height: 100%;
  transition: border-color 0.18s ease, transform 0.18s ease;
}
.char-card:hover {
  border-color: var(--color-mid-gray);
  transform: translateY(-1px);
}
.char-card__head {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 12px;
}
.char-card__id {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
  flex: 1;
}
.char-card__slug {
  font-size: 11px;
  color: var(--color-muted-ash);
  letter-spacing: 0.5px;
  text-transform: uppercase;
}
.char-card__name {
  font-size: 18px;
  font-weight: var(--weight-semibold);
  margin: 0;
  line-height: 1.2;
}
.char-card__protagonist {
  color: var(--accent, #b8581e);
  margin-left: 4px;
}
.char-card__section {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.char-card__label {
  font-size: 11px;
  color: var(--color-muted-ash);
  letter-spacing: 0.5px;
  text-transform: uppercase;
  font-weight: var(--weight-semibold);
}
.char-card__tags {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}
.char-card__snapshot-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.char-card__snapshot-row {
  display: flex;
  gap: 14px;
  align-items: flex-start;
}
.char-card__snapshot-label {
  flex: 0 0 48px;
  font-size: 11px;
  color: var(--color-muted-ash);
  letter-spacing: 0.5px;
  text-transform: uppercase;
  font-weight: var(--weight-semibold);
  padding-top: 2px;
}
.char-card__snapshot-content {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.char-card__snapshot-value {
  font-size: 13px;
  line-height: 1.5;
  word-break: break-word;
  color: var(--text-primary);
}
</style>
