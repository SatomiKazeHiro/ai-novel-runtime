import { ref, reactive } from 'vue'
import { useMessage } from 'naive-ui'
import { chaptersApi } from '../api/chapters'
import { plotArcApi } from '../api/plot-arc'
import { runtimeApi as runtimeProfileApi } from '../api/runtime'

export function useChapterEditor(storyId: () => string | undefined) {
  const message = useMessage()

  const editMode = ref(false)
  const currentChapter = ref<any>(null)
  const selectedChapterId = ref('')
  const editTitle = ref('')
  const selectedProfileId = ref<string | null>(null)
  const profileOptions = ref<any[]>([])
  const editForm = ref({ outline: '', content: '', sceneLocation: '', sceneMood: '', sceneGoal: '' })
  const plotArcs = ref<any[]>([])
  const graphDelta = ref<any>(null)

  async function loadProfiles() {
    try {
      const res = await runtimeProfileApi.list()
      profileOptions.value = (res.data.data || []).map((p: any) => ({
        label: p.name + (p.isDefault ? ' (默认)' : ''),
        value: p.id
      }))
    } catch { /* ignore */ }
  }

  async function openEdit(row: any) {
    currentChapter.value = row
    selectedChapterId.value = row.id
    editTitle.value = row.title || ''
    selectedProfileId.value = row.runtimeProfileId || null
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
  }

  function backToTree() {
    editMode.value = false
    currentChapter.value = null
    selectedChapterId.value = ''
    plotArcs.value = []
    graphDelta.value = null
  }

  async function saveConfig() {
    if (!currentChapter.value) return
    const data: any = {}
    if (editTitle.value !== currentChapter.value.title) data.title = editTitle.value
    if (editForm.value.outline !== currentChapter.value.outline) data.outline = editForm.value.outline
    if (editForm.value.sceneLocation !== currentChapter.value.sceneLocation) data.sceneLocation = editForm.value.sceneLocation
    if (editForm.value.sceneMood !== currentChapter.value.sceneMood) data.sceneMood = editForm.value.sceneMood
    if (editForm.value.sceneGoal !== currentChapter.value.sceneGoal) data.sceneGoal = editForm.value.sceneGoal

    if (Object.keys(data).length === 0) {
      message.info('没有变更需要保存')
      return
    }

    await chaptersApi.update(currentChapter.value.id, data)
    Object.assign(currentChapter.value, data)
    message.success('配置已保存')
  }

  async function saveContent() {
    if (!currentChapter.value) return
    await chaptersApi.update(currentChapter.value.id, { content: editForm.value.content })
    currentChapter.value.content = editForm.value.content
    message.success('正文已保存')
  }

  async function archiveChapter(content: string) {
    if (!currentChapter.value) return { success: false }
    if (!content?.trim()) {
      message.warning('正文为空，无法归档')
      return { success: false }
    }
    try {
      await chaptersApi.update(currentChapter.value.id, { content })
      await chaptersApi.archive(currentChapter.value.id)
      message.success('已归档')
      return { success: true }
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
    editForm,
    plotArcs,
    graphDelta,
    loadProfiles,
    openEdit,
    backToTree,
    saveConfig,
    saveContent,
    archiveChapter
  })
}
