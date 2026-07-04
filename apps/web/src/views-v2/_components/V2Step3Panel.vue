<template>
  <!-- ====== AI 模型（左 1/3） + Prompt 预览（右 2/3） ====== -->
  <div class="split-row" style="grid-template-columns: 1fr 2fr">
    <!-- 左：AI 模型 -->
    <div class="cap-card">
      <h2 class="cap-eyebrow" style="margin-top: 0; margin-bottom: 10px">3. AI 模型</h2>
      <div class="config-field">
        <label class="config-field__label">模型</label>
        <n-select
          v-model:value="config.configProviderId"
          :options="config.modelOptions"
          placeholder="默认模型"
          clearable
          size="small"
          :disabled="chapter.status !== 'draft'"
        />
        <p v-if="config.selectedModel" style="font-size: 11px; color: var(--text-tertiary); margin: 2px 0 0">
          上下文: {{ (config.selectedModel.contextLength / 1000).toFixed(0) }}K
        </p>
      </div>
      <div class="config-field">
        <label class="config-field__label">Temperature</label>
        <div style="display: flex; align-items: center; gap: 8px">
          <n-slider
            v-model:value="config.configTemperature"
            :min="0" :max="2" :step="0.1"
            style="flex:1"
            :disabled="chapter.status !== 'draft'"
          />
          <span style="font-family: monospace; font-size: 12px; width: 28px; text-align: right">{{ config.configTemperature.toFixed(1) }}</span>
        </div>
      </div>
      <div class="config-field">
        <label class="config-field__label">Max Tokens</label>
        <n-input-number
          v-model:value="config.configMaxTokens"
          :min="256" :max="64000" :step="256"
          size="small"
          style="width: 100%"
          :disabled="chapter.status !== 'draft'"
        />
      </div>
    </div>

    <!-- 右：Prompt 预览 -->
    <div class="cap-card">
      <h2 class="cap-eyebrow" style="margin-top: 0; margin-bottom: 8px">3. Prompt 预览</h2>
      <template v-if="assembledPrompt">
        <n-tabs type="segment" animated>
          <n-tab-pane name="system" tab="System Message">
            <pre class="prompt-preview">{{ assembledPrompt.systemMessage }}</pre>
          </n-tab-pane>
          <n-tab-pane name="user" tab="User Message">
            <pre class="prompt-preview">{{ assembledPrompt.userMessage }}</pre>
          </n-tab-pane>
        </n-tabs>
        <div v-if="assembledPrompt.estimatedTotalTokens" style="margin-top: 8px; font-size: 11px; color: var(--text-tertiary)">
          System ~{{ (assembledPrompt.estimatedSystemTokens! / 1000).toFixed(1) }}K
          · User ~{{ (assembledPrompt.estimatedUserTokens! / 1000).toFixed(1) }}K
          · 合计 ~{{ (assembledPrompt.estimatedTotalTokens / 1000).toFixed(1) }}K
          <template v-if="assembledPrompt.contextBudget"> / 预算 {{ (assembledPrompt.contextBudget / 1000).toFixed(0) }}K</template>
        </div>
      </template>
      <p v-else class="prompt-empty">
        点击上方"生成 Prompt"后在此预览
        <span class="prompt-empty__hint">预览会显示将发给 AI 的 System + User Message 全文</span>
      </p>
    </div>
  </div>

  <!-- ====== 候选文章 | 正文 ====== -->
  <div class="split-row">
    <div class="split-left">
      <div class="cap-card" style="height: 100%">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px">
          <h2 class="cap-eyebrow" style="margin: 0">
            候选文章
            <span v-if="generatingCount > 0" style="color: var(--color-warning); font-size: 12px; font-weight: normal; margin-left: 8px">生成中...</span>
          </h2>
          <n-button
            v-if="chapter.status === 'draft'"
            size="tiny"
            type="primary"
            @click="handleGenerate"
            :disabled="generatingCount >= 3 || !outline.trim()"
          >
            生成候选 ({{ generatingCount }}/3)
          </n-button>
        </div>

        <p v-if="drafts.length === 0" class="cap-body-sm" style="color: var(--text-tertiary)">
          点击"生成候选"，AI 生成的候选文章将出现在这里。
        </p>

        <n-tabs v-else v-model:value="activeDraftTab" type="card" animated size="small">
          <n-tab-pane v-for="draft in drafts" :key="draft.id" :name="draft.id">
            <template #tab>
              <span style="display: flex; align-items: center; gap: 4px; font-size: 12px">
                候选 {{ draft.id.substring(0, 8) }}
                <n-tag v-if="draft.status === 'generating'" type="warning" size="tiny" :bordered="false">生成中</n-tag>
                <n-tag v-else-if="draft.status === 'completed'" type="success" size="tiny" :bordered="false">已完成</n-tag>
                <n-tag v-else-if="draft.status === 'failed'" type="error" size="tiny" :bordered="false">失败</n-tag>
              </span>
            </template>
            <div class="draft-body">
              <pre v-if="draft.content" class="draft-content">{{ draft.content }}</pre>
              <p v-else-if="draft.status === 'generating'" style="color: var(--text-tertiary); font-style: italic; text-align: center; padding: 40px 0">等待 AI 响应...</p>
              <p v-else-if="draft.status === 'failed'" style="color: var(--color-negative); text-align: center; padding: 20px 0">生成失败</p>
            </div>
            <div class="draft-footer">
              <span class="draft-word-count">{{ draftWordCount(draft) }}</span>
              <span class="draft-footer-actions">
                <n-button v-if="draft.status === 'completed'" size="tiny" @click="adoptDraft(draft)">采用</n-button>
                <n-button size="tiny" @click="openDraftConfig(draft)">配置</n-button>
                <n-popconfirm @positive-click="draft.status === 'generating' ? cancelGeneration(draft.id) : deleteDraft(draft.id)">
                  <template #trigger><n-button size="tiny" type="error">删除</n-button></template>
                  {{ draft.status === 'generating' ? '确定终止生成并删除吗？' : '确定删除该候选吗？' }}
                </n-popconfirm>
              </span>
            </div>
          </n-tab-pane>
        </n-tabs>
      </div>
    </div>

    <!-- 正文 -->
    <div class="split-right">
      <div class="cap-card" style="height: 100%">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px">
          <h2 class="cap-eyebrow" style="margin: 0">正文</h2>
          <span v-if="chapter.contentHash" style="font-size: 10px; color: var(--text-tertiary); font-family: monospace">
            SHA256: {{ chapter.contentHash.substring(0, 16) }}...
          </span>
        </div>
        <n-input
          v-model:value="content"
          type="textarea"
          :rows="14"
          placeholder="直接输入正文，或从左侧候选文章中采用..."
          :disabled="chapter.status === 'archived'"
          style="font-family: var(--font-serif); font-size: 14px; line-height: 1.8"
        />
        <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 6px">
          <span style="font-size: 11px; color: var(--text-tertiary)">字数：{{ content.length.toLocaleString() }}</span>
          <n-button
            v-if="chapter.status !== 'archived'"
            type="primary"
            size="tiny"
            @click="emit('save-content')"
            :loading="saving"
          >保存正文</n-button>
        </div>
      </div>
    </div>
  </div>

  <!-- 候选配置弹窗 -->
  <n-modal v-model:show="showConfigModal" title="候选配置" preset="card" style="width: 520px">
    <div v-if="viewingDraftConfig" style="font-size: 13px; line-height: 2">
      <template v-if="viewingDraftConfig.providerName || viewingDraftConfig.model">
        <div><strong>模型：</strong>{{ viewingDraftConfig.providerName || '' }} / {{ viewingDraftConfig.model || '' }}</div>
      </template>
      <div v-if="viewingDraftConfig.temperature !== undefined"><strong>Temperature：</strong>{{ viewingDraftConfig.temperature }}</div>
      <div v-if="viewingDraftConfig.maxTokens"><strong>Max Tokens：</strong>{{ viewingDraftConfig.maxTokens }}</div>
      <div><strong>角色：</strong>{{ (viewingDraftConfig.characterIds || []).length }} 个</div>
      <div><strong>记忆：</strong>{{ (viewingDraftConfig.memoryTypeIds || []).length }} 个</div>
      <div><strong>剧情弧线：</strong>{{ (viewingDraftConfig.plotArcIds || []).length }} 个</div>
      <div><strong>世界观：</strong>{{ (viewingDraftConfig.loreIds || []).length }} 个</div>
      <div v-if="viewingDraftConfig.outline" style="margin-top: 8px">
        <strong>大纲：</strong>
        <pre style="margin: 4px 0 0; font-size: 12px; line-height: 1.6; white-space: pre-wrap; color: var(--text-secondary)">{{ viewingDraftConfig.outline }}</pre>
      </div>
    </div>
  </n-modal>
