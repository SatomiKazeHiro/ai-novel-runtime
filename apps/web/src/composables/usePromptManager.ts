import { ref, computed, reactive } from 'vue'
import { useMessage } from 'naive-ui'
import { useClipboard } from '@vueuse/core'
import { aiProviderApi } from '../api/ai-provider'
import { chaptersApi } from '../api/chapters'

export function usePromptManager(storyId: () => string | undefined) {
  const message = useMessage()
  const { copy, isSupported } = useClipboard()

  const editablePrompt = ref('')
  const compiledPromptObj = ref<any>(null)
  const tokenStats = ref<any>(null)
  const layerStats = ref<any[]>([])
  const previewLoading = ref(false)

  const defaultModel = ref<any>(null)
  const MODEL_MAX_TOKENS = computed(() => defaultModel.value?.contextLength || 64000)
  const WARN_THRESHOLD = computed(() => Math.floor(MODEL_MAX_TOKENS.value * 0.625))
  const DANGER_THRESHOLD = computed(() => Math.floor(MODEL_MAX_TOKENS.value * 0.78))
  const CRITICAL_THRESHOLD = computed(() => Math.floor(MODEL_MAX_TOKENS.value * 0.86))

  async function loadDefaultModel() {
    try { defaultModel.value = (await aiProviderApi.getDefault()).data.data } catch { /* ignore */ }
  }

  function formatCompiledPrompt(cp: string | null): string {
    if (!cp) return ''
    try {
      const obj = JSON.parse(cp)
      return `[System]\n${obj.systemMessage || ''}\n\n[User]\n${obj.userMessage || ''}`
    } catch { return cp }
  }

  /** 从 chapter/draft 加载已有 Prompt */
  function loadFromChapter(row: any, draftList: any[]) {
    let promptText = row.compiledPrompt ? formatCompiledPrompt(row.compiledPrompt) : ''
    let compiledObj = null
    if (row.compiledPrompt) {
      try { compiledObj = JSON.parse(row.compiledPrompt) } catch { }
    }
    if (!promptText && draftList.length > 0) {
      const latestDraft = draftList.find((d: any) => d.compiledPrompt)
      if (latestDraft) {
        promptText = formatCompiledPrompt(latestDraft.compiledPrompt)
        try { compiledObj = JSON.parse(latestDraft.compiledPrompt) } catch { }
      }
    }
    editablePrompt.value = promptText
    compiledPromptObj.value = compiledObj
  }

  /** 调用 /preview 生成 Prompt */
  async function generatePreview(chapterId: string, runtimeProfileId: string | null) {
    const sid = storyId()
    if (!sid) return
    previewLoading.value = true
    try {
      const res = await chaptersApi.preview(chapterId, {
        storyId: sid,
        runtimeProfileId
      })
      const data = res.data.data
      if (data.compiled) {
        compiledPromptObj.value = data.compiled
        editablePrompt.value = formatCompiledPrompt(JSON.stringify(data.compiled))
      } else if (data.preview) {
        editablePrompt.value = data.preview
      }
      tokenStats.value = data.tokens || null
      layerStats.value = data.layers || []
    } catch (e: any) {
      message.error(e.response?.data?.error || 'Prompt 生成失败')
    } finally {
      previewLoading.value = false
    }
  }

  /** 一键复制 Prompt */
  async function copyPrompt() {
    if (!editablePrompt.value) {
      message.warning('没有可复制的 Prompt')
      return
    }
    if (!isSupported.value) {
      message.warning('浏览器不支持剪贴板操作')
      return
    }
    await copy(editablePrompt.value)
    message.success('Prompt 已复制到剪贴板')
  }

  function reset() {
    editablePrompt.value = ''
    compiledPromptObj.value = null
    tokenStats.value = null
    layerStats.value = []
  }

  return reactive({
    editablePrompt,
    compiledPromptObj,
    tokenStats,
    layerStats,
    previewLoading,
    defaultModel,
    MODEL_MAX_TOKENS,
    WARN_THRESHOLD,
    DANGER_THRESHOLD,
    CRITICAL_THRESHOLD,
    loadDefaultModel,
    formatCompiledPrompt,
    loadFromChapter,
    generatePreview,
    copyPrompt,
    reset
  })
}
