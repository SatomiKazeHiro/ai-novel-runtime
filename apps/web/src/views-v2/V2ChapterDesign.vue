<template>
  <div>
    <header class="page-head">
      <div class="page-head__text">
        <span class="cap-eyebrow is-accent">V2 · CHAPTER DESIGN</span>
        <h1 class="page-head__title">
          <n-button size="small" style="margin-right: 8px" @click="goBack">←</n-button>
          {{ chapter?.title || '章节设计' }}
          <n-tag v-if="chapter" :type="statusTagType(chapter.status)" :bordered="false" size="small" style="margin-left: 12px; vertical-align: middle">
            {{ statusLabel(chapter.status) }}
          </n-tag>
        </h1>
      </div>
    </header>

    <div v-if="loading" style="padding: 40px; text-align: center; color: var(--text-tertiary)">加载中...</div>

    <template v-else-if="chapter">
      <div class="design-grid">
        <!-- 左栏：正文编辑 -->
        <div class="design-main">
          <div class="cap-card" style="margin-bottom: 16px">
            <h2 class="cap-eyebrow" style="margin-top: 0">正文</h2>
            <n-input
              v-model:value="content"
              type="textarea"
              :rows="18"
              placeholder="直接输入正文，或使用下方生成区生产候选文章..."
              :disabled="chapter.status === 'archived'"
              style="font-family: var(--font-serif); font-size: 14px; line-height: 1.8"
            />
            <div v-if="chapter.status !== 'archived'" style="margin-top: 12px; display: flex; justify-content: space-between; align-items: center">
              <span v-if="saveMsg" style="font-size: 12px; color: var(--text-tertiary)">{{ saveMsg }}</span>
              <span v-else></span>
              <n-button type="primary" size="small" @click="saveContent" :loading="saving">保存正文</n-button>
            </div>
            <div v-if="chapter.contentHash" style="margin-top: 8px; font-size: 11px; color: var(--text-tertiary); font-family: monospace">
              SHA256: {{ chapter.contentHash.substring(0, 16) }}...
            </div>
          </div>

          <!-- 生成区 -->
          <div class="cap-card" style="margin-bottom: 16px">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px">
              <h2 class="cap-eyebrow" style="margin: 0">候选生成</h2>
              <n-button
                v-if="chapter.status !== 'archived'"
                size="small"
                type="primary"
                @click="startGeneration"
                :disabled="generatingCount >= 3"
              >
                生成候选 ({{ generatingCount }}/3)
              </n-button>
            </div>

            <p v-if="drafts.length === 0" class="cap-body-sm" style="color: var(--text-tertiary)">
              点击"生成候选"开始 AI 写作，每次生成一个候选文章。
            </p>

            <div
              v-for="draft in drafts"
              :key="draft.id"
              class="draft-card"
              :class="{ 'draft-card--generating': draft.status === 'generating' }"
            >
              <div class="draft-card__head">
                <span class="draft-card__label">
                  候选 {{ draft.id.substring(0, 8) }}
                  <n-tag v-if="draft.status === 'generating'" type="warning" size="tiny" :bordered="false">生成中</n-tag>
                  <n-tag v-else-if="draft.status === 'completed'" type="success" size="tiny" :bordered="false">已完成</n-tag>
                  <n-tag v-else-if="draft.status === 'failed'" type="error" size="tiny" :bordered="false">失败</n-tag>
                </span>
                <span class="draft-card__actions">
                  <n-button v-if="draft.status === 'completed'" size="tiny" @click="adoptDraft(draft)" style="margin-right: 4px">采用</n-button>
                  <n-popconfirm @positive-click="draft.status === 'generating' ? cancelGeneration(draft.id) : deleteDraft(draft.id)">
                    <template #trigger><n-button size="tiny" type="error">删除</n-button></template>
                    {{ draft.status === 'generating' ? '确定终止生成并删除吗？' : '确定删除该候选吗？' }}
                  </n-popconfirm>
                </span>
              </div>
              <div class="draft-card__body">
                <pre v-if="draft.content" class="draft-content">{{ draft.content }}</pre>
                <p v-else-if="draft.status === 'generating'" style="color: var(--text-tertiary); font-style: italic">等待 AI 响应...</p>
                <p v-else-if="draft.status === 'failed'" style="color: var(--color-negative)">生成失败</p>
              </div>
            </div>
          </div>

          <!-- 分析区 -->
          <div class="cap-card" style="margin-bottom: 16px">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px">
              <h2 class="cap-eyebrow" style="margin: 0">AI 分析</h2>
              <n-button
                v-if="chapter.status === 'draft' && analysis"
                size="small"
                type="primary"
                @click="saveAnalysis"
                :loading="savingAnalysis"
              >
                保存分析
              </n-button>
            </div>

            <p v-if="!analysis" class="cap-body-sm" style="color: var(--text-tertiary); margin-bottom: 12px">
              执行下方各维度分析后，点击"保存分析"锁定分析版本。
            </p>

            <!-- 分析状态 -->
            <div v-if="analysis" class="analysis-status" style="margin-bottom: 12px; font-size: 12px; color: var(--text-tertiary)">
              分析版本：
              <span :style="{ color: analysisId === chapter.contentHash ? 'var(--color-positive)' : 'var(--color-negative)' }">
                {{ analysisId ? analysisId.substring(0, 8) + '...' : '未保存' }}
              </span>
              <span v-if="analysisId !== chapter.contentHash" style="color: var(--color-negative); margin-left: 8px">正文已修改，分析可能过时</span>
            </div>

            <div class="analyzer-grid">
              <div class="analyzer-item" v-for="btn in analyzerBtns" :key="btn.key">
                <n-button
                  size="tiny"
                  @click="runAnalyzer(btn.key)"
                  :loading="analyzing === btn.key"
                  :disabled="!!(analyzing || chapter.status === 'archived')"
                  :type="analysis?.[btn.resultKey] ? 'info' : 'default'"
                >
                  {{ btn.label }}
                </n-button>
                <span class="analyzer-result">
                  {{ analyzerResultText(btn.key) }}
                </span>
              </div>
            </div>
          </div>
        </div>

        <!-- 右栏：配置 + 操作 -->
        <div class="design-side">
          <div class="cap-card" style="margin-bottom: 16px">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px">
              <h2 class="cap-eyebrow" style="margin: 0">Prompt 配置</h2>
              <n-button v-if="chapter.status !== 'archived'" size="tiny" @click="generateConfig" :loading="configLoading">
                重新生成
              </n-button>
            </div>
            <template v-if="parsedConfig">
              <div class="config-summary">
                <div class="config-item">
                  <span class="config-label">角色</span>
                  <span class="config-val">{{ parsedConfig.characterIds?.length || 0 }} 个</span>
                </div>
                <div class="config-item">
                  <span class="config-label">记忆</span>
                  <span class="config-val">{{ parsedConfig.memoryTypeIds?.length || 0 }} 条</span>
                </div>
                <div class="config-item">
                  <span class="config-label">剧情弧线</span>
                  <span class="config-val">{{ parsedConfig.plotArcIds?.length || 0 }} 条</span>
                </div>
                <div class="config-item">
                  <span class="config-label">世界观</span>
                  <span class="config-val">{{ parsedConfig.loreIds?.length || 0 }} 条</span>
                </div>
              </div>
              <div v-if="parsedConfig.outline" style="margin-top: 8px">
                <span class="config-label">大纲</span>
                <p style="font-size: 13px; color: var(--text-secondary); margin: 4px 0 0">{{ parsedConfig.outline }}</p>
              </div>
            </template>
            <p v-else class="cap-body-sm" style="color: var(--text-tertiary)">
              暂无配置，点击"生成配置"从当前数据自动填充。
            </p>
          </div>

          <!-- 归档操作 -->
          <div class="cap-card">
            <h2 class="cap-eyebrow" style="margin-top: 0">归档</h2>
            <p class="cap-body-sm" style="color: var(--text-tertiary); margin-bottom: 12px">
              归档后正文锁定，信息写入数据库。需先完成分析并保存。
            </p>
            <n-button
              type="primary"
              size="small"
              @click="doArchive"
              :loading="archiving"
              :disabled="!analysis || chapter.status === 'archived'"
              block
            >
              {{ chapter.status === 'archived' ? '已归档' : '归档' }}
            </n-button>
          </div>

          <!-- 归档确认弹窗 -->
          <n-modal v-model:show="showArchiveModal" title="归档确认" preset="card" style="width: 480px">
            <template v-if="archiveStep === 1 && hashMismatch">
              <p style="color: var(--color-negative); margin-bottom: 12px">
                正文已修改但未重新分析（正文哈希与分析版本不一致）。
              </p>
              <p style="margin-bottom: 16px">是否继续归档？建议先重新分析以确保数据一致。</p>
              <n-space justify="end">
                <n-button @click="showArchiveModal = false">取消</n-button>
                <n-button type="warning" @click="archiveStep = 2">继续归档</n-button>
              </n-space>
            </template>

            <template v-else-if="archiveStep <= 2 && newCharacters.length > 0">
              <p style="margin-bottom: 8px">归档将新增以下角色：</p>
              <ul style="margin-bottom: 16px; padding-left: 20px">
                <li v-for="c in newCharacters" :key="c.slug">
                  <strong>{{ c.name }}</strong>（{{ c.slug }}）
                  <span v-if="c.identity?.length"> — {{ c.identity.join('、') }}</span>
                </li>
              </ul>
              <n-space justify="end">
                <n-button @click="showArchiveModal = false">取消</n-button>
                <n-button type="primary" @click="archiveStep = 3">确认</n-button>
              </n-space>
            </template>

            <template v-else>
              <p style="margin-bottom: 12px">即将归档，归档后章节内容锁定不可修改。</p>
              <p style="color: var(--text-tertiary); font-size: 12px; margin-bottom: 16px">是否继续？</p>
              <n-space justify="end">
                <n-button @click="showArchiveModal = false">取消</n-button>
                <n-button type="primary" style="margin-left: 24px" @click="confirmArchive">确认归档</n-button>
              </n-space>
            </template>
          </n-modal>
        </div>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { NButton, NInput, NTag, NModal, NSpace, NPopconfirm } from 'naive-ui'
