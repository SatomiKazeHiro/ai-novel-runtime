<template>
  <div>
    <header class="page-head">
      <div class="page-head__text">
        <span class="cap-eyebrow is-accent">V2 · CHAPTER DESIGN</span>
        <h1 class="page-head__title">
          <n-button size="small" style="margin-right: 8px" @click="goBack">←</n-button>
          <n-input
            v-if="chapter"
            v-model:value="editTitle"
            size="small"
            :disabled="chapter.status === 'archived'"
            placeholder="章节标题"
            style="width: 320px; vertical-align: middle"
          />
          <span v-else>章节设计</span>
          <n-tag v-if="chapter" :type="statusTagType(chapter.status)" :bordered="false" size="small" style="margin-left: 12px; vertical-align: middle">
            {{ statusLabel(chapter.status) }}
          </n-tag>
          <span v-if="savingTitle" style="font-size: 11px; color: var(--text-tertiary); margin-left: 8px; vertical-align: middle">保存中...</span>
        </h1>
      </div>
    </header>

    <div v-if="loading" style="padding: 40px; text-align: center; color: var(--text-tertiary)">加载中...</div>

    <template v-else-if="chapter">
      <div v-if="toastMsg" class="toast-bar" :class="toastType">{{ toastMsg }}</div>

      <div class="design-flow">

        <!-- ====== Step 1: 大纲 ====== -->
        <div class="cap-card">
          <h2 class="cap-eyebrow" style="margin: 0; margin-bottom: 8px">1. 大纲</h2>
          <n-input
            v-model:value="outline"
            type="textarea"
            :rows="15"
            placeholder="本章大纲，将作为输入拼入生成 prompt..."
            :disabled="chapter.status !== 'draft'"
            style="font-size: 13px; line-height: 1.6"
          />
          <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 8px">
            <span style="font-size: 11px; color: var(--text-tertiary)">字数：{{ outline.length }}</span>
            <n-button
              v-if="chapter.status === 'draft'"
              size="tiny"
              @click="saveOutline"
              :loading="savingOutline"
            >保存大纲</n-button>
          </div>
          <p v-if="chapter.status === 'draft' && !outline.trim()" style="font-size: 11px; color: var(--color-negative); margin: 4px 0 0">
            请先填写并保存大纲
          </p>
        </div>

        <!-- ====== Step 2: 数据源（大纲保存后出现） ====== -->
        <div v-if="step >= 2" class="cap-card">
          <h2 class="cap-eyebrow" style="margin-top: 0; margin-bottom: 10px">2. 数据源</h2>
          <n-tabs type="segment" animated>
            <n-tab-pane name="characters">
              <template #tab>
                角色 <span style="color: var(--text-tertiary); font-size: 11px">({{ configCharacterIds.length }})</span>
              </template>
              <div class="tab-content">
                <div style="margin-bottom: 8px">
                  <n-button
                    size="tiny"
                    :disabled="chapter.status !== 'draft' || !outline.trim()"
                    @click="onCharacterAutoSelect"
                  >系统分配</n-button>
                  <span v-if="!outline.trim()" style="font-size: 10px; color: var(--text-tertiary); margin-left: 6px">需先保存大纲</span>
                </div>
                <n-checkbox-group v-model:value="configCharacterIds" :disabled="chapter.status !== 'draft'">
                  <n-space vertical>
                    <n-checkbox v-for="c in availableCharacters" :key="c.id" :value="c.id">
                      {{ c.name }}
                      <span v-if="c.isProtagonist" style="color: var(--accent); font-size: 11px">[主角]</span>
                      <span style="color: var(--text-tertiary); font-size: 11px; margin-left: 4px">{{ c.slug }}</span>
                    </n-checkbox>
                  </n-space>
                </n-checkbox-group>
                <n-empty v-if="availableCharacters.length === 0" description="暂无角色" style="padding: 12px" />
              </div>
            </n-tab-pane>

            <n-tab-pane name="memories">
              <template #tab>
                记忆 <span style="color: var(--text-tertiary); font-size: 11px">({{ configMemoryIds.length }})</span>
              </template>
              <div class="tab-content">
                <div style="margin-bottom: 8px">
                  <n-button
                    size="tiny"
                    :disabled="chapter.status !== 'draft' || !outline.trim()"
                    :loading="searchingMemories"
                    @click="onMemorySearch"
                  >系统分配</n-button>
                  <span v-if="!outline.trim()" style="font-size: 10px; color: var(--text-tertiary); margin-left: 6px">需先保存大纲</span>
                </div>
                <n-checkbox-group v-model:value="configMemoryIds" :disabled="chapter.status !== 'draft'">
                  <n-space vertical>
                    <n-checkbox v-for="m in availableMemories" :key="m.id" :value="m.id">
                      <span :style="{ color: m.type === 'temporary' ? 'var(--accent)' : 'inherit' }">
                        [{{ m.type === 'global' ? '全局' : m.type === 'chapter' ? '章节' : m.type === 'scene' ? '场景' : '临时' }}]
                      </span>
                      <span style="font-size: 10px; color: var(--text-tertiary); margin: 0 2px">(重要度·{{ m.importance }})</span>
                      {{ m.content?.substring(0, 35) || m.id.substring(0, 8) }}
                    </n-checkbox>
                  </n-space>
                </n-checkbox-group>
                <n-empty v-if="availableMemories.length === 0" description="暂无记忆" style="padding: 12px" />
              </div>
            </n-tab-pane>

            <n-tab-pane name="plotArcs">
              <template #tab>
                剧情弧线 <span style="color: var(--text-tertiary); font-size: 11px">({{ configPlotArcIds.length }})</span>
              </template>
              <div class="tab-content">
                <n-checkbox-group v-model:value="configPlotArcIds" :disabled="chapter.status !== 'draft'">
                  <n-space vertical>
                    <n-checkbox v-for="a in availablePlotArcs" :key="a.id" :value="a.id">
                      {{ a.title }}
                      <span style="font-size: 11px; margin-left: 4px" :style="{ color: a.status === 'active' ? 'var(--accent)' : 'var(--text-tertiary)' }">
                        [{{ a.status === 'active' ? '活跃' : a.status === 'interrupted' ? '中断' : a.status === 'completed' ? '完成' : '关闭' }}]
                      </span>
                    </n-checkbox>
                  </n-space>
                </n-checkbox-group>
                <n-empty v-if="availablePlotArcs.length === 0" description="暂无剧情弧线" style="padding: 12px" />
              </div>
            </n-tab-pane>

            <n-tab-pane name="lore">
              <template #tab>
                世界观 <span style="color: var(--text-tertiary); font-size: 11px">({{ configLoreIds.length }})</span>
              </template>
              <div class="tab-content">
                <n-checkbox-group v-model:value="configLoreIds" :disabled="chapter.status !== 'draft'">
                  <n-space vertical>
                    <n-checkbox v-for="l in availableLore" :key="l.id" :value="l.id">
                      <span style="font-size: 11px; color: var(--text-tertiary); font-family: monospace">{{ l.category }}/</span>
                      {{ l.name }}
                    </n-checkbox>
                  </n-space>
                </n-checkbox-group>
                <n-empty v-if="availableLore.length === 0" description="暂无世界观条目" style="padding: 12px" />
              </div>
            </n-tab-pane>
          </n-tabs>

          <div style="display: flex; justify-content: flex-end; margin-top: 16px">
            <n-button
              v-if="chapter.status === 'draft'"
              type="primary"
              @click="onTriggerGeneratePrompt"
              :loading="generatingPrompt"
              :disabled="generatingPrompt || !outline.trim() || !step3Ref"
            >生成 Prompt</n-button>
          </div>
        </div>

        <!-- ====== Step 3: 子组件 ====== -->
        <template v-if="step >= 2">
          <V2Step3Panel
            ref="step3Ref"
            :chapter="chapter"
            :outline="outline"
            :content="content"
            :saving="saving"
            :show-toast="showToast"
            :config="chapterConfig"
            @update:content="(v) => content = v"
            @save-content="saveContent"
            @adopt-draft="(c) => { content = c; showToast('已采用候选内容到正文编辑区，记得保存正文') }"
            @step-updated="updateStep"
          />
        </template>

        <!-- ====== Step 4: 子组件 ====== -->
        <template v-if="step >= 4">
          <V2Step4Panel
            ref="step4Ref"
            :chapter="chapter"
            :analysis="analysis"
            :analyze-running="analyzeRunning"
            :regenerating="regenerating"
            :reverting="reverting"
            :archive-errors="archiveErrors"
            :show-toast="showToast"
            @run-analyze="runAnalyze"
            @regenerate-single="regenerateSingle"
            @revert="revertAnalysis"
            @save-edits="onSaveEdits"
          />
        </template>

        <!-- ====== Step 5: 归档 ====== -->
        <div v-if="step >= 5" class="cap-card">
          <h2 class="cap-eyebrow" style="margin-top: 0">5. 归档</h2>
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
          >{{ chapter.status === 'archived' ? '已归档' : '归档' }}</n-button>
        </div>

        <!-- 归档确认弹窗 -->
        <n-modal v-model:show="showArchiveModal" title="归档确认" preset="card" style="width: 480px">
          <template v-if="archiveErrors && Object.keys(archiveErrors).length > 0">
            <p style="color: var(--color-negative); margin-bottom: 8px; font-weight: 600">分析中存在失败项，无法归档：</p>
            <ul style="margin-bottom: 16px; padding-left: 20px; line-height: 1.8">
              <li v-for="(msg, key) in archiveErrors" :key="key">
                <strong>{{ analyzerLabels[key] || key }}</strong>：{{ msg }}
              </li>
            </ul>
            <n-space justify="end">
              <n-button @click="showArchiveModal = false">关闭</n-button>
              <n-button type="primary" :loading="analyzeRunning" @click="reAnalyzeFailed">
                重新分析失败项
              </n-button>
            </n-space>
          </template>
          <template v-else-if="archiveStep === 1 && hashMismatch">
            <p style="color: var(--color-negative); margin-bottom: 12px">正文已修改但未重新分析（正文哈希与分析版本不一致）。</p>
            <p style="margin-bottom: 16px">是否继续归档？建议先重新分析以确保数据一致。</p>
            <n-space justify="end">
              <n-button @click="showArchiveModal = false">取消</n-button>
              <n-button type="warning" @click="archiveStep = 2">继续归档</n-button>
            </n-space>
          </template>
          <template v-else-if="archiveStep <= 2 && newCharacters.length > 0">
            <p style="margin-bottom: 8px">归档将新增以下角色：</p>
            <ul style="margin-bottom: 16px; padding-left: 20px">
              <li v-for="c in newCharacters" :key="c.slug"><strong>{{ c.name }}</strong>（{{ c.slug }}）<span v-if="c.identity?.length"> — {{ c.identity.join('、') }}</span></li>
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
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch, nextTick } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { NButton, NInput, NTag, NModal, NSpace, NCheckbox, NCheckboxGroup, NEmpty, NTabs, NTabPane } from 'naive-ui'
import { v2ChaptersApi } from '../api-v2/chapters'
import { useChapterConfig } from '../composables-v2/useChapterConfig'
import V2Step3Panel from './_components/V2Step3Panel.vue'
import V2Step4Panel from './_components/V2Step4Panel.vue'

