import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import { nextTick } from 'vue'

vi.mock('../../api/chapters', () => ({
  chaptersApi: { list: vi.fn() }
}))
vi.mock('../../api/cumulative-graph', () => ({
  cumulativeGraphApi: { get: vi.fn() }
}))

vi.mock('../../composables/graph/useCytoscapeLifecycle', async () => {
  const actual: any = await vi.importActual('../../composables/graph/useCytoscapeLifecycle')
  return {
    ...actual,
    useCytoscapeLifecycle: vi.fn(() => ({
      rebuild: vi.fn(),
      destroy: vi.fn(),
      resetLayout: vi.fn(),
      applyFocus: vi.fn(),
      clearFocus: vi.fn(),
      getInstance: vi.fn(() => null),
      addNode: vi.fn(),
      addEdge: vi.fn(),
      updateNode: vi.fn(),
      updateEdge: vi.fn(),
      removeNode: vi.fn(),
      removeEdge: vi.fn(),
      init: vi.fn()
    }))
  }
})

import GraphView from '../graph/GraphView.vue'
import { chaptersApi } from '../../api/chapters'
import { cumulativeGraphApi } from '../../api/cumulative-graph'
import { useCytoscapeLifecycle } from '../../composables/graph/useCytoscapeLifecycle'

const stubChapter = (id: string, number: number, status: string) =>
  ({ id, number, title: `Ch${number}`, status, outline: '', content: '', parentChapterId: null })

function setupRouter() {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/novel-design/:storyId/graph', component: { template: '<div/>' } }
    ]
  })
}

// 取出 useCytoscapeLifecycle 最后一次调用返回的 mock 对象,
// 用来断言它上面方法被调用的次数 / 参数。
function getLastLifecycle() {
  const mock = useCytoscapeLifecycle as unknown as ReturnType<typeof vi.fn>
  return mock.mock.results.at(-1)?.value as any
}

