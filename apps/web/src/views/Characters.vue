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

    <!-- 档案视图工具条 (v4: 章节切换) -->
    <div class="char-toolbar">
      <svg class="char-toolbar__icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M4 4h11a3 3 0 0 1 3 3v13H7a3 3 0 0 1-3-3z"/>
        <path d="M4 17a3 3 0 0 1 3-3h11"/>
      </svg>
      <div class="char-toolbar__label">
        <span class="char-toolbar__eyebrow">档案视图</span>
        <span class="char-toolbar__title">{{ archiveViewTitle }}</span>
      </div>
      <n-select
        v-model:value="viewChapter"
        :options="chapterOptions"
        placeholder="最新归档章节"
        clearable
        size="small"
        style="width: 240px"
      />
    </div>

    <n-spin :show="loading">
      <n-empty
        v-if="!loading && characters.length === 0"
        description="暂无角色, 点击右上角新建"
        style="margin-top: 64px"
      />
      <div v-else class="char-grid">
        <article
          v-for="(char, idx) in characters"
          :key="char.id"
          class="char-card cap-rise"
          :data-rise="String(Math.min(idx + 1, 7))"
        >
          <!-- 顶部条: 档案号 + 操作 -->
          <div class="char-card__topbar">
            <span class="char-card__number">{{ archiveNumber(idx) }}</span>
            <n-space size="small">
              <button class="cap-icon-btn" :title="'编辑 ' + char.name" :aria-label="'编辑 ' + char.name" @click="openEdit(char)">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4z"/>
                </svg>
              </button>
              <button class="cap-icon-btn is-danger" :title="'删除 ' + char.name" :aria-label="'删除 ' + char.name" @click="handleDelete(char.id)">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <polyline points="3 6 5 6 21 6"/>
                  <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                </svg>
              </button>
            </n-space>
          </div>

          <!-- 标题区: 姓名 + 主角徽章 + slug -->
          <header class="char-card__title">
            <h3 class="char-card__name">
              {{ char.name }}
              <span v-if="char.protagonist" class="char-card__protagonist" title="主角" aria-label="主角">主角</span>
            </h3>
            <span class="char-card__slug">{{ char.slug }}</span>
          </header>

          <!-- 基础属性: 扁平 dot + text 列表 -->
          <div class="char-card__section">
            <span class="char-card__label">基础属性</span>
            <div v-if="hasAnyBaseAttr(char)" class="char-card__fields">
              <div v-for="group in groupedBaseAttrs(char)" :key="group.key" class="char-card__field-row">
                <span class="char-card__field-label">{{ group.label }}</span>
                <span class="char-card__field-value">{{ group.values.join(' · ') }}</span>
              </div>
            </div>
            <span v-else class="char-card__empty">未填写</span>
          </div>

          <!-- 章节快照: 横排 list -->
          <div class="char-card__section">
            <span class="char-card__label">章节快照</span>
            <div class="char-card__fields">
              <div class="char-card__field-row">
                <span class="char-card__field-label">关系</span>
                <div class="char-card__field-content">
                  <span v-if="char.relationships?.value && Object.keys(char.relationships.value).length > 0" class="char-card__field-value">
                    {{ formatObject(char.relationships?.value) }}
                  </span>
                  <span v-else class="char-card__empty">未提及</span>
                  <span
                    v-if="char.relationships?.sourceChapterNumber !== null && char.relationships?.sourceChapterNumber !== undefined"
                    class="char-card__source is-snapshot"
                  >第 {{ char.relationships.sourceChapterNumber }} 章</span>
                  <span
                    v-else-if="char.relationships?.value && Object.keys(char.relationships.value).length > 0"
                    class="char-card__source is-base"
                  >基础</span>
                </div>
              </div>
              <div class="char-card__field-row">
                <span class="char-card__field-label">状态</span>
                <div class="char-card__field-content">
                  <span v-if="char.status?.value && Object.keys(char.status.value).length > 0" class="char-card__field-value">
                    {{ formatObject(char.status?.value) }}
                  </span>
                  <span v-else class="char-card__empty">未提及</span>
                  <span
                    v-if="char.status?.sourceChapterNumber !== null && char.status?.sourceChapterNumber !== undefined"
                    class="char-card__source is-snapshot"
                  >第 {{ char.status.sourceChapterNumber }} 章</span>
                  <span
                    v-else-if="char.status?.value && Object.keys(char.status.value).length > 0"
                    class="char-card__source is-base"
                  >基础</span>
                </div>
              </div>
              <div class="char-card__field-row">
                <span class="char-card__field-label">衣着</span>
                <div class="char-card__field-content">
                  <span v-if="char.costume?.value" class="char-card__field-value">
                    {{ char.costume.value }}
                  </span>
                  <span v-else class="char-card__empty">未描写</span>
                  <span
                    v-if="char.costume?.sourceChapterNumber !== null && char.costume?.sourceChapterNumber !== undefined"
                    class="char-card__source is-snapshot"
                  >第 {{ char.costume.sourceChapterNumber }} 章</span>
                </div>
              </div>
            </div>
          </div>
        </article>
      </div>
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
          创建时可设置基础关系/状态;查看章节快照请使用上方档案视图切换器。
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
import { ref, computed, onMounted, watch } from 'vue'
import { useRoute } from 'vue-router'
import {
  NSpace, NButton, NModal, NForm, NFormItem, NInput, NCheckbox,
  NSelect, NAlert, NSpin, NEmpty
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
const viewChapter = ref<number | null>(null)
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

/** 档案编号: № 001 */
function archiveNumber(idx: number): string {
  return `№ ${String(idx + 1).padStart(3, '0')}`
}

/** 档案视图标题 (工具条用) */
const archiveViewTitle = computed(() => {
  if (viewChapter.value === null) return '默认 · 最新有数据快照'
  return `第 ${viewChapter.value} 章 · 统一视图`
})

/** 基础属性分组: 按类型聚合,每类一行 */
type BaseAttrGroup = { key: string; label: string; values: string[] }
function groupedBaseAttrs(c: CharacterDisplayRow): BaseAttrGroup[] {
  const groups: BaseAttrGroup[] = []
  const push = (key: string, label: string, arr: string[] | undefined) => {
    if (!Array.isArray(arr) || arr.length === 0) return
    groups.push({ key, label, values: arr })
  }
  push('identity', '身份', c.identity)
  push('appearance', '外貌', c.appearance)
  push('temperament', '气质', c.temperament)
  push('personality', '性格', c.personality)
  push('speechStyle', '说话', c.speechStyle)
  return groups
}
function hasAnyBaseAttr(c: CharacterDisplayRow): boolean {
  return groupedBaseAttrs(c).length > 0
}

/** 格式化 Record<string, any> → "k:v, k:v" */
function formatObject(obj: Record<string, any> | null | undefined): string {
  if (!obj || typeof obj !== 'object') return ''
  const entries = Object.entries(obj)
  if (entries.length === 0) return ''
  return entries.map(([k, v]) => {
    if (typeof v === 'object' && v !== null) return `${k}: ${JSON.stringify(v)}`
    return `${k}: ${v}`
  }).join(', ')
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
    // 静默
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
/* === 档案视图工具条 === */
.char-toolbar {
  display: flex;
  align-items: center;
  gap: 14px;
  background: var(--bg-card);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-card);
  padding: 10px 18px;
  margin-bottom: 18px;
}
.char-toolbar__icon {
  color: var(--accent);
  flex: 0 0 auto;
}
.char-toolbar__label {
  display: flex;
  flex-direction: column;
  gap: 2px;
  flex: 1;
  min-width: 0;
}
.char-toolbar__eyebrow {
  font-size: 10px;
  letter-spacing: 1.2px;
  text-transform: uppercase;
  color: var(--color-muted-ash);
  font-weight: var(--weight-semibold);
}
.char-toolbar__title {
  font-size: 14px;
  color: var(--text-primary);
  font-weight: var(--weight-medium);
}

/* === 卡片网格 === */
.char-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px;
}
@media (max-width: 900px) {
  .char-grid { grid-template-columns: 1fr; }
}
@media (min-width: 1500px) {
  .char-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); }
}