import { v2ChaptersApi } from '../api-v2/chapters'

const statusLabels: Record<string, string> = {
  draft: '草稿', generating: '生成中', analyzing: '分析中', archived: '已归档'
}
const statusTagTypes: Record<string, 'default' | 'warning' | 'info' | 'success'> = {
  draft: 'default', generating: 'warning', analyzing: 'info', archived: 'success'
}

const route = useRoute()
const router = useRouter()
const chapter = ref<any>(null)
const loading = ref(false)
const saving = ref(false)
const configLoading = ref(false)
const content = ref('')
const saveMsg = ref('')
const drafts = ref<any[]>([])
const activeControllers = new Map<string, AbortController>()

// 分析
const analysis = ref<any>(null)
const analysisId = ref<string | null>(null)
const analyzing = ref<string | null>(null)
const savingAnalysis = ref(false)
const hashMismatch = ref(false)
const newCharacters = ref<any[]>([])

// 归档
const archiving = ref(false)
const showArchiveModal = ref(false)
const archiveStep = ref(1)

const analyzerBtns = [
  { key: 'characters', label: '角色', resultKey: 'characters' },
  { key: 'memories', label: '记忆', resultKey: 'memories' },
  { key: 'plotArcs', label: '剧情弧线', resultKey: 'plotArcs' },
  { key: 'timeline', label: '时间线', resultKey: 'timeline' },
  { key: 'graph', label: '图谱', resultKey: 'graph' },
]