</template>

<script setup lang="ts">
import { ref, watch, onMounted, onUnmounted } from 'vue'
import { NButton, NInput, NTag, NModal, NPopconfirm, NSelect, NSlider, NInputNumber, NTabs, NTabPane } from 'naive-ui'
import { v2ChaptersApi } from '../../api-v2/chapters'
import { useDraftStream } from '../../composables-v2/useDraftStream'

/**
 * useChapterConfig 全部返回值的 reactive 包装（父级单一调用，通过此 prop 共享给 Step3 UI）。
 * 包含: configProviderId / configTemperature / configMaxTokens / modelOptions / selectedModel
 *       / configCharacterIds / configMemoryIds / configPlotArcIds / configLoreIds
 *       / availableCharacters / availableMemories / availablePlotArcs / availableLore
 *       / parsedConfig / searchingMemories
 *       / buildGenConfig / buildConfigForSave / loadAvailableSources / handleMemorySearch / applyConfig
 */
interface ConfigBundle {
  configProviderId: any
  configTemperature: any
  configMaxTokens: any
  configCharacterIds: any
  configMemoryIds: any
  configPlotArcIds: any
  configLoreIds: any
  availableCharacters: any
  availableMemories: any
  availablePlotArcs: any
  availableLore: any
  modelOptions: any
  selectedModel: any
  parsedConfig: any
  searchingMemories: any
  buildGenConfig: (outline: string) => any
  buildConfigForSave: () => any
  loadAvailableSources: () => Promise<{ restoredPrompt: any | null }>
  handleMemorySearch: (outline: string, onDone?: (msg: string, type: 'success' | 'error') => void) => Promise<void>
  applyConfig: (cfg: any) => void
}