const statusLabels: Record<string, string> = {
  draft: '草稿', generating: '生成中', analyzing: '分析中', archived: '已归档'
}
const statusTagTypes: Record<string, 'default' | 'warning' | 'info' | 'success'> = {
  draft: 'default', generating: 'warning', analyzing: 'info', archived: 'success'
}

const analyzerLabels: Record<string, string> = {
  characters: '角色', memories: '记忆', plotArcs: '剧情弧线', timeline: '时间线', graph: '图谱'
}

const route = useRoute()
const router = useRouter()
const chapter = ref<any>(null)
const loading = ref(false)
const content = ref('')
const outline = ref('')
const toastMsg = ref('')
const toastType = ref<'success' | 'error' | 'warning'>('success')
const savingOutline = ref(false)
const saving = ref(false)
const editTitle = ref('')
const savingTitle = ref(false)
let isTitleInitialized = false
let titleSaveTimer: ReturnType<typeof setTimeout> | null = null
const step = ref(1)

const step3Ref = ref<InstanceType<typeof V2Step3Panel> | null>(null)
const step4Ref = ref<InstanceType<typeof V2Step4Panel> | null>(null)

const generatingPrompt = ref(false)

const analysis = ref<any>(null)
const analyzeRunning = ref(false)
const regenerating = ref<string | null>(null)
const reverting = ref(false)
const hashMismatch = ref(false)