const generatingCount = computed(() => drafts.value.filter(d => d.status === 'generating').length)

const parsedConfig = computed(() => {
  const raw = chapter.value?.config
  if (!raw || raw === '{}') return null
  try {
    return typeof raw === 'string' ? JSON.parse(raw) : raw
  } catch { return null }
})

function statusLabel(s: string) { return statusLabels[s] || s }
function statusTagType(s: string) { return statusTagTypes[s] || 'default' }

function goBack() {
  const sid = route.params.storyId as string
  router.push(`/novel-design-v2/${sid}/chapters`)
}

async function loadChapter() {
  const chapterId = route.params.chapterId as string
  if (!chapterId) return
  loading.value = true
  try {
    const res = await v2ChaptersApi.detail(chapterId)
    chapter.value = res.data.data
    content.value = chapter.value?.content || ''
  } finally { loading.value = false }
}

async function saveContent() {
  const chapterId = route.params.chapterId as string
  if (!chapterId) return
  saving.value = true
  saveMsg.value = ''
  try {
    const res = await v2ChaptersApi.update(chapterId, { content: content.value })
    chapter.value = res.data.data
    saveMsg.value = '正文已保存'
    setTimeout(() => { saveMsg.value = '' }, 2000)
  } finally { saving.value = false }
}

