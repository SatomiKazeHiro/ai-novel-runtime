import { ref, reactive } from 'vue'
import { useMessage } from 'naive-ui'
import { chaptersApi } from '../api/chapters'
import { plotArcApi } from '../api/plot-arc'
import { runtimeApi as runtimeProfileApi } from '../api/runtime'
import { aiProviderApi } from '../api/ai-provider'

export function useChapterEditor(storyId: () => string | undefined) {
  const message = useMessage()

  const editMode = ref(false)
  const currentChapter = ref<any>(null)
  const selectedChapterId = ref('')
  const editTitle = ref('')
  const selectedProfileId = ref<string | null>(null)
  const profileOptions = ref<any[]>([])
  const selectedModelId = ref<string | null>(null)
  const modelOptions = ref<any[]>([])
  const editForm = ref({ outline: '', content: '', sceneLocation: '', sceneMood: '', sceneGoal: '' })
  const plotArcs = ref<any[]>([])
  const graphDelta = ref<any>(null)
  const pendingArchiveData = ref<any>(null)
  const savingContent = ref(false)

  async function loadProfiles() {
    try {
      const res = await runtimeProfileApi.list()
      profileOptions.value = (res.data.data || []).map((p: any) => ({
        label: p.name + (p.isDefault ? ' (默认)' : ''),
        value: p.id
      }))
    } catch { /* ignore */ }
  }

  async function loadModels() {
    try {
      const res = await aiProviderApi.list()
      modelOptions.value = (res.data.data || []).map((m: any) => ({
        label: `${m.name} / ${m.model}` + (m.isDefault ? ' (默认)' : ''),
        value: m.id
      }))
    } catch { /* ignore */ }
  }

  async function openEdit(row: any) {
    currentChapter.value = row
    selectedChapterId.value = row.id
    editTitle.value = row.title || ''
    selectedProfileId.value = row.runtimeProfileId || null
    selectedModelId.value = row.aiProviderConfigId || null
    editForm.value = {
      outline: row.outline || '',
      content: row.content || '',
      sceneLocation: row.sceneLocation || '',
      sceneMood: row.sceneMood || '',
      sceneGoal: row.sceneGoal || ''
    }
    editMode.value = true

    // 加载剧情弧线
    const sid = storyId()
    if (sid) {
      try { plotArcs.value = (await plotArcApi.list(sid)).data.data || [] } catch { plotArcs.value = [] }
    }

    // 加载图谱变化
    graphDelta.value = null
    if (row.status === 'archived' && row.graphDelta) {
      try { graphDelta.value = JSON.parse(row.graphDelta) } catch { graphDelta.value = null }
    }

    // 加载待归档数据
    pendingArchiveData.value = null
    if (row.status === 'reviewing' && row.pendingArchiveData) {
      try {
        pendingArchiveData.value = JSON.parse(row.pendingArchiveData)
      } catch (e) {
        console.error('[openEdit] failed to parse pendingArchiveData', e, row.pendingArchiveData)
        pendingArchiveData.value = null
      }
    }
  }

  function backToTree() {
    editMode.value = false
    currentChapter.value = null
    selectedChapterId.value = ''
    plotArcs.value = []
    graphDelta.value = null
    pendingArchiveData.value = null
  }

  async function saveConfig() {
    if (!currentChapter.value) return
    const data: any = {}
    if (editTitle.value !== currentChapter.value.title) data.title = editTitle.value
    if (editForm.value.outline !== currentChapter.value.outline) data.outline = editForm.value.outline
    if (editForm.value.sceneLocation !== currentChapter.value.sceneLocation) data.sceneLocation = editForm.value.sceneLocation
    if (editForm.value.sceneMood !== currentChapter.value.sceneMood) data.sceneMood = editForm.value.sceneMood
    if (editForm.value.sceneGoal !== currentChapter.value.sceneGoal) data.sceneGoal = editForm.value.sceneGoal
    if (selectedModelId.value !== currentChapter.value.aiProviderConfigId) {
      data.aiProviderConfigId = selectedModelId.value
    }

    if (Object.keys(data).length === 0) {
      message.info('没有变更需要保存')
      return
    }

    await chaptersApi.update(currentChapter.value.id, data)
    Object.assign(currentChapter.value, data)
    message.success('配置已保存')
  }

  async function saveContent() {
    if (!currentChapter.value) return { success: false }
    savingContent.value = true
    try {
      console.log('[saveContent] saving chapter', currentChapter.value.id)
      const res = await chaptersApi.update(currentChapter.value.id, { content: editForm.value.content })
      console.log('[saveContent] response', res.status, res.data)
      if (res.data.success) {
        currentChapter.value.content = editForm.value.content
        message.success('正文已保存', { duration: 3000 })
        return { success: true }
      } else {
        message.error(res.data.error || '保存失败')
        return { success: false }
      }
    } catch (e: any) {
      console.error('[saveContent] error', e)
      message.error(e.response?.data?.error || '保存失败')
      return { success: false }
    } finally {
      savingContent.value = false
    }
  }

  async function prepareArchive() {
    if (!currentChapter.value) return { success: false }
    // v2: 允许 draft（首次，有 content 即可）和 reviewing（重试：上一次提取
    // 失败导致 pendingArchiveData 损坏 / null）两种状态进入 prepare-archive。
    // 后端路由的 updateMany 锁也接受这两种状态。
    if (currentChapter.value.status !== 'draft' &&
        currentChapter.value.status !== 'reviewing') {
      message.warning('当前状态不支持准备归档')
      return { success: false }
    }
    try {
      const res = await chaptersApi.prepareArchive(currentChapter.value.id)
      if (res.data.success) {
        currentChapter.value.status = 'reviewing'
        // Backend returns parsed object directly; no JSON.parse needed
        currentChapter.value.pendingArchiveData = res.data.data
        pendingArchiveData.value = res.data.data
        message.success('已进入归档审查，请确认后归档')
        return { success: true }
      } else {
        message.error(res.data.error || '准备归档失败')
        return { success: false }
      }
    } catch (e: any) {
      message.error(e.response?.data?.error || '准备归档失败')
      return { success: false }
    }
  }

  async function savePendingArchiveData(data: any) {
    if (!currentChapter.value) return { success: false }
    if (currentChapter.value.status !== 'reviewing') {
      message.warning('只有 reviewing 状态可以保存归档数据')
      return { success: false }
    }
    try {
      const json = JSON.stringify(data)
      const res = await chaptersApi.update(currentChapter.value.id, { pendingArchiveData: json })
      if (res.data.success) {
        pendingArchiveData.value = data
        message.success('归档数据已保存')
        return { success: true }
      } else {
        message.error(res.data.error || '保存归档数据失败')
        return { success: false }
      }
    } catch (e: any) {
      message.error(e.response?.data?.error || '保存归档数据失败')
      return { success: false }
    }
  }

  async function archiveChapter() {
    if (!currentChapter.value) return { success: false }
    if (currentChapter.value.status !== 'reviewing') {
      message.warning('只有 reviewing 状态可以确认归档')
      return { success: false }
    }
    try {
      const res = await chaptersApi.archive(currentChapter.value.id)
      if (res.data.success) {
        currentChapter.value.status = 'archived'
        currentChapter.value.pendingArchiveData = null
        message.success('已归档')
        return { success: true }
      } else {
        message.error(res.data.error || '归档失败')
        return { success: false }
      }
    } catch (e: any) {
      message.error(e.response?.data?.error || '归档失败')
      return { success: false }
    }
  }

  return reactive({
    editMode,
    currentChapter,
    selectedChapterId,
    editTitle,
    selectedProfileId,
    profileOptions,
    selectedModelId,
    modelOptions,
    editForm,
    plotArcs,
    graphDelta,
    pendingArchiveData,
    savingContent,
    loadProfiles,
    loadModels,
    openEdit,
    backToTree,
    saveConfig,
    saveContent,
    savePendingArchiveData,
    prepareArchive,
    archiveChapter
  })
}
