import { ref, reactive } from 'vue'
import { useMessage, useDialog } from 'naive-ui'
import { useIntervalFn } from '@vueuse/core'
import { chaptersApi, draftsApi } from '../api/chapters'

export function useDraftManager() {
  const message = useMessage()
  const dialog = useDialog()

  const drafts = ref<any[]>([])
  const generating = ref(false)
  const scoringDraftId = ref<string | null>(null)
  const showCustomModal = ref(false)
  const customTemp = ref(0.75)
  const customMaxTokens = ref(4096)
  const showScoreModal = ref(false)
  const scoreResult = ref<any>(null)

  const pollChapterId = ref<string>('')

  // 轮询（vueuse useIntervalFn 自动管理）
  const { pause: stopPolling, resume: startPollingInternal, isActive: isPolling } = useIntervalFn(
    async () => {
      const chapterId = pollChapterId.value
      if (!chapterId) { stopPolling(); return }
      try {
        const res = await draftsApi.list(chapterId)
        const newDrafts = res.data.data || []
        drafts.value = newDrafts
        const allDone = newDrafts.every((d: any) => d.status === 'completed' || d.status === 'failed')
        if (allDone) {
          stopPolling()
          const completed = newDrafts.filter((d: any) => d.status === 'completed').length
          const failed = newDrafts.filter((d: any) => d.status === 'failed').length
          if (completed > 0) message.success(`${completed} 个候选生成完成`)
          if (failed > 0) message.warning(`${failed} 个候选生成失败`)
        }
      } catch { /* 轮询出错不中断 */ }
    },
    2000,
    { immediate: false }
  )

  function startPolling(chapterId: string) {
    pollChapterId.value = chapterId
    startPollingInternal()
  }

  async function loadDrafts(chapterId: string) {
    const res = await draftsApi.list(chapterId)
    drafts.value = res.data.data || []
    if (drafts.value.some((d: any) => d.status === 'generating')) {
      startPolling(chapterId)
    }
  }

  async function generate(chapterId: string, storyId: string, temperatures: number[], runtimeProfileId: string | null, maxTokens?: number) {
    generating.value = true
    try {
      const res = await chaptersApi.generate(chapterId, {
        storyId,
        candidateCount: temperatures.length,
        temperatures,
        maxTokens,
        runtimeProfileId
      })
      drafts.value = res.data.data.drafts || []
      message.success(`已提交 ${drafts.value.length} 个候选生成任务`)
      startPolling(chapterId)
      return { success: true, tokens: res.data.data.tokens || null, layers: res.data.data.layers || [] }
    } catch (e: any) {
      // Q#10：后端状态机独占锁失败时返回 409。
      // 用 warning 而非 error：双击是用户可恢复的并发条件，不是真正的失败。
      if (e.response?.status === 409) {
        message.warning('该章节正在生成中，请等待当前任务完成')
      } else {
        message.error(e.response?.data?.error || e.message || '生成失败')
      }
      return { success: false }
    } finally {
      generating.value = false
    }
  }

  async function selectDraft(chapterId: string, draftId: string, currentContent = '', opts: { confirmIfContentDiffers?: boolean } = { confirmIfContentDiffers: true }) {
    const draft = drafts.value.find(d => d.id === draftId)

    // v2: 选候选时若 chapter.content 与 draft.content 不同,弹确认窗(默认行为)
    if (opts.confirmIfContentDiffers && (currentContent || '').trim() && (draft?.content ?? '') !== currentContent) {
      const ok = await new Promise<boolean>((resolve) => {
        dialog.warning({
          title: '覆盖章节正文？',
          content: '当前章节已有正文。继续将以所选候选内容覆盖。',
          positiveText: '覆盖',
          negativeText: '取消',
          onPositiveClick: () => resolve(true),
          onNegativeClick: () => resolve(false),
          onClose: () => resolve(false)
        })
      })
      if (!ok) return null
    }

    try {
      await chaptersApi.selectDraft(chapterId, draftId, { overrideContent: true })
      const res = await draftsApi.list(chapterId)
      drafts.value = res.data.data || []
      message.success('已采用')
      return draft?.content || null
    } catch (e: any) {
      message.error(e.response?.data?.error || '采用失败')
      return null
    }
  }

  async function scoreDraft(draftId: string) {
    if (scoringDraftId.value) return
    scoringDraftId.value = draftId
    try {
      const res = await draftsApi.score(draftId)
      scoreResult.value = res.data.data?.score || null
      showScoreModal.value = true
      message.success('评分完成')
    } catch (e: any) {
      message.error(e.response?.data?.error || '评分失败')
    } finally {
      scoringDraftId.value = null
    }
  }

  function confirmDeleteDraft(draftId: string, version?: string) {
    dialog.warning({
      title: '确认删除',
      content: `确定要删除「${version || '该候选'}」吗？此操作不可撤销。`,
      positiveText: '删除',
      negativeText: '取消',
      onPositiveClick: async () => {
        try {
          await draftsApi.remove(draftId)
          drafts.value = drafts.value.filter(d => d.id !== draftId)
          message.success('已删除')
        } catch { message.error('删除失败') }
      }
    })
  }

  return reactive({
    drafts,
    generating,
    scoringDraftId,
    showCustomModal,
    customTemp,
    customMaxTokens,
    showScoreModal,
    scoreResult,
    isPolling,
    loadDrafts,
    generate,
    selectDraft,
    scoreDraft,
    confirmDeleteDraft,
    stopPolling
  })
}