const props = defineProps<{
  chapter: any
  outline: string
  content: string
  saving: boolean
  showToast: (msg: string, type?: 'success' | 'error' | 'warning') => void
  config: ConfigBundle
}>()

const emit = defineEmits<{
  'update:content': [string]
  'save-content': []
  'adopt-draft': [string]
  'step-updated': []
}>()

// ── 候选文章（SSE 单连接：composable 仅此处调） ──
const {
  drafts, activeDraftTab, generatingCount,
  loadDrafts, startGeneration, cancelGeneration, deleteDraft,
  draftWordCount, dispose: disposeDrafts
} = useDraftStream(
  () => props.chapter?.id || '',
  (msg, type) => props.showToast(msg, type as any)
)

const content = ref(props.content || '')

watch(() => props.content, (v) => {
  if (v !== content.value) content.value = v || ''
})

watch(content, (v) => {
  if (v !== props.content) emit('update:content', v)
})

// ── Prompt 预览 ──
const assembledPrompt = ref<{
  systemMessage: string; userMessage: string
  estimatedSystemTokens?: number; estimatedUserTokens?: number
  estimatedTotalTokens?: number; contextBudget?: number
} | null>(null)
const generatingPrompt = ref(false)

// ── 候选配置弹窗 ──
const showConfigModal = ref(false)
const viewingDraftConfig = ref<any>(null)

function openDraftConfig(draft: any) {
  try {
    viewingDraftConfig.value = typeof draft.config === 'string' ? JSON.parse(draft.config) : (draft.config || {})
  } catch (err: any) {
    console.warn(`[V2-Step3] draft.config JSON 解析失败，显示空配置: ${(draft.config || '').slice(0, 80)}`, err)
    viewingDraftConfig.value = {}
  }
  showConfigModal.value = true
}

function adoptDraft(draft: any) {
  content.value = draft.content
  emit('adopt-draft', draft.content)
}

function handleGenerate() {
  if (!props.outline.trim()) return
  startGeneration(props.config.buildGenConfig(props.outline.trim()))
}

async function handleGeneratePrompt() {
  if (!props.chapter?.id || !props.outline.trim()) return

  const cfg = { ...(props.config.parsedConfig || {}), ...props.config.buildConfigForSave() }

  generatingPrompt.value = true
  try {
    await v2ChaptersApi.update(props.chapter.id, { outline: props.outline, config: cfg })
    const res = await v2ChaptersApi.preview(props.chapter.id, props.config.buildGenConfig(props.outline.trim()))
    if (res.data?.success && res.data.data) {
      assembledPrompt.value = res.data.data
      cfg._lastPrompt = res.data.data
      try {
        await v2ChaptersApi.update(props.chapter.id, { config: cfg })
      } catch (promptSaveErr: any) {
        console.warn(`[V2-Step3] 写回 _lastPrompt 失败: ${promptSaveErr?.message || promptSaveErr}`)
      }
      emit('step-updated')
      await loadDrafts()
    }
  } catch (err: any) {
    props.showToast(err?.message || '生成 Prompt 失败', 'error')
  } finally {
    generatingPrompt.value = false
  }
}

// 让父级触发 Prompt 生成（在 Step2 中"生成 Prompt"按钮点击后调用）
defineExpose({
  assembledPrompt,
  drafts,
  draftsLength: () => drafts.value.length,
  triggerGeneratePrompt: handleGeneratePrompt,
  loadDrafts
})

onMounted(() => {
  if (props.chapter?.id) loadDrafts()
})

onUnmounted(() => {
  disposeDrafts()
})
</script>