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
              <button class="cap-icon-btn is-danger" :title="'删除 ' + char.name" :aria-label="'删除 ' + char.name" @click="handleDelete(char)">
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
            <div v-if="char.baseAttrs.has" class="char-card__fields">
              <div v-for="group in char.baseAttrs.groups" :key="group.key" class="char-card__field-row">
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

    <!-- 新建/编辑角色弹窗 (v4: base 始终可编辑; 快照只读, 仅归档时由 AI 写入) -->
    <n-modal v-model:show="showModal" :title="isEdit ? '编辑角色' : '新建角色'" preset="card" :style="{ width: editingHasSnapshot ? '960px' : '640px' }">
      <div :class="{ 'character-edit-columns': editingHasSnapshot }">
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
        <n-divider title-placement="left">基础状态与关系</n-divider>
        <n-alert v-if="editingHasSnapshot" type="info" :show-icon="true">
          该角色已有章节快照（见右侧），生成章节时 AI 优先参考快照中的关系/状态；此处的修改在快照存在时不生效。
        </n-alert>
        <n-form-item label="基础关系"><n-input v-model:value="form.relationshipsText" type="textarea" placeholder="e.g. {&quot;Alice&quot;: &quot;friend&quot;}" /></n-form-item>
        <n-form-item label="Base status"><n-input v-model:value="form.statusText" type="textarea" placeholder="e.g. {&quot;rank&quot;: &quot;level 1&quot;}" /></n-form-item>
      </n-form>
        <aside v-if="editingHasSnapshot && editingCharacter" class="character-edit-snapshot">
          <div class="character-edit-snapshot__bar">
            <span class="character-edit-snapshot__hint">章节快照由归档 AI 分析生成；手动修改由你负责。</span>
            <n-button v-if="!snapshotEditing" size="tiny" @click="startSnapshotEdit">编辑快照</n-button>
            <n-space v-else size="small">
              <n-button size="tiny" type="primary" @click="saveSnapshot">保存快照</n-button>
              <n-button size="tiny" @click="cancelSnapshotEdit">取消编辑</n-button>
            </n-space>
          </div>
          <n-alert v-if="snapshotEditing" type="warning" :show-icon="true">
            手动修改快照由你负责。该快照将直接作为后续章节生成时的角色参考；删除对应章节时此修改随快照一并删除。
          </n-alert>
          <n-select
            v-model:value="snapshotChapter"
            :options="chapterOptions"
            size="small"
            placeholder="Select snapshot chapter"
            :disabled="snapshotEditing"
          />
          <template v-if="snapshotEditing">
            <span class="char-card__label">关系（JSON）</span>
            <n-input v-model:value="snapshotForm.relationshipsText" type="textarea" :rows="4" placeholder='{"林帆": "师徒"}' />
            <span class="char-card__label">状态（JSON）</span>
            <n-input v-model:value="snapshotForm.statusText" type="textarea" :rows="4" placeholder='{"realm": "练气"}' />
            <span class="char-card__label">衣着</span>
            <n-input v-model:value="snapshotForm.costume" placeholder="留空 = 未描写" />
          </template>
          <template v-else>
            <span class="char-card__label">最新章节快照</span>
            <div class="character-edit-snapshot__row"><strong>关系</strong><span>{{ formatObject(snapshotCharacter?.relationships?.value) || '未提取' }}</span></div>
            <div class="character-edit-snapshot__row"><strong>状态</strong><span>{{ formatObject(snapshotCharacter?.status?.value) || '未提取' }}</span></div>
            <div class="character-edit-snapshot__row"><strong>衣着</strong><span>{{ snapshotCharacter?.costume?.value || '未提取' }}</span></div>
            <span class="char-card__source is-snapshot">归档快照</span>
          </template>
        </aside>
      </div>
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
  NSelect, NAlert, NSpin, NEmpty, NDivider, useDialog, useMessage
} from 'naive-ui'
import { charactersApi, type CharacterDisplayRow } from '../api/characters'
/**
 * CharacterRowWithAttrs = 后端 CharacterDisplayRow + 视图层 enrich 的 baseAttrs。
 *
 * baseAttrs 不是后端字段,仅用于列表卡片渲染;
 *   副作用:
 *   - 不参与 PUT 请求: characters.ts PUT 显式挑字段,
 *     handleSubmit 构造 data 时未读 baseAttrs
 *   - 不参与删除: charactersApi.remove 只取 row.id
 *   - 不参与编辑弹窗: editingCharacter / snapshotCharacter 是 CharacterDisplayRow 类型,
 *     不挂 baseAttrs, 弹窗代码也不读它
 *   - 不下传到详情 API: 详情端点不接收此字段
 */