async function generateConfig() {
  const chapterId = route.params.chapterId as string
  if (!chapterId) return
  configLoading.value = true
  try {
    const res = await v2ChaptersApi.generateConfig(chapterId)
    if (res.data.data) {
      chapter.value.config = JSON.stringify(res.data.data)
    }
  } finally { configLoading.value = false }
}

async function loadDrafts() {
  const chapterId = route.params.chapterId as string
  if (!chapterId) return
  try {
    const res = await v2ChaptersApi.listDrafts(chapterId)
    drafts.value = res.data.data ?? []
  } catch { /* 静默 */ }
}

async function startGeneration() {
  const chapterId = route.params.chapterId as string
  if (!chapterId || generatingCount.value >= 3) return

  // 先占位一个 generating draft，等 SSE 返回 draftId 后再替换
  const placeholderId = `pending-${Date.now()}`
  const placeholderDraft = { id: placeholderId, content: '', status: 'generating' }
  drafts.value.push(placeholderDraft)

  const controller = new AbortController()
  activeControllers.set(placeholderId, controller)

  try {
    const response = await v2ChaptersApi.generateStream(chapterId, controller.signal)
    if (!response.ok) {
      // 替换占位
      const idx = drafts.value.findIndex(d => d.id === placeholderId)
      if (idx >= 0) drafts.value[idx] = { ...placeholderDraft, status: 'failed' }
      return
    }

    const reader = response.body?.getReader()
    if (!reader) {
      const idx = drafts.value.findIndex(d => d.id === placeholderId)
      if (idx >= 0) drafts.value[idx] = { ...placeholderDraft, status: 'failed' }
      return
    }

    const decoder = new TextDecoder()
    let buffer = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      // SSE 消息以 \n\n 分隔
      const messages = buffer.split('\n\n')
      buffer = messages.pop() || ''

      for (const msg of messages) {
        const lines = msg.split('\n')
        let eventName = ''
        let eventData = ''

        for (const line of lines) {
          const trimmed = line.trim()
          if (trimmed.startsWith('event:')) eventName = trimmed.slice(6).trim()
          else if (trimmed.startsWith('data:')) eventData = trimmed.slice(5).trim()
        }

        if (!eventData) continue

        try {
          const payload = JSON.parse(eventData)
          const draftId = payload.draftId

          // 首个带真实 draftId 的消息，替换占位 ID
          if (draftId && placeholderId !== draftId) {
            const idx = drafts.value.findIndex(d => d.id === placeholderId)
            if (idx >= 0) drafts.value[idx] = { ...drafts.value[idx], id: draftId }
            activeControllers.delete(placeholderId)
            activeControllers.set(draftId, controller)
          }

          const targetId = draftId || placeholderId
          const idx = drafts.value.findIndex(d => d.id === targetId)
          if (idx < 0) continue

          if (eventName === 'draft-chunk') {
            drafts.value[idx] = { ...drafts.value[idx], content: (drafts.value[idx].content || '') + payload.delta }
          } else if (eventName === 'draft-done') {
            drafts.value[idx] = { ...drafts.value[idx], status: 'completed', content: drafts.value[idx].content || '' }
          } else if (eventName === 'draft-error') {
            drafts.value[idx] = { ...drafts.value[idx], status: 'failed' }
          }
        } catch { /* skip parse errors */ }
      }
    }
  } catch (err: any) {
    if (err.name === 'AbortError') {
      // 用户手动取消，直接从列表移除
      drafts.value = drafts.value.filter(d => d.id !== placeholderId)
    } else {
      const idx = drafts.value.findIndex(d => d.id === placeholderId)
      if (idx >= 0) drafts.value[idx] = { ...placeholderDraft, status: 'failed' }
    }
  } finally {
    activeControllers.delete(placeholderId)
  }
}