describe('GraphView — 只读 archived 视图', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('默认选中 number 最大的 archived 章节', async () => {
    vi.mocked(chaptersApi.list).mockResolvedValue({
      data: { data: [
        stubChapter('a', 1, 'archived'),
        stubChapter('b', 2, 'reviewing'),
        stubChapter('c', 3, 'archived'),
        stubChapter('d', 0.5, 'archived')
      ]}
    } as any)
    vi.mocked(cumulativeGraphApi.get).mockResolvedValue({
      data: { data: { graph: { nodes: [], edges: [] } } }
    } as any)

    const router = setupRouter()
    router.push('/novel-design/story-1/graph')
    await router.isReady()
    const wrapper = mount(GraphView, { global: { plugins: [router] } })

    await new Promise(r => setTimeout(r, 30))
    await nextTick()

    expect((wrapper.vm as any).selectedChapterId).toBe('c')
  })

  it('没有任何 archived 时渲染空态，cytoscape.rebuild 永远不被调用', async () => {
    vi.mocked(chaptersApi.list).mockResolvedValue({
      data: { data: [
        stubChapter('a', 1, 'draft'),
        stubChapter('b', 2, 'reviewing')
      ]}
    } as any)

    const router = setupRouter()
    router.push('/novel-design/story-1/graph')
    await router.isReady()
    const wrapper = mount(GraphView, { global: { plugins: [router] } })

    await new Promise(r => setTimeout(r, 30))
    await nextTick()

    expect(wrapper.find('[data-testid="graph-empty-state"]').exists()).toBe(true)

    const lifecycle = getLastLifecycle()
    expect(lifecycle.rebuild).not.toHaveBeenCalled()
  })

  it('切到 delta tab 触发 cytoscape.rebuild(currentDelta)', async () => {
    // useGraphData 内部会过滤非 archived 并按 number 升序排序
    // snapshot 视图（cumulative graph）= graph 字段，本章纯净（delta）= chapterGraph 字段
    // 切到 delta 时 rebuild 必须以 chapterGraph 节点（key='b'）为参数, 而不是 snapshot 节点（key='a'）
    vi.mocked(chaptersApi.list).mockResolvedValue({
      data: { data: [ stubChapter('a', 1, 'archived') ] }
    } as any)
    vi.mocked(cumulativeGraphApi.get).mockResolvedValue({
      data: { data: {
        graph: { nodes: [{ type: 'character', key: 'a', label: 'A' }], edges: [] },
        chapterGraph: { nodes: [{ type: 'event', key: 'b', label: 'B' }], edges: [] }
      }}
    } as any)

    const router = setupRouter()
    router.push('/novel-design/story-1/graph')
    await router.isReady()
    const wrapper = mount(GraphView, { global: { plugins: [router] } })
    await new Promise(r => setTimeout(r, 30))
    await nextTick()

    const lifecycle = getLastLifecycle()
    lifecycle.rebuild.mockClear()

    ;(wrapper.vm as any).viewMode = 'delta'
    await nextTick()
    await new Promise(r => setTimeout(r, 30))

    expect(lifecycle.rebuild).toHaveBeenCalled()
    const arg = lifecycle.rebuild.mock.calls.at(-1)[0]
    expect(arg?.nodes?.[0]?.key).toBe('b')
  })

  it('首次 init 后 cytoscape.rebuild 用真实 snapshot 数据（非 null）', async () => {
    // bug 1 修复: 旧代码 watch([selectedChapterId, viewMode, () => route.params.storyId])
    // 不依赖 displayData, init → selectChapter 同步赋值触发 watch1 时 displayData 还是 null,
    // rebuild(null) 早退, 数据到达后 watch 不再 trigger → 画布永远空。
    // 修复: watch deps 加 displayData, 数据到达时触发 watch2 rebuild(真实数据)。
    vi.mocked(chaptersApi.list).mockResolvedValue({
      data: { data: [ stubChapter('c', 3, 'archived') ] }
    } as any)
    vi.mocked(cumulativeGraphApi.get).mockResolvedValue({
      data: { data: {
        graph: { nodes: [{ type: 'character', key: 'real', label: 'RealData' }], edges: [] },
        chapterGraph: { nodes: [], edges: [] }
      }}
    } as any)

    const router = setupRouter()
    router.push('/novel-design/story-1/graph')
    await router.isReady()
    mount(GraphView, { global: { plugins: [router] } })

    // 等 init() 整个链路跑完: chapters 加载完 + selectChapter 同步赋值 + loadChapterGraph 异步 fetch 完
    await new Promise(r => setTimeout(r, 50))
    await nextTick()

    const lifecycle = getLastLifecycle()
    expect(lifecycle.rebuild).toHaveBeenCalled()
    // 至少有一次调用, 参数是真实数据 (不是 null)
    const calledWithRealData = lifecycle.rebuild.mock.calls.some((call: any[]) => {
      const arg = call[0]
      return arg && Array.isArray(arg.nodes) && arg.nodes.some((n: any) => n.key === 'real')
    })
    expect(calledWithRealData).toBe(true)
  })

  it('Bug #2 修复: 切换章节触发 loadChapterGraph + rebuild 用新章节数据', async () => {
    // 旧代码 watch([selectedChapterId, ...]) 触发时只调 cytoscape.rebuild(displayData.value),
    // 不调 loadChapterGraph → displayData 永远是旧章节数据 → 画布不切换。
    // 修复: 拆出 watch(selectedChapterId) 单独负责 fetch + 清焦点。
    vi.mocked(chaptersApi.list).mockResolvedValue({
      data: { data: [
        stubChapter('a', 1, 'archived'),
        stubChapter('c', 3, 'archived')
      ]}
    } as any)
    // mockResolvedValueOnce 链: init 拉 c (latest) → 用户切到 a
    vi.mocked(cumulativeGraphApi.get)
      .mockResolvedValueOnce({
        data: { data: {
          graph: { nodes: [{ type: 'character', key: 'cNode', label: 'C' }], edges: [] },
          chapterGraph: { nodes: [], edges: [] }
        }}
      } as any)
      .mockResolvedValueOnce({
        data: { data: {
          graph: { nodes: [{ type: 'character', key: 'aNode', label: 'A' }], edges: [] },
          chapterGraph: { nodes: [], edges: [] }
        }}
      } as any)

    const router = setupRouter()
    router.push('/novel-design/story-1/graph')
    await router.isReady()
    const wrapper = mount(GraphView, { global: { plugins: [router] } })
    await new Promise(r => setTimeout(r, 30))
    await nextTick()

    // init 完成, 已选 latest (c)
    const lifecycle = getLastLifecycle()
    expect(vi.mocked(cumulativeGraphApi.get)).toHaveBeenLastCalledWith('c')
    lifecycle.rebuild.mockClear()

    // 用户切到章节 a
    ;(wrapper.vm as any).selectedChapterId = 'a'
    await nextTick()
    await new Promise(r => setTimeout(r, 30))
    await nextTick()

    // fetch 必须以 a 触发
    expect(vi.mocked(cumulativeGraphApi.get)).toHaveBeenLastCalledWith('a')
    // 至少有一次 rebuild 用 a 的数据 (key='aNode', 不是 'cNode')
    const calledWithA = lifecycle.rebuild.mock.calls.some((call: any[]) => {
      const arg = call[0]
      return arg && Array.isArray(arg.nodes) && arg.nodes.some((n: any) => n.key === 'aNode')
    })
    expect(calledWithA).toBe(true)
  })

  it('Bug #2 修复: 本章纯净模式下切换章节, 画布用新章节的 chapterGraph', async () => {
    // 用户原报症状: "本章纯净切换章节时, 不切换"
    // 修复后 delta 模式下切章节, 必须用新章节的 chapterGraph (currentDelta)
    vi.mocked(chaptersApi.list).mockResolvedValue({
      data: { data: [
        stubChapter('a', 1, 'archived'),
        stubChapter('c', 3, 'archived')
      ]}
    } as any)
    vi.mocked(cumulativeGraphApi.get)
      .mockResolvedValueOnce({
        data: { data: {
          graph: { nodes: [{ type: 'character', key: 'c-snap' }], edges: [] },
          chapterGraph: { nodes: [{ type: 'event', key: 'c-delta' }], edges: [] }
        }}
      } as any)
      .mockResolvedValueOnce({
        data: { data: {
          graph: { nodes: [{ type: 'character', key: 'a-snap' }], edges: [] },
          chapterGraph: { nodes: [{ type: 'event', key: 'a-delta' }], edges: [] }
        }}
      } as any)

    const router = setupRouter()
    router.push('/novel-design/story-1/graph')
    await router.isReady()
    const wrapper = mount(GraphView, { global: { plugins: [router] } })
    await new Promise(r => setTimeout(r, 30))
    await nextTick()

    ;(wrapper.vm as any).viewMode = 'delta'
    await nextTick()
    await new Promise(r => setTimeout(r, 20))
    await nextTick()

    ;(wrapper.vm as any).selectedChapterId = 'a'
    await nextTick()
    await new Promise(r => setTimeout(r, 30))
    await nextTick()

    const lifecycle = getLastLifecycle()
    // 最后一次 rebuild 必须含 a 的 chapterGraph 节点 'a-delta', 不能是 'c-delta' (旧章节)
    const lastCall = lifecycle.rebuild.mock.calls.at(-1)
    expect(lastCall).toBeDefined()
    const arg = lastCall[0]
    expect(arg?.nodes?.[0]?.key).toBe('a-delta')
  })

  it('Bug #2 修复: 切换章节清焦点（旧章节的 focus 元素在新章节可能不存在）', async () => {
    vi.mocked(chaptersApi.list).mockResolvedValue({
      data: { data: [
        stubChapter('a', 1, 'archived'),
        stubChapter('c', 3, 'archived')
      ]}
    } as any)
    vi.mocked(cumulativeGraphApi.get).mockResolvedValue({
      data: { data: {
        graph: { nodes: [{ type: 'character', key: 'x' }], edges: [] },
        chapterGraph: { nodes: [], edges: [] }
      }}
    } as any)

    const router = setupRouter()
    router.push('/novel-design/story-1/graph')
    await router.isReady()
    const wrapper = mount(GraphView, { global: { plugins: [router] } })
    await new Promise(r => setTimeout(r, 30))
    await nextTick()

    const lifecycle = getLastLifecycle()
    lifecycle.clearFocus.mockClear()

    ;(wrapper.vm as any).selectedChapterId = 'a'
    await nextTick()
    await new Promise(r => setTimeout(r, 30))
    await nextTick()

    // 切章节后必须调 cytoscape.clearFocus (清旧章节的 focus 状态)
    expect(lifecycle.clearFocus).toHaveBeenCalled()
  })

  it('Bug #2 修复: selectedChapterId 赋相同值不触发 fetch (NSelect 同值选择 / prev→next 往返 防御)', async () => {
    vi.mocked(chaptersApi.list).mockResolvedValue({
      data: { data: [ stubChapter('a', 1, 'archived') ] }
    } as any)
    vi.mocked(cumulativeGraphApi.get).mockResolvedValue({
      data: { data: {
        graph: { nodes: [], edges: [] },
        chapterGraph: { nodes: [], edges: [] }
      }}
    } as any)

    const router = setupRouter()
    router.push('/novel-design/story-1/graph')
    await router.isReady()
    const wrapper = mount(GraphView, { global: { plugins: [router] } })
    await new Promise(r => setTimeout(r, 30))
    await nextTick()

    // init 时 fetch 过一次, 之后赋相同值不应再 fetch
    const callCount = vi.mocked(cumulativeGraphApi.get).mock.calls.length
    ;(wrapper.vm as any).selectedChapterId = 'a'  // 同样的值
    await nextTick()
    await new Promise(r => setTimeout(r, 30))

    expect(vi.mocked(cumulativeGraphApi.get).mock.calls.length).toBe(callCount)
  })
})