/* === 卡片本体 === */
.char-card {
  background: var(--bg-card);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-card);
  padding: 18px 20px 20px;
  display: flex;
  flex-direction: column;
  gap: 16px;
  position: relative;
  transition: border-color 0.2s ease, transform 0.2s ease, box-shadow 0.2s ease;
}
.char-card:hover {
  border-color: var(--color-mid-gray);
  transform: translateY(-1px);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.04);
}

/* 顶部条: 档案号 + 图标操作 */
.char-card__topbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 10px;
}
.char-card__number {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 11px;
  letter-spacing: 1.5px;
  color: var(--color-muted-ash);
  font-weight: var(--weight-semibold);
}
.cap-icon-btn {
  width: 28px;
  height: 28px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: 1px solid var(--border-default);
  border-radius: 6px;
  color: var(--color-mid-gray);
  cursor: pointer;
  transition: color 0.15s ease, border-color 0.15s ease, background 0.15s ease;
}
.cap-icon-btn:hover {
  color: var(--text-primary);
  border-color: var(--color-mid-gray);
  background: var(--bg-section);
}
.cap-icon-btn.is-danger:hover {
  color: var(--color-error, #b8581e);
  border-color: var(--color-error, #b8581e);
  background: transparent;
}

/* 标题区: 姓名 + slug */
.char-card__title {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 10px;
  margin-top: -4px;
}
.char-card__name {
  font-size: 22px;
  font-weight: var(--weight-semibold);
  margin: 0;
  line-height: 1.15;
  color: var(--text-primary);
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.char-card__protagonist {
  display: inline-flex;
  align-items: center;
  padding: 2px 8px;
  font-size: 11px;
  background: var(--accent);
  color: var(--text-on-accent, #fff);
  border-radius: 4px;
  letter-spacing: 1px;
  font-weight: var(--weight-medium);
}
.char-card__slug {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 10px;
  letter-spacing: 1.2px;
  text-transform: uppercase;
  color: var(--color-muted-ash);
  padding: 2px 6px;
  background: var(--bg-section);
  border-radius: 4px;
}

/* section 通用 */
.char-card__section {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.char-card__label {
  font-size: 10px;
  letter-spacing: 1.5px;
  text-transform: uppercase;
  color: var(--color-muted-ash);
  font-weight: var(--weight-semibold);
}
.char-card__empty {
  font-size: 12px;
  color: var(--color-muted-ash);
  font-style: italic;
  letter-spacing: 0.3px;
}

/* === 统一字段列表: 基础属性 + 章节快照 共用 === */
.char-card__fields {
  display: flex;
  flex-direction: column;
}
.char-card__field-row {
  display: flex;
  gap: 14px;
  align-items: baseline;
  padding: 7px 0;
  border-bottom: 1px dashed var(--border-default);
}
.char-card__field-row:first-child { padding-top: 0; }
.char-card__field-row:last-child {
  border-bottom: none;
  padding-bottom: 0;
}
.char-card__field-label {
  flex: 0 0 44px;
  font-size: 11px;
  color: var(--color-mid-gray);
  letter-spacing: 0.3px;
}
.char-card__field-value {
  flex: 1;
  min-width: 0;
  font-size: 13px;
  line-height: 1.55;
  word-break: break-word;
  color: var(--text-primary);
}
.char-card__field-content {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.char-card__source {
  display: inline-block;
  font-size: 10px;
  letter-spacing: 0.6px;
  padding: 1px 6px;
  border-radius: 3px;
  font-weight: var(--weight-regular);
  align-self: flex-start;
}
.char-card__source.is-snapshot {
  color: var(--color-info, #4a5a7a);
  background: rgba(74, 90, 122, 0.08);
}
.char-card__source.is-base {
  color: var(--color-positive, #5a7a4f);
  background: rgba(90, 122, 79, 0.08);
}
</style>
