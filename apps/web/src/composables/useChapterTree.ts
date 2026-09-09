import { ref, reactive } from 'vue'
import { useMessage, useDialog } from 'naive-ui'
import { chaptersApi } from '../api/chapters'

export function useChapterTree(storyId: () => string | undefined) {
  const message = useMessage()
  const dialog = useDialog()

  const chapterTree = ref<any[]>([])
  const loading = ref(false)

  // 弹窗状态
  const showCreateModal = ref(false)
  const showDevelopModal = ref(false)
  const createForm = ref({ title: '', outline: '', isSideStory: false })
  const developForm = ref({ title: '', outline: '', isSideStory: false })
  const developParentId = ref('')
  const developForceSideStory = ref(false)

  async function loadChapterTree() {
    const sid = storyId()
    if (!sid) { chapterTree.value = []; return }
    loading.value = true
    try {
      const res = await chaptersApi.getTree(sid)
      chapterTree.value = res.data.data || []
    } catch (e: any) {
      message.error(e.response?.data?.error || '加载失败')
    } finally {
      loading.value = false
    }
  }

  function findMaxNumber(nodes: any[]): number {
    let max = -Infinity
    for (const n of nodes) {
      max = Math.max(max, n.number || 0)
      if (n.children?.length) {
        max = Math.max(max, findMaxNumber(n.children))
      }
    }
    return max
  }

  function onDevelop(node: any) {
    developParentId.value = node.id
    // 已有子节点 或 不是全局最新章节 → 只能发展番外
    const maxNumber = findMaxNumber(chapterTree.value)
    const forceSideStory = node.hasChildren === true || (node.number || 0) < maxNumber
    developForceSideStory.value = forceSideStory
    developForm.value = { title: '', outline: '', isSideStory: forceSideStory }
    showDevelopModal.value = true
  }

  async function handleDevelop() {
    if (!developParentId.value) return
    try {
      const res = await chaptersApi.develop(developParentId.value, {
        title: developForm.value.title,
        outline: developForm.value.outline,
        isSideStory: developForm.value.isSideStory
      })
      showDevelopModal.value = false
      message.success('新章节已创建')
      await loadChapterTree()
      return res.data.data
    } catch (e: any) {
      message.error(e.response?.data?.error || '创建失败')
      return null
    }
  }

  async function onDelete(node: any) {
    dialog.warning({
      title: '确认删除',
      content: `确定要删除「${node.title || '该章节'}」吗？此操作不可撤销。`,
      positiveText: '删除',
      negativeText: '取消',
      onPositiveClick: async () => {
        try {
          await chaptersApi.remove(node.id)
          message.success('已删除')
          await loadChapterTree()
        } catch (e: any) {
          message.error(e.response?.data?.error || '删除失败')
        }
      }
    })
  }

  function openCreateRoot() {
    createForm.value = { title: '', outline: '', isSideStory: false }
    showCreateModal.value = true
  }

  async function handleCreateRoot() {
    const sid = storyId()
    if (!sid || !createForm.value.title) return
    try {
      const res = await chaptersApi.create(sid, createForm.value)
      showCreateModal.value = false
      message.success('章节已创建')
      await loadChapterTree()
      return res.data.data
    } catch (e: any) {
      message.error(e.response?.data?.error || '创建失败')
      return null
    }
  }

  return reactive({
    chapterTree,
    loading,
    showCreateModal,
    showDevelopModal,
    createForm,
    developForm,
    developParentId,
    developForceSideStory,
    loadChapterTree,
    onDevelop,
    handleDevelop,
    onDelete,
    openCreateRoot,
    handleCreateRoot
  })
}
