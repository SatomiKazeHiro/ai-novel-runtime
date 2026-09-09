import { ref } from 'vue'
import { chaptersApi } from '../../api/chapters'
import { cumulativeGraphApi } from '../../api/cumulative-graph'
import { toGraphData, type GraphData } from './useCytoscapeLifecycle'

export function useGraphData() {
  const chapters = ref<any[]>([])
  const currentSnapshot = ref<GraphData | null>(null)
  const currentDelta = ref<GraphData | null>(null)

  async function loadChapters(storyId: string) {
    const res = await chaptersApi.list(storyId)
    const all = (res as any).data.data || []
    chapters.value = all
      .filter((c: any) => c.status === 'archived')
      .sort((a: any, b: any) => a.number - b.number)
  }

  async function loadChapterGraph(chapterId: string) {
    const res = await cumulativeGraphApi.get(chapterId)
    const data = (res as any).data.data || {}
    currentSnapshot.value = toGraphData(data.graph?.nodes, data.graph?.edges)
    currentDelta.value = toGraphData(data.chapterGraph?.nodes, data.chapterGraph?.edges)
  }

  return { chapters, currentSnapshot, currentDelta, loadChapters, loadChapterGraph }
}