const archiving = ref(false)
const showArchiveModal = ref(false)
const archiveStep = ref(1)
const archiveErrors = ref<Record<string, string> | null>(null)
const newCharacters = ref<any[]>([])

/**
 * useChapterConfig 单一调用点（父级）。
 * 字段：configProviderId / configTemperature / configMaxTokens / configCharacterIds / configMemoryIds
 *       / configPlotArcIds / configLoreIds / availableCharacters / availableMemories / availablePlotArcs
 *       / availableLore / modelOptions / selectedModel / parsedConfig / searchingMemories
 *       / buildGenConfig / buildConfigForSave / loadAvailableSources / handleMemorySearch / applyConfig
 *
 * 整体作为 props.config 传给 Step3Panel；Step3Panel template 内部通过 .value 访问嵌套 ref（v-model 自动 unwrap），
 * ref/computed/function 字段与父级共享同一实例。
 */
const {
  availableCharacters, availableMemories, availablePlotArcs, availableLore,
  configCharacterIds, configMemoryIds, configPlotArcIds, configLoreIds,
  searchingMemories,
  modelOptions, selectedModel, parsedConfig,
  configProviderId, configTemperature, configMaxTokens,
  buildGenConfig, buildConfigForSave, loadAvailableSources, handleMemorySearch
} = useChapterConfig(
  () => route.params.storyId as string,
  () => route.params.chapterId as string,
  chapter
)