type CharacterRowWithAttrs = CharacterDisplayRow & { baseAttrs: { has: boolean; groups: BaseAttrGroup[] } }
import { chaptersApi } from '../api/chapters'
import DynamicTags from '../components/DynamicTags.vue'

const route = useRoute()
const dialog = useDialog()

const message = useMessage()
const loading = ref(false)
const showModal = ref(false)
const isEdit = ref(false)
const editId = ref('')
const editingHasSnapshot = computed(() => { const c = editingCharacter.value; return !!(c?.relationships || c?.status || c?.costume) })
const editingCharacter = ref<CharacterDisplayRow | null>(null)
const snapshotCharacter = ref<CharacterDisplayRow | null>(null)
const snapshotChapter = ref<number | null>(null)
const viewChapter = ref<number | null>(null)
const chapterOptions = ref<Array<{ label: string; value: number }>>([])
const characters = ref<CharacterRowWithAttrs[]>([])

const form = ref({
  slug: '',
  name: '',
  protagonist: false,
  identity: [] as string[],
  appearance: [] as string[],
  temperament: [] as string[],
  personality: [] as string[],
  speechStyle: [] as string[],
  relationshipsText: '{}', statusText: '{}'
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
/**
 * 单次遍历收集角色基础属性的渲染数据,返回 { has, groups } 一次性喂给模板。
 *
 * 设计动机: 列表卡片渲染需要 (a) 判断是否有基础属性 (b) 列出各组;
 *   原代码 hasAnyBaseAttr + groupedBaseAttrs 两个遍历一份数据;
 *   合并后, 调用方在 loadCharacters 中 enrich 一次(见 char.baseAttrs), 模板零开销读取。
 *
 * 副作用: 见 CharacterRowWithAttrs 类型注释; 此函数本身无副作用,纯函数。
 */
function collectBaseAttrs(c: CharacterDisplayRow): { has: boolean; groups: BaseAttrGroup[] } {
  const groups: BaseAttrGroup[] = []
  const push = (key: string, label: string, arr: string[] | undefined) => {
    if (Array.isArray(arr) && arr.length > 0) groups.push({ key, label, values: arr })
  }
  push('identity', '身份', c.identity)
  push('appearance', '外貌', c.appearance)
  push('temperament', '气质', c.temperament)
  push('personality', '性格', c.personality)
  push('speechStyle', '说话', c.speechStyle)
  return { has: groups.length > 0, groups }
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
    // 视图层 enrich: 给每行附加 baseAttrs,模板里直接读,避免每次渲染重新调用 collectBaseAttrs
    // (字段作用与副作用详见 CharacterRowWithAttrs 类型注释)
    characters.value = (res.data.data ?? []).map((c: CharacterDisplayRow): CharacterRowWithAttrs => ({ ...c, baseAttrs: collectBaseAttrs(c) }))
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
    personality: [], speechStyle: [],
    relationshipsText: '{}', statusText: '{}'
  }
}

function openCreate() {
  isEdit.value = false
  editId.value = ''
  editingCharacter.value = null
  snapshotCharacter.value = null
  snapshotChapter.value = null
  resetForm()
  showModal.value = true
}

function openEdit(row: CharacterDisplayRow) {
  isEdit.value = true
  editId.value = row.id
  editingCharacter.value = row
  snapshotCharacter.value = row
  snapshotChapter.value = row.relationships?.sourceChapterNumber ?? row.status?.sourceChapterNumber ?? row.costume?.sourceChapterNumber ?? null
  form.value = {
    slug: row.slug,
    name: row.name,
    protagonist: row.protagonist ?? false,
    identity: Array.isArray(row.identity) ? row.identity : [],
    appearance: Array.isArray(row.appearance) ? row.appearance : [],
    temperament: Array.isArray(row.temperament) ? row.temperament : [],
    personality: Array.isArray(row.personality) ? row.personality : [],
    speechStyle: Array.isArray(row.speechStyle) ? row.speechStyle : [],
    relationshipsText: JSON.stringify(row.baseRelationships ?? {}, null, 2),
    statusText: JSON.stringify(row.baseStatus ?? {}, null, 2)
  }
  showModal.value = true
}

async function handleSubmit() {
  if (!route.params.storyId) return
  const data: Record<string, any> = {
    name: form.value.name,
    protagonist: form.value.protagonist,
    identity: form.value.identity,
    appearance: form.value.appearance,
    temperament: form.value.temperament,
    personality: form.value.personality,
    speechStyle: form.value.speechStyle
  }
  try {
    data.relationships = JSON.parse(form.value.relationshipsText || '{}')
    data.status = JSON.parse(form.value.statusText || '{}')
  } catch (err: any) {
    message.error(`基础关系 / Base status 不是合法 JSON: ${err.message || err}`)
    return
  }
  if (isEdit.value && editId.value) {
    await charactersApi.update(editId.value, data)
  } else {
    if (!form.value.slug || !form.value.name) return
    await charactersApi.create(route.params.storyId as string, {
      slug: form.value.slug,
      name: form.value.name,
      ...data
    })
  }

  showModal.value = false
  resetForm()
  await loadCharacters()
}

function handleDelete(row: CharacterDisplayRow) {
  dialog.warning({
    title: '确认删除角色',
    content: `确定要删除角色「${row.name}」吗？角色基础档案及其所有章节快照都会被删除，且不可恢复。`,
    positiveText: '删除',
    negativeText: '取消',
    onPositiveClick: async () => {
      await charactersApi.remove(row.id)
      await loadCharacters()
    }
  })
}

watch(viewChapter, () => {
  loadCharacters()
})

// ========== 快照编辑 (v4 快照纠错) ==========
const snapshotEditing = ref(false)
const snapshotForm = ref({ relationshipsText: '{}', statusText: '{}', costume: '' })

function startSnapshotEdit() {
  if (!snapshotCharacter.value) return
  snapshotForm.value = {
    relationshipsText: JSON.stringify(snapshotCharacter.value.relationships?.value ?? {}, null, 2),
    statusText: JSON.stringify(snapshotCharacter.value.status?.value ?? {}, null, 2),
    costume: snapshotCharacter.value.costume?.value ?? ''
  }
  snapshotEditing.value = true
}

function cancelSnapshotEdit() {
  snapshotEditing.value = false
}

async function saveSnapshot() {
  if (!editingCharacter.value || snapshotChapter.value === null || !route.params.storyId) return
  let status: Record<string, any>
  let relationships: Record<string, any>
  try {
    status = JSON.parse(snapshotForm.value.statusText || '{}')
    relationships = JSON.parse(snapshotForm.value.relationshipsText || '{}')
  } catch (err: any) {
    message.error(`快照 JSON 不合法: ${err.message || err}`)
    return
  }
  try {
    await charactersApi.updateSnapshot(
      route.params.storyId as string,
      editingCharacter.value.id,
      snapshotChapter.value,
      { status, relationships, costume: snapshotForm.value.costume }
    )
  } catch (err: any) {
    message.error(err?.response?.data?.error || '快照更新失败')
    return
  }
  message.success('快照已更新')
  snapshotEditing.value = false
  // 重新拉取该章快照 + 刷新列表
  const res = await charactersApi.getSnapshot(route.params.storyId as string, editingCharacter.value.id, snapshotChapter.value)
  snapshotCharacter.value = res.data.data ?? null
  await loadCharacters()
}

watch(snapshotChapter, async (chapter) => {
  if (!editingHasSnapshot.value || !editingCharacter.value || chapter === null || !route.params.storyId) return
  const res = await charactersApi.getSnapshot(route.params.storyId as string, editingCharacter.value.id, chapter)
  snapshotCharacter.value = res.data.data ?? null
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
.character-edit-columns { display: grid; grid-template-columns: minmax(0, 1fr) minmax(280px, 0.8fr); gap: 24px; align-items: start; }
.character-edit-snapshot { border-left: 1px solid var(--border-default); padding-left: 24px; display: flex; flex-direction: column; gap: 14px; }
.character-edit-snapshot__hint { font-size: 12px; line-height: 1.5; color: var(--color-mid-gray); }
.character-edit-snapshot__row { display: flex; flex-direction: column; gap: 5px; padding-bottom: 12px; border-bottom: 1px dashed var(--border-default); }
.character-edit-snapshot__row strong { font-size: 12px; color: var(--color-mid-gray); }
.character-edit-snapshot__row span { font-size: 13px; line-height: 1.6; color: var(--text-primary); word-break: break-word; }
@media (max-width: 820px) { .character-edit-columns { grid-template-columns: 1fr; } .character-edit-snapshot { border-left: 0; border-top: 1px solid var(--border-default); padding-left: 0; padding-top: 20px; } }
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
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
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
/* protagonist + slug 视觉高度对齐(同一 baseline 高度) */
.char-card__protagonist,
.char-card__slug {
  display: inline-flex;
  align-items: center;
  padding: 2px 8px;
  font-size: 11px;
  line-height: 1.5;
  border-radius: 4px;
}
.char-card__protagonist {
  background: var(--accent);
  color: var(--text-on-accent, #fff);
  letter-spacing: 1px;
  font-weight: var(--weight-medium);
}
.char-card__slug {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  letter-spacing: 1px;
  text-transform: uppercase;
  color: var(--color-muted-ash);
  background: var(--bg-section);
  font-weight: var(--weight-regular);
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
.character-edit-snapshot__bar { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 8px; }
</style>