function cancelGeneration(draftId: string) {
  const controller = activeControllers.get(draftId)
  if (controller) {
    controller.abort()
    activeControllers.delete(draftId)
  }
  // 也删掉 draft 行
  v2ChaptersApi.deleteDraft(draftId).catch(() => {})
  drafts.value = drafts.value.filter(d => d.id !== draftId)
}

async function deleteDraft(draftId: string) {
  await v2ChaptersApi.deleteDraft(draftId)
  drafts.value = drafts.value.filter(d => d.id !== draftId)
}

function adoptDraft(draft: any) {
  content.value = draft.content
  saveMsg.value = '已采用候选内容到正文编辑区，记得保存正文'
  setTimeout(() => { saveMsg.value = '' }, 3000)
}

// ── 分析 ──

async function loadAnalysis() {
  const chapterId = route.params.chapterId as string
  if (!chapterId) return
  try {
    const res = await v2ChaptersApi.getAnalysis(chapterId)
    if (res.data.data) {
      analysis.value = res.data.data.analysis
      analysisId.value = res.data.data.analysisId
      hashMismatch.value = res.data.data.isStale
    }
  } catch { /* 静默 */ }
}

function analyzerResultText(key: string) {
  if (!analysis.value) return ''
  const data = analysis.value[key]
  if (!data) return '未分析'

  switch (key) {
    case 'characters': {
      const items = data.items || []
      const newCount = items.filter((c: any) => c.isNew).length
      return `已分析 (${items.length} 个角色${newCount > 0 ? `，${newCount} 个新角色` : ''})`
    }
    case 'memories': {
      const c = (data.chapterMemories || []).length
      const g = (data.globalMemories || []).length
      const s = (data.sceneMemories || []).length
      return `已分析 (章节${c} + 全局${g} + 场景${s})`
    }
    case 'plotArcs': {
      const arcs = data.arcs || []
      const create = arcs.filter((a: any) => a.action === 'create').length
      const update = arcs.filter((a: any) => a.action === 'update').length
      return `已分析 (新增${create} + 更新${update})`
    }
    case 'timeline':
      return '已分析 (空)'
    case 'graph':
      return '已分析 (空)'
    default:
      return '已分析'
  }
}