// 打包成 reactive object 传给 Step3Panel（template 中 Vue 3 自动 unwrap nested ref for v-model）
import { reactive } from 'vue'
const chapterConfig = reactive({
  configProviderId,
  configTemperature,
  configMaxTokens,
  configCharacterIds,
  configMemoryIds,
  configPlotArcIds,
  configLoreIds,
  availableCharacters,
  availableMemories,
  availablePlotArcs,
  availableLore,
  modelOptions,
  selectedModel,
  parsedConfig,
  searchingMemories,
  buildGenConfig,
  buildConfigForSave,
  loadAvailableSources,
  handleMemorySearch,
  applyConfig: () => { /* 占位 — useChapterConfig 不暴露 applyConfig */ }
})

function statusLabel(s: string) { return statusLabels[s] || s }
function statusTagType(s: string) { return statusTagTypes[s] || 'default' }

function goBack() {
  const sid = route.params.storyId as string
  router.push(`/novel-design-v2/${sid}/chapters`)
}

let toastTimer: ReturnType<typeof setTimeout> | null = null
function showToast(msg: string, type: 'success' | 'error' | 'warning' = 'success') {
  toastMsg.value = msg
  toastType.value = type
  if (toastTimer) clearTimeout(toastTimer)
  toastTimer = setTimeout(() => { toastMsg.value = '' }, 2500)
}

// 标题编辑：切章节时同步初值；用户改标题 → 防抖 500ms 自动保存
watch(() => chapter.value?.id, (id) => {
  if (id) {
    editTitle.value = chapter.value?.title || ''
    isTitleInitialized = true
  }
}, { immediate: true })
watch(editTitle, (v) => {
  if (!isTitleInitialized || !chapter.value) return
  if (v === chapter.value.title) return
  if (titleSaveTimer) clearTimeout(titleSaveTimer)
  titleSaveTimer = setTimeout(async () => {
    if (!chapter.value) return
    savingTitle.value = true
    try {
      const res = await v2ChaptersApi.update(chapter.value.id, { title: v })
      if (res.data.success) {
        chapter.value = (res.data as any).data.data
        showToast('标题已保存')
      } else {
        showToast((res.data as any).error || '保存失败', 'error')
      }
    } catch (err: any) {
      showToast(err?.message || '保存失败', 'error')
    } finally {
      savingTitle.value = false
    }
  }, 500)
})

function updateStep() {
  if (chapter.value?.status === 'archived') { step.value = 5; return }
  if (analysis.value) { step.value = 5; return }
  if (chapter.value?.content) { step.value = 4; return }
  if (step3Ref.value?.assembledPrompt || (step3Ref.value?.draftsLength?.() ?? 0) > 0) { step.value = 3; return }
  if (outline.value.trim() && parsedConfig.value && Object.keys(parsedConfig.value).length > 1) { step.value = 2; return }
  step.value = 1
}

async function loadChapter() {
  const chapterId = route.params.chapterId as string
  if (!chapterId) return
  loading.value = true
  try {
    const res = await v2ChaptersApi.detail(chapterId)
    chapter.value = (res as any).data.data
    content.value = chapter.value?.content || ''
    outline.value = chapter.value?.outline || ''
  } finally { loading.value = false }
}

