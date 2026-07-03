import { ref, computed } from 'vue'
import { v2ChaptersApi } from '../api-v2/chapters'

export function useDraftStream(
  chapterId: () => string,
  onNotify?: (msg: string, type: 'success' | 'error' | 'warning') => void
) {
  const drafts = ref<any[]>([])
  const activeDraftTab = ref<string>()
  const activeControllers = new Map<string, AbortController>()

  const generatingCount = computed(() => drafts.value.filter(d => d.status === 'generating').length)

  async function loadDrafts() {
    const cid = chapterId()
    if (!cid) return
    try {
      const res = await v2ChaptersApi.listDrafts(cid)
      drafts.value = res.data.data ?? []
    } catch (err: any) {
      onNotify?.(err?.message || '加载草稿列表失败', 'error')
    }
  }

  async function startGeneration(genConfig: any = {}) {
    const cid = chapterId()
    if (!cid || generatingCount.value >= 3) return

    const placeholderId = `pending-${Date.now()}`
    const placeholderDraft = { id: placeholderId, content: '', status: 'generating' }
    drafts.value.push(placeholderDraft)
    activeDraftTab.value = placeholderId

    const controller = new AbortController()
    activeControllers.set(placeholderId, controller)

    try {
      const response = await v2ChaptersApi.generateStream(cid, genConfig, controller.signal)
      if (!response.ok) {
        let errMsg = '生成请求失败'
        try { const errBody = await response.json(); if (errBody?.error) errMsg = errBody.error } catch { /* keep default */ }
        onNotify?.(errMsg, 'warning')
        drafts.value = drafts.value.filter(d => d.id !== placeholderId)
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
        const messages = buffer.split('\n\n')
        buffer = messages.pop() || ''

        for (const msg of messages) {
          const lines = msg.split('\n')
          let eventName = '', eventData = ''
          for (const line of lines) {
            const trimmed = line.trim()
            if (trimmed.startsWith('event:')) eventName = trimmed.slice(6).trim()
            else if (trimmed.startsWith('data:')) eventData = trimmed.slice(5).trim()
          }
          if (!eventData) continue
          try {
            const payload = JSON.parse(eventData)
            const draftId = payload.draftId
            if (draftId && placeholderId !== draftId) {
              const idx = drafts.value.findIndex(d => d.id === placeholderId)
              if (idx >= 0) drafts.value[idx] = { ...drafts.value[idx], id: draftId }
              activeControllers.delete(placeholderId)
              activeControllers.set(draftId, controller)
              if (activeDraftTab.value === placeholderId) activeDraftTab.value = draftId
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
          } catch (parseErr: any) {
            console.warn(`[V2-SSE] 事件解析失败: ${parseErr?.message || parseErr} | data: ${eventData.slice(0, 100)}`)
          }
        }
      }
    } catch (err: any) {
      if (err.name === 'AbortError') {
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
    if (controller) { controller.abort(); activeControllers.delete(draftId) }
    v2ChaptersApi.deleteDraft(draftId).catch(() => {})
    drafts.value = drafts.value.filter(d => d.id !== draftId)
    if (activeDraftTab.value === draftId) activeDraftTab.value = drafts.value[0]?.id
  }

  async function deleteDraft(draftId: string) {
    await v2ChaptersApi.deleteDraft(draftId)
    drafts.value = drafts.value.filter(d => d.id !== draftId)
    if (activeDraftTab.value === draftId) activeDraftTab.value = drafts.value[0]?.id
  }

  function draftWordCount(draft: any): string {
    if (!draft.content) return ''
    return `字数：${draft.content.replace(/\s/g, '').length.toLocaleString()}`
  }

  function dispose() {
    activeControllers.forEach(ctrl => ctrl.abort())
    activeControllers.clear()
  }

  return {
    drafts,
    activeDraftTab,
    generatingCount,
    loadDrafts,
    startGeneration,
    cancelGeneration,
    deleteDraft,
    draftWordCount,
    dispose
  }
}