async function runAnalyzer(key: string) {
  const chapterId = route.params.chapterId as string
  if (!chapterId || analyzing.value) return

  analyzing.value = key
  try {
    const apiMap: Record<string, (id: string) => Promise<any>> = {
      characters: v2ChaptersApi.analyzeCharacters,
      memories: v2ChaptersApi.analyzeMemories,
      plotArcs: v2ChaptersApi.analyzePlotArcs,
      timeline: v2ChaptersApi.analyzeTimeline,
      graph: v2ChaptersApi.analyzeGraph
    }
    await apiMap[key](chapterId)
    // 重新加载分析结果
    await loadAnalysis()
  } catch { /* 静默 */ } finally {
    analyzing.value = null
  }
}

async function saveAnalysis() {
  const chapterId = route.params.chapterId as string
  if (!chapterId) return
  savingAnalysis.value = true
  try {
    await v2ChaptersApi.saveAnalysis(chapterId)
    await loadAnalysis()
    // 同时刷新 chapter 状态
    const res = await v2ChaptersApi.detail(chapterId)
    chapter.value = res.data.data
  } catch { /* 静默 */ } finally {
    savingAnalysis.value = false
  }
}

// ── 归档 ──

async function doArchive() {
  const chapterId = route.params.chapterId as string
  if (!chapterId) return

  // 先加载最新的分析状态
  await loadAnalysis()

  // 重置步骤
  archiveStep.value = 1

  // 加载 new characters
  try {
    const res = await v2ChaptersApi.preArchive(chapterId)
    if (res.data.data) {
      hashMismatch.value = res.data.data.hashMismatch
      newCharacters.value = res.data.data.newCharacters || []
    }
  } catch { /* 静默 */ }

  // 决定第一步
  if (hashMismatch.value) {
    archiveStep.value = 1
  } else if (newCharacters.value.length > 0) {
    archiveStep.value = 2
  } else {
    archiveStep.value = 3
  }

  showArchiveModal.value = true
}

async function confirmArchive() {
  const chapterId = route.params.chapterId as string
  if (!chapterId) return
  archiving.value = true
  showArchiveModal.value = false
  try {
    await v2ChaptersApi.archive(chapterId)
    // 刷新章节
    const res = await v2ChaptersApi.detail(chapterId)
    chapter.value = res.data.data
    analysis.value = null
    analysisId.value = null
    newCharacters.value = []
  } catch { /* 静默 */ } finally {
    archiving.value = false
  }
}

watch(() => route.params.chapterId, () => { loadChapter(); loadDrafts(); loadAnalysis() })
onMounted(() => {
  if (route.params.chapterId) { loadChapter(); loadDrafts(); loadAnalysis() }
})
</script>

<style scoped>
.design-grid {
  display: grid;
  grid-template-columns: 1fr 360px;
  gap: 20px;
  align-items: start;
}
.config-summary {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.config-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 14px;
}
.config-label {
  color: var(--text-tertiary);
}
.config-val {
  font-weight: var(--weight-semibold);
  color: var(--color-ink-black);
}
.draft-card {
  border: 1px solid var(--border-color);
  border-radius: 8px;
  padding: 12px;
  margin-bottom: 10px;
}
.draft-card--generating {
  border-color: var(--color-warning);
  background: var(--color-warning-bg, #fff8e1);
}
.draft-card__head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
}
.draft-card__label {
  font-size: 13px;
  font-weight: var(--weight-semibold);
  display: flex;
  align-items: center;
  gap: 6px;
}
.draft-card__actions {
  display: flex;
  align-items: center;
}
.draft-card__body {
  max-height: 300px;
  overflow-y: auto;
}
.draft-content {
  font-family: var(--font-serif);
  font-size: 13px;
  line-height: 1.8;
  white-space: pre-wrap;
  word-break: break-word;
  margin: 0;
  color: var(--text-primary);
}
.analyzer-grid {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.analyzer-item {
  display: flex;
  align-items: center;
  gap: 10px;
}
.analyzer-result {
  font-size: 12px;
  color: var(--text-tertiary);
}
.analysis-status {
  padding: 6px 10px;
  background: var(--bg-subtle);
  border-radius: 4px;
  font-family: monospace;
}
</style>