async function loadAndApplyConfig() {
  await loadAvailableSources()
  updateStep()
}

function onMemorySearch() {
  handleMemorySearch(outline.value.trim(), showToast)
}

function onCharacterAutoSelect() {
  const text = outline.value.trim()
  if (!text) return
  const matched: string[] = []
  for (const c of availableCharacters.value) {
    const name = (c.name || '').trim()
    const slug = (c.slug || '').trim()
    if ((name && text.includes(name)) || (slug && text.includes(slug))) {
      matched.push(c.id)
    }
  }
  configCharacterIds.value = matched
  showToast(matched.length > 0 ? `大纲中匹配到 ${matched.length} 个角色` : '大纲中未匹配到角色名', matched.length > 0 ? 'success' : 'warning')
}

async function onTriggerGeneratePrompt() {
  if (!step3Ref.value?.triggerGeneratePrompt) return
  generatingPrompt.value = true
  try {
    await step3Ref.value.triggerGeneratePrompt()
  } finally {
    generatingPrompt.value = false
  }
}

async function saveContent() {
  const chapterId = route.params.chapterId as string
  if (!chapterId) return
  saving.value = true
  try {
    const res = await v2ChaptersApi.update(chapterId, { content: content.value })
    chapter.value = (res as any).data.data
    showToast('正文已保存')
    updateStep()
  } finally { saving.value = false }
}

async function saveOutline() {
  const chapterId = route.params.chapterId as string
  if (!chapterId) return
  savingOutline.value = true
  try {
    const res = await v2ChaptersApi.update(chapterId, { outline: outline.value })
    chapter.value = (res as any).data.data
    showToast('大纲已保存')
    updateStep()
  } finally { savingOutline.value = false }
}

async function loadAnalysis() {
  const chapterId = route.params.chapterId as string
  if (!chapterId) return
  try {
    const res = await v2ChaptersApi.getAnalysis(chapterId)
    if (res.data.data) {
      const a = res.data.data.analysis
      analysis.value = (a && typeof a === 'object' && Object.keys(a).length > 0) ? a : null
      hashMismatch.value = res.data.data.isStale
    }
    updateStep()
  } catch (err: any) {
    showToast(err?.message || '加载分析结果失败', 'error')
  }
}

async function runAnalyze() {
  const chapterId = route.params.chapterId as string
  if (!chapterId || analyzeRunning.value) return
  analyzeRunning.value = true
  try {
    const res = await v2ChaptersApi.analyze(chapterId)
    if (!res.success) { showToast(res.error || '分析失败', 'warning'); return }
    const { pending, allSuccess } = res.data
    analysis.value = pending
    if (allSuccess) {
      await refreshChapter()
      updateStep()
      showToast('全部分析完成')
    } else {
      const failed = Object.entries(pending).filter(([, v]: [any, any]) => v.status === 'failed').map(([k]) => analyzerLabels[k] || k)
      showToast(`${failed.join('、')} 分析失败`, 'warning')
    }
    step4Ref.value?.toastGraphWarnings?.(pending?.graph?.warnings)
  } catch (err: any) { showToast(err?.message || '分析请求失败', 'error') }
  finally { analyzeRunning.value = false }
}

async function regenerateSingle(key: string) {
  const chapterId = route.params.chapterId as string
  if (!chapterId || regenerating.value) return
  regenerating.value = key
  try {
    const res = await v2ChaptersApi.analyzeSingle(chapterId, key)
    if (!res.success) {
      showToast(`重新生成失败: ${res.error || '未知错误'}`, 'warning')
      return
    }
    await loadAnalysis()
    showToast(`${analyzerLabels[key]} 重新生成完成`)
    if (key === 'graph') step4Ref.value?.toastGraphWarnings?.(analysis.value?.graph?.warnings)
  } catch (err: any) { showToast(err?.message || '重新生成请求失败', 'error') }
  finally { regenerating.value = null }
}

async function revertAnalysis() {
  const chapterId = route.params.chapterId as string
  if (!chapterId) return
  reverting.value = true
  try {
    const res = await v2ChaptersApi.revertAnalysis(chapterId)
    if (!res.data.success) { showToast((res.data as any).error || '撤销分析失败', 'warning'); return }
    analysis.value = null
    await refreshChapter()
    updateStep()
    showToast('已撤销分析，恢复为草稿状态')
  } catch (err: any) { showToast(err?.message || '撤销分析请求失败', 'error') }
  finally { reverting.value = false }
}

