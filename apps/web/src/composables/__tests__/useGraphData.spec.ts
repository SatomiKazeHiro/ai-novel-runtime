import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ref, computed } from 'vue'
import { useGraphData } from '../graph/useGraphData'
import { chaptersApi } from '../../api/chapters'
import { cumulativeGraphApi } from '../../api/cumulative-graph'

vi.mock('../../api/chapters', () => ({
  chaptersApi: { list: vi.fn() }
}))
vi.mock('../../api/cumulative-graph', () => ({
  cumulativeGraphApi: { get: vi.fn() }
}))

const stubChapter = (id: string, number: number, status: string) =>
  ({ id, number, title: `Ch${number}`, status, outline: '', content: '', parentChapterId: null })

describe('useGraphData — archived filter & state', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('loadChapters 过滤掉非 archived 章节', async () => {
    vi.mocked(chaptersApi.list).mockResolvedValue({
      data: { data: [
        stubChapter('a', 1, 'archived'),
        stubChapter('b', 2, 'reviewing'),
        stubChapter('c', 3, 'draft'),
        stubChapter('d', 4, 'archived')
      ]}
    } as any)

    const { chapters, loadChapters } = useGraphData()
    await loadChapters('story-1')

    expect(chapters.value.map(c => c.id)).toEqual(['a', 'd'])  // 只剩 archived
  })

  it('没有 archived 时 chapters 仍为 []，不抛错', async () => {
    vi.mocked(chaptersApi.list).mockResolvedValue({
      data: { data: [
        stubChapter('a', 1, 'draft'),
        stubChapter('b', 2, 'reviewing')
      ]}
    } as any)

    const { chapters, loadChapters } = useGraphData()
    await expect(loadChapters('story-1')).resolves.toBeUndefined()
    expect(chapters.value).toEqual([])
  })

  it('loadChapterGraph 把 graph 映射到 currentSnapshot、chapterGraph 到 currentDelta', async () => {
    const { currentSnapshot, currentDelta, loadChapterGraph } = useGraphData()
    vi.mocked(cumulativeGraphApi.get).mockResolvedValue({
      data: { data: {
        graph: { nodes: [{ type: 'character', key: 'zwj', label: '张无忌' }], edges: [] },
        chapterGraph: { nodes: [{ type: 'event', key: 'siege', label: '围攻光明顶' }], edges: [] }
      }}
    } as any)

    await loadChapterGraph('chap-1')

    expect(currentSnapshot.value?.nodes).toHaveLength(1)
    expect(currentSnapshot.value?.nodes[0].key).toBe('zwj')
    expect(currentDelta.value?.nodes).toHaveLength(1)
    expect(currentDelta.value?.nodes[0].key).toBe('siege')
  })

  it('chapterGraph 缺失时 currentDelta 仍为合法空图（不报错）', async () => {
    const { currentDelta, currentSnapshot, loadChapterGraph } = useGraphData()
    vi.mocked(cumulativeGraphApi.get).mockResolvedValue({
      data: { data: { graph: { nodes: [], edges: [] } } }  // 无 chapterGraph
    } as any)

    await loadChapterGraph('chap-1')

    expect(currentSnapshot.value?.nodes).toEqual([])
    expect(currentDelta.value?.nodes).toEqual([])
  })
})

describe('useGraphData — displayData computed', () => {
  it('viewMode === "snapshot" 返回 currentSnapshot', async () => {
    vi.mocked(chaptersApi.list).mockResolvedValue({ data: { data: [] } } as any)
    vi.mocked(cumulativeGraphApi.get).mockResolvedValue({
      data: { data: { graph: { nodes: [{ type: 'character', key: 'a', label: 'A' }], edges: [] } } }
    } as any)
    const gd = useGraphData()
    await gd.loadChapters('story-1')
    await gd.loadChapterGraph('chap-1')

    const viewMode = ref<'snapshot' | 'delta'>('snapshot')
    const displayData = computed(() =>
      viewMode.value === 'snapshot' ? gd.currentSnapshot.value : gd.currentDelta.value
    )
    expect(displayData.value?.nodes?.[0]?.key).toBe('a')
  })

  it('viewMode === "delta" 返回 currentDelta', async () => {
    vi.mocked(cumulativeGraphApi.get).mockResolvedValue({
      data: { data: {
        graph: { nodes: [{ type: 'character', key: 'a', label: 'A' }], edges: [] },
        chapterGraph: { nodes: [{ type: 'event', key: 'b', label: 'B' }], edges: [] }
      }}
    } as any)
    const gd = useGraphData()
    await gd.loadChapterGraph('chap-1')

    const viewMode = ref<'snapshot' | 'delta'>('delta')
    const displayData = computed(() =>
      viewMode.value === 'snapshot' ? gd.currentSnapshot.value : gd.currentDelta.value
    )
    expect(displayData.value?.nodes?.[0]?.key).toBe('b')
  })
})