async function onSaveEdits(payload: any) {
  const chapterId = route.params.chapterId as string
  if (!chapterId) return
  try {
    const res = await v2ChaptersApi.savePendingAnalysis(chapterId, payload)
    if (!res.data.success) { showToast(res.data.message || '保存调整失败', 'warning'); return }
    analysis.value = JSON.parse(JSON.stringify(payload))
    showToast('分析调整已保存')
    updateStep()
  } catch (err: any) { showToast(err?.message || '保存调整失败', 'error') }
}

async function refreshChapter() {
  const chapterId = route.params.chapterId as string
  if (!chapterId) return
  const res = await v2ChaptersApi.detail(chapterId)
  chapter.value = (res as any).data.data
}

async function doArchive() {
  const chapterId = route.params.chapterId as string
  if (!chapterId) return
  // 先把 Step4 子组件的当前编辑同步到 server，避免"删了角色但归档时又出现"
  // （doArchive 后续会从 server 拉 pendingAnalysis，若未同步会拿到旧版）
  if (step4Ref.value?.saveEdits) {
    await step4Ref.value.saveEdits()
  }
  await loadAnalysis()
  archiveStep.value = 1
  archiveErrors.value = null
  try {
    const res = await v2ChaptersApi.preArchive(chapterId)
    if (res.data.data) {
      hashMismatch.value = res.data.data.hashMismatch
      newCharacters.value = res.data.data.newCharacters || []
      archiveErrors.value = res.data.data.errors && Object.keys(res.data.data.errors).length > 0
        ? res.data.data.errors
        : null
    }
  } catch (err: any) {
    showToast(err?.message || '准备归档失败', 'error')
  }
  if (archiveErrors.value) { archiveStep.value = 0 }
  else if (hashMismatch.value) { archiveStep.value = 1 }
  else if (newCharacters.value.length > 0) { archiveStep.value = 2 }
  else { archiveStep.value = 3 }
  showArchiveModal.value = true
}

async function reAnalyzeFailed() {
  const chapterId = route.params.chapterId as string
  if (!chapterId || analyzeRunning.value) return
  const failedKeys = archiveErrors.value ? Object.keys(archiveErrors.value) : []
  if (failedKeys.length === 0) return
  analyzeRunning.value = true
  try {
    for (const key of failedKeys) {
      const res: any = await v2ChaptersApi.analyzeSingle(chapterId, key)
      if (!res?.success) { showToast(`${analyzerLabels[key]} 重抽失败: ${res?.error || '未知'}`, 'warning') }
    }
    await loadAnalysis()
    showArchiveModal.value = false
    archiveErrors.value = null
  } catch (err: any) {
    showToast(err?.message || '重新分析请求失败', 'error')
  } finally { analyzeRunning.value = false }
}

async function confirmArchive() {
  const chapterId = route.params.chapterId as string
  if (!chapterId) return
  archiving.value = true
  showArchiveModal.value = false
  try {
    await v2ChaptersApi.archive(chapterId)
    const res = await v2ChaptersApi.detail(chapterId)
    chapter.value = (res as any).data.data
    analysis.value = null
    newCharacters.value = []
    archiveErrors.value = null
  } catch (err: any) {
    const apiErr = err?.response?.data
    if (apiErr?.data?.errors) {
      archiveErrors.value = apiErr.data.errors
      showArchiveModal.value = true
      showToast('分析中存在失败项，无法归档', 'error')
    } else {
      showToast(err?.message || '归档失败', 'error')
    }
  } finally { archiving.value = false }
}

watch(() => route.params.chapterId, async () => {
  await loadChapter()
  await nextTick()
  await loadAndApplyConfig()
  await loadAnalysis()
})

onMounted(async () => {
  if (route.params.chapterId) {
    await loadChapter()
    await nextTick()
    await loadAndApplyConfig()
    await loadAnalysis()
  }
})

onUnmounted(() => {
  if (toastTimer) clearTimeout(toastTimer)
  if (titleSaveTimer) clearTimeout(titleSaveTimer)
})
</script>

<style scoped>
.toast-bar {
}
</style>