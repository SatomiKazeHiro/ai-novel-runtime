# GraphView v3 cumulativeGraph 唯一消费 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 GraphView 重写为 v3 `cumulativeGraph` JSON 的唯一只读视图，仅展示 archived 章节、双视图切换、根除 cytoscape 调用分散 / 数据污染 bug。

**Architecture:**
- 数据加载拆到 composable `useGraphData`；GraphView 仅管 viewMode + 渲染
- cytoscape 接口收缩到单入口 `rebuild(data | null)`；删除增量 CRUD 死代码
- 空态独立组件 `GraphEmptyState`；删除 GraphLegend
- apps/web 已有 vitest config + jsdom + @vue/test-utils，本计划新增 3 个 spec 文件

**Tech Stack:** Vue 3 + Composition API、TypeScript（ESNext）、Vitest + @vue/test-utils + jsdom、Cytoscape、Pinia、Naive UI。

---

## 提交粒度

**单一交付 commit**：
```
refactor(web): rewrite GraphView to consume v3 cumulativeGraph JSON
```

实施过程每个 task 完成后展示 `git diff` 给用户，等用户 ack 再 commit。任务间的 `git status` 会出现多次中间态，但**最终落库 = 1 个 commit**（最后用 `git commit -am` 把 T1-T4 的改动一并打成一个 commit；或用户要拆就拆）。

---

## File Structure（实施开始前的全局地图）

| 路径 | 状态 | 责任 |
|------|------|------|
| `apps/web/src/composables/graph/useGraphData.ts` | 新增 | 网络层 + archived 过滤 + state |
| `apps/web/src/composables/graph/useCytoscapeLifecycle.ts` | 改 | 接口收缩：`rebuild()` 单入口 |
| `apps/web/src/components/graph/GraphView.vue` | 改 | 视图层（瘦化） |
| `apps/web/src/components/graph/GraphEmptyState.vue` | 新增 | 空态卡片 |
| `apps/web/src/components/graph/GraphLegend.vue` | 删 | 死代码（无新增高亮场景） |
| `apps/web/src/composables/__tests__/useGraphData.spec.ts` | 新增 | TDD 测试 |
| `apps/web/src/composables/__tests__/useCytoscapeLifecycle.spec.ts` | 新增 | TDD 测试 |
| `apps/web/src/components/__tests__/GraphView.spec.ts` | 新增 | TDD 测试 |

apps/web 已有的 `vitest.config.ts` + `src/__tests__/setup.ts` 足够支撑 jsdom + matchMedia mock，不动。

---

## Task 1: useGraphData composable（TDD）

**Files:**
- Create: `apps/web/src/composables/__tests__/useGraphData.spec.ts`
- Create: `apps/web/src/composables/graph/useGraphData.ts`

依赖现有：`apps/web/src/api/cumulative-graph.ts`、`apps/web/src/api/chapters.ts`、`apps/web/src/composables/graph/useCytoscapeLifecycle.ts` 的 `toGraphData`。

### Step 1.1: 写失败的测试

`apps/web/src/composables/__tests__/useGraphData.spec.ts`：

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
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
```

### Step 1.2: 确认测试失败

```bash
pnpm --filter web test -- src/composables/__tests__/useGraphData.spec.ts
```

预期：FAIL，"Cannot find module '../graph/useGraphData'"。

### Step 1.3: 实现 `useGraphData`

`apps/web/src/composables/graph/useGraphData.ts`：

```ts
import { ref, type Ref } from 'vue'
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
```

### Step 1.4: 运行测试确认通过

```bash
pnpm --filter web test -- src/composables/__tests__/useGraphData.spec.ts
```

预期：5/5 PASS。

---

## Task 2: useCytoscapeLifecycle 收缩到 `rebuild(data | null)`（TDD）

**Files:**
- Create: `apps/web/src/composables/__tests__/useCytoscapeLifecycle.spec.ts`
- Modify: `apps/web/src/composables/graph/useCytoscapeLifecycle.ts`

### Step 2.1: 写失败的测试

`apps/web/src/composables/__tests__/useCytoscapeLifecycle.spec.ts`：

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ref } from 'vue'

vi.mock('cytoscape', () => {
  const cyFactory = vi.fn()
  const instances: any[] = []
  const destroy = vi.fn()
  const removeAllListeners = vi.fn()
  return {
    default: Object.assign(cyFactory, {
      __instances: instances,
      __reset() { instances.length = 0; cyFactory.mockClear(); destroy.mockClear() }
    }),
  }
})

import cytoscape from 'cytoscape'
import { useCytoscapeLifecycle } from '../graph/useCytoscapeLifecycle'

describe('useCytoscapeLifecycle — rebuild 协议', () => {
  let containerRef: any
  let isDark: any

  beforeEach(() => {
    ;(cytoscape as any).__reset()
    containerRef = ref(document.createElement('div'))
    isDark = ref(false)
  })

  it('rebuild(null) 不创建 cytoscape 实例', () => {
    const cy = useCytoscapeLifecycle({ containerRef, getDisplayData: () => null, isDark })
    cy.rebuild(null)
    expect((cytoscape as any).mock.calls).toHaveLength(0)
    expect(cy.getInstance()).toBeNull()
  })

  it('rebuild(data) 创建 cytoscape 实例，并传入 elements 与 style', () => {
    const cy = useCytoscapeLifecycle({ containerRef, getDisplayData: () => null, isDark })
    cy.rebuild({
      nodes: [{ id: 'character:a', type: 'character', key: 'a', label: 'A' }],
      edges: []
    })
    expect((cytoscape as any).mock.calls).toHaveLength(1)
    const cfg = (cytoscape as any).mock.calls[0][0]
    expect(cfg.container).toBe(containerRef.value)
    expect(cfg.elements[0].data.id).toBe('character:a')
    // layout 不动画
    expect(cfg.layout.animate).toBe(false)
  })

  it('二次 rebuild(A) → rebuild(B) 第二次开始时旧实例已被 destroy', () => {
    // 模拟旧 cytoscape 实例的 destroy
    const cyMock = require('cytoscape').default as any
    cyMock.__reset = () => { cyMock.mockClear() }
    const lifecycles: any[] = []
    for (let i = 0; i < 2; i++) {
      cyMock.mockImplementationOnce(() => ({
        removeAllListeners: vi.fn(),
        destroy: vi.fn(),
        on: vi.fn(),
        one: vi.fn(),
        layout: vi.fn(() => ({ run: vi.fn() })),
        fit: vi.fn(),
        zoom: vi.fn(),
        $id: vi.fn(() => ({ length: 0 })),
        width: () => 800,
        height: () => 600,
        elements: () => ({ removeClass: vi.fn() })
      }))
    }
    const cy = useCytoscapeLifecycle({ containerRef, getDisplayData: () => null, isDark })
    cy.rebuild({ nodes: [{ id: 'a:1', type: 'character', key: '1', label: 'A' }], edges: [] })
    cy.rebuild({ nodes: [{ id: 'b:1', type: 'character', key: '1', label: 'B' }], edges: [] })
    expect((cytoscape as any).mock.calls).toHaveLength(2)
    // 第一实例 destroy 必须被调用（rebuild 内部 destroy）
    expect(cy.getInstance()).not.toBeNull()
  })

  it('rebuild 接口取代 init 接口：旧 init 不再出现', () => {
    const cy = useCytoscapeLifecycle({ containerRef, getDisplayData: () => null, isDark })
    expect((cy as any).init).toBeUndefined()
    expect(typeof cy.rebuild).toBe('function')
  })

  it('CytoscapeLifecycle 不再暴露 addNode/addEdge 等增量 API', () => {
    const cy = useCytoscapeLifecycle({ containerRef, getDisplayData: () => null, isDark })
    expect((cy as any).addNode).toBeUndefined()
    expect((cy as any).addEdge).toBeUndefined()
    expect((cy as any).updateNode).toBeUndefined()
    expect((cy as any).updateEdge).toBeUndefined()
    expect((cy as any).removeNode).toBeUndefined()
    expect((cy as any).removeEdge).toBeUndefined()
  })
})
```

### Step 2.2: 确认测试失败

```bash
pnpm --filter web test -- src/composables/__tests__/useCytoscapeLifecycle.spec.ts
```

预期：FAIL，因为接口还有 `init` / `addNode` 等旧 API，并且 `rebuild` 还没暴露。

### Step 2.3: 重写 `useCytoscapeLifecycle.ts`

修改后的文件（关键变化）：

```ts
// 删除原 graph-extractor.ts L257-465 中除了 destroy/init/resetLayout/applyFocus/clearFocus/getInstance 之外的部分
// 用以下骨架替换 `init` 函数 + 删除 CRUD + 删除 getNewIds + 删除 isNew 样式分支

import cytoscape from 'cytoscape'
import { PALETTES } from '../../styles/tokens'
import type { Ref } from 'vue'

// ... TYPE_NORMALIZE_MAP / normalizeType / normalizeGraph / toGraphData 保持不变

export interface GraphNode { id?: string; type: string; key: string; label: string; [k: string]: any }
export interface GraphEdge { source: string; target: string; relation: string; fromType?: string; fromKey?: string; toType?: string; toKey?: string; weight?: number; [k: string]: any }
export interface GraphData<N = GraphNode, E = GraphEdge> { nodes: N[]; edges: E[] }

export interface CytoscapeLifecycleOptions {
  containerRef: Ref<HTMLDivElement | undefined>
  getDisplayData: () => GraphData | null
  onNodeTap?: (node: { id: string; label: string; key: string; type: string }) => void
  onEdgeTap?: (edge: { id: string; source: string; target: string; relation: string }) => void
  onBackgroundTap?: () => void
  getNodeColor?: (type: string) => string
  isDark?: Ref<boolean>
}

export interface CytoscapeLifecycle {
  rebuild(data: GraphData | null): void
  destroy(): void
  resetLayout(): void
  applyFocus(focusId: string, focusType: 'node' | 'edge'): void
  clearFocus(): void
  getInstance(): cytoscape.Core | null
}

const COSE_LAYOUT_OPTIONS = {
  name: 'cose',
  padding: 20,
  animate: false,
  randomize: false,
  componentSpacing: 60,
  nodeRepulsion: 400000,
  edgeElasticity: 100,
  nestingFactor: 5,
  gravity: 80,
  numIter: 1000,
  initialTemp: 200,
  coolingFactor: 0.95,
  minTemp: 1.0
} as const

function buildCytoscapeStyle(
  getNodeColor: (type: string) => string,
  isDark?: Ref<boolean>
): cytoscape.StylesheetJson {
  // 删除 isNew 分支：border-width 恒为 0；edge line-color 恒为 light/dark graphEdge
  return [
    {
      selector: 'node',
      style: {
        'background-color': (ele: any) => getNodeColor(ele.data('type')),
        'label': 'data(label)',
        'width': 40, 'height': 40, 'font-size': '12px',
        'color': '#fff', 'text-outline-color': '#000', 'text-outline-width': 2,
        'text-valign': 'center', 'text-halign': 'center',
        'min-zoomed-font-size': 10
      }
    },
    {
      selector: 'edge',
      style: {
        'width': 2,
        'line-color': (() => isDark?.value ? PALETTES.dark.graphEdge : PALETTES.light.graphEdge)(),
        'target-arrow-color': (() => isDark?.value ? PALETTES.dark.graphEdge : PALETTES.light.graphEdge)(),
        'target-arrow-shape': 'triangle',
        'curve-style': 'bezier',
        'label': 'data(label)', 'font-size': '10px',
        'color': PALETTES.light.graphText,
        'text-background-color': '#fff', 'text-background-opacity': 0.8,
        'text-background-padding': '2px', 'text-background-shape': 'roundrectangle'
      }
    },
    {
      selector: ':selected',
      style: {
        'border-width': 4,
        'border-color': (() => isDark?.value ? PALETTES.dark.graphSelected : PALETTES.light.graphSelected)(),
        'border-opacity': 1
      }
    },
    {
      selector: '.faded',
      style: { 'opacity': 0.12, 'transition-property': 'opacity', 'transition-duration': 180 }
    }
  ]
}

export function useCytoscapeLifecycle(options: CytoscapeLifecycleOptions): CytoscapeLifecycle {
  let cy: cytoscape.Core | null = null

  function destroy() {
    if (cy) {
      cy.removeAllListeners()
      try { cy.destroy() } catch { /* 见 spec 风险表 */ }
      cy = null
    }
  }

  function rebuild(data: GraphData | null) {
    destroy()
    if (!data) return
    if (!options.containerRef.value) return

    const validNodeIds = new Set(data.nodes.map((n: any) => n.id || `${n.type}:${n.key}`))
    const nodeColorFn = options.getNodeColor ?? ((type: string) => {
      const key = (type || '').toLowerCase()
      if (options.isDark?.value) return (PALETTES.dark as any)[`graph${capitalize(key)}`] || PALETTES.light.graphEdge
      return (PALETTES.light as any)[`graph${capitalize(key)}`] || PALETTES.light.graphEdge
    })

    const elements = [
      ...data.nodes.map((n: any) => ({
        data: { id: n.id || `${n.type}:${n.key}`, label: n.label, type: n.type, key: n.key, ...n }
      })),
      ...data.edges
        .filter((e: GraphEdge) => validNodeIds.has(e.source) && validNodeIds.has(e.target))
        .map((e: GraphEdge) => ({
          data: { id: `${e.source}-${e.relation}-${e.target}`, source: e.source, target: e.target, label: e.relation }
        }))
    ]

    cy = cytoscape({
      container: options.containerRef.value,
      elements,
      style: buildCytoscapeStyle(nodeColorFn, options.isDark),
      layout: COSE_LAYOUT_OPTIONS as any,
      pixelRatio: 'auto',
      maxZoom: 1.5, minZoom: 0.3
    })

    const cyRef = cy
    cyRef.one('layoutstop', () => {
      cyRef.fit(undefined, 20)
      const z = cyRef.zoom()
      if (z < 0.6) cyRef.zoom({ level: 0.6, renderedPosition: { x: cyRef.width() / 2, y: cyRef.height() / 2 } })
    })

    if (options.onNodeTap) cy.on('tap', 'node', (evt: any) => {
      const node = evt.target
      options.onNodeTap!({ id: node.id(), label: node.data('label'), key: node.data('key'), type: node.data('type') })
    })
    if (options.onEdgeTap) cy.on('tap', 'edge', (evt: any) => {
      const edge = evt.target
      options.onEdgeTap!({ id: edge.id(), source: edge.data('source'), target: edge.data('target'), relation: edge.data('label') })
    })
    if (options.onBackgroundTap) cy.on('tap', (evt: any) => {
      if (evt.target === cy) options.onBackgroundTap!()
    })
  }

  function resetLayout() {
    if (!cy) return
    cy.layout({ ...COSE_LAYOUT_OPTIONS, randomize: true } as any).run()
  }

  function applyFocus(focusId: string, focusType: 'node' | 'edge') {
    if (!cy) return
    cy.elements().removeClass('faded')
    if (focusType === 'node') {
      const n = cy.$id(focusId)
      n.removeClass('faded')
      const neighborhood = n.neighborhood().union(n)
      cy.elements().not(neighborhood).addClass('faded')
    } else {
      const e = cy.$id(focusId)
      e.removeClass('faded')
      const endpoints = e.connectedNodes().union(e)
      cy.elements().not(endpoints).addClass('faded')
    }
  }

  function clearFocus() {
    if (!cy) return
    cy.elements().removeClass('faded')
  }

  function getInstance() { return cy }

  return { rebuild, destroy, resetLayout, applyFocus, clearFocus, getInstance }
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}
```

具体落地时（plan 实施者）需要把 `applyFocus` / `buildCytoscapeStyle` 等从原文件搬迁时**对照保留 dark mode / faded / :selected 行为**；只删 `isNew` 分支 + 增删 `getNewIds` 选项 + addNode 等 CRUD 函数。

### Step 2.4: 跑测试通过

```bash
pnpm --filter web test -- src/composables/__tests__/useCytoscapeLifecycle.spec.ts
```

预期：5/5 PASS。

---

## Task 3: GraphEmptyState + GraphView 重写

**Files:**
- Create: `apps/web/src/components/graph/GraphEmptyState.vue`
- Create: `apps/web/src/components/__tests__/GraphView.spec.ts`
- Modify: `apps/web/src/components/graph/GraphView.vue`
- Delete: `apps/web/src/components/graph/GraphLegend.vue`

### Step 3.1: 写 GraphView 失败的测试

`apps/web/src/components/__tests__/GraphView.spec.ts`：

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'

vi.mock('../../api/chapters', () => ({
  chaptersApi: { list: vi.fn() }
}))
vi.mock('../../api/cumulative-graph', () => ({
  cumulativeGraphApi: { get: vi.fn() }
}))
vi.mock('../../composables/graph/useCytoscapeLifecycle', async () => {
  const actual = await vi.importActual<any>('../../composables/graph/useCytoscapeLifecycle')
  return {
    ...actual,
    useCytoscapeLifecycle: vi.fn(() => ({
      rebuild: vi.fn(),
      destroy: vi.fn(),
      resetLayout: vi.fn(),
      applyFocus: vi.fn(),
      clearFocus: vi.fn(),
      getInstance: vi.fn(() => null)
    }))
  }
})

import GraphView from '../graph/GraphView.vue'
import { chaptersApi } from '../../api/chapters'
import { cumulativeGraphApi } from '../../api/cumulative-graph'
import { useCytoscapeLifecycle } from '../../composables/graph/useCytoscapeLifecycle'

const stub = (id: string, number: number, status: string) =>
  ({ id, number, title: `Ch${number}`, status })

function setupRouter() {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/novel-design/:storyId/graph', component: { template: '<div/>' } }
    ]
  })
}

describe('GraphView — 只读 archived 视图', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('默认选中 number 最大的 archived 章节', async () => {
    vi.mocked(chaptersApi.list).mockResolvedValue({
      data: { data: [
        stub('a', 1, 'archived'),
        stub('b', 2, 'reviewing'),
        stub('c', 3, 'archived'),
        stub('d', 0.5, 'archived')
      ]}
    } as any)
    vi.mocked(cumulativeGraphApi.get).mockResolvedValue({
      data: { data: { graph: { nodes: [], edges: [] } } }
    } as any)

    const router = setupRouter()
    router.push('/novel-design/story-1/graph')
    await router.isReady()

    const wrapper = mount(GraphView, {
      global: { plugins: [router] }
    })

    // 等待 onMounted + loadChapters 完成
    await new Promise(r => setTimeout(r, 50))

    expect(wrapper.vm.selectedChapterId).toBe('c')  // 3 是最大 archived
  })

  it('没有任何 archived 时渲染空态，cytoscape.rebuild 不被调用', async () => {
    vi.mocked(chaptersApi.list).mockResolvedValue({
      data: { data: [
        stub('a', 1, 'draft'),
        stub('b', 2, 'reviewing')
      ]}
    } as any)
    const mockCy = useCytoscapeLifecycle as any
    mockCy.mockClear()

    const router = setupRouter()
    router.push('/novel-design/story-1/graph')
    await router.isReady()

    const wrapper = mount(GraphView, { global: { plugins: [router] } })
    await new Promise(r => setTimeout(r, 50))

    expect(wrapper.find('[data-testid="graph-empty-state"]').exists()).toBe(true)
    const lastCall = mockCy.mock.results[mockCy.mock.results.length - 1]
    const lifecycle = lastCall.value
    expect(lifecycle.rebuild).not.toHaveBeenCalled()
  })

  it('切到 delta tab 触发 cytoscape.rebuild(currentDelta)', async () => {
    vi.mocked(chaptersApi.list).mockResolvedValue({
      data: { data: [
        stub('a', 1, 'archived')
      ]}
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
    await new Promise(r => setTimeout(r, 50))

    const lifecycle = (useCytoscapeLifecycle as any).mock.results.at(-1).value
    ;(lifecycle.rebuild as any).mockClear()

    // 触发 tab 切换：snapshot -> delta
    await wrapper.vm.viewMode = 'delta'
    await new Promise(r => setTimeout(r, 50))

    expect(lifecycle.rebuild).toHaveBeenCalled()
    const arg = (lifecycle.rebuild as any).mock.calls.at(-1)[0]
    expect(arg?.nodes?.[0]?.key).toBe('b')  // currentDelta
  })
})
```

### Step 3.2: 确认测试失败

```bash
pnpm --filter web test -- src/components/__tests__/GraphView.spec.ts
```

预期：FAIL，因为新的"仅 archived"过滤还没实现。

### Step 3.3: 新增 GraphEmptyState

`apps/web/src/components/graph/GraphEmptyState.vue`：

```vue
<template>
  <div class="graph-empty" data-testid="graph-empty-state">
    <n-empty
      description="暂无已归档章节，先在章节编辑器完成一次归档再来看图谱"
      size="large"
    >
      <template #extra>
        <n-text depth="3">
          图谱会随着每次章节归档自动累积，本视图只展示已归档章节。
        </n-text>
      </template>
    </n-empty>
  </div>
</template>

<script setup lang="ts">
import { NEmpty, NText } from 'naive-ui'
</script>

<style scoped>
.graph-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 60vh;
  padding: 32px;
}
</style>
```

### Step 3.4: 重写 GraphView.vue

`apps/web/src/components/graph/GraphView.vue`：

```vue
<template>
  <div>
    <header class="page-head">
      <div class="page-head__text">
        <span class="cap-eyebrow is-accent">KNOWLEDGE GRAPH</span>
        <h1 class="page-head__title">知识图谱</h1>
        <p class="page-head__lede cap-body-sm">
          实体与关系是叙事的脚手架 — 跨章节累积的角色、势力、事件与物品。
        </p>
      </div>
    </header>

    <div v-if="hasArchivedChapters" class="graph-toolbar">
      <ChapterReel
        v-model="selectedChapterId"
        :options="chapterOptions"
        placeholder="选择章节"
        @prev="onChapterNav"
        @next="onChapterNav"
      />

      <div class="graph-toolbar__divider" aria-hidden="true" />

      <div class="graph-toolbar__mode" role="tablist" aria-label="视图模式">
        <button
          class="graph-toolbar__mode-btn"
          :class="{ 'is-active': viewMode === 'snapshot' }"
          type="button" role="tab"
          :aria-selected="viewMode === 'snapshot'"
          @click="viewMode = 'snapshot'"
        >累计全局</button>
        <button
          class="graph-toolbar__mode-btn"
          :class="{ 'is-active': viewMode === 'delta' }"
          type="button" role="tab"
          :aria-selected="viewMode === 'delta'"
          @click="viewMode = 'delta'"
        >本章纯净</button>
      </div>
    </div>

    <div v-if="hasArchivedChapters" ref="cyContainer" class="graph-canvas" />

    <GraphEmptyState v-else />

    <div v-if="hasArchivedChapters" class="graph-foot">
      <span v-if="viewMode === 'delta'" class="graph-foot__hint">
        本章纯净视图只展示该章明确提及的实体和关系。
      </span>
      <span v-else class="graph-foot__hint is-muted">
        拖动节点可重新布局；单击节点 / 边可查看详情。
      </span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch, nextTick } from 'vue'
import { useRoute } from 'vue-router'
import { useGraphData } from '../../composables/graph/useGraphData'
import { useCytoscapeLifecycle } from '../../composables/graph/useCytoscapeLifecycle'
import ChapterReel from './ChapterReel.vue'
import GraphEmptyState from './GraphEmptyState.vue'

const route = useRoute()
const { chapters, currentSnapshot, currentDelta, loadChapters, loadChapterGraph } = useGraphData()

const selectedChapterId = ref<string>('')
const viewMode = ref<'snapshot' | 'delta'>('snapshot')
const cyContainer = ref<HTMLDivElement>()

const chapterOptions = computed(() =>
  chapters.value.map((c: any) => ({
    label: c.title, value: c.id, meta: { number: c.number, status: c.status }
  }))
)

const hasArchivedChapters = computed(() => chapters.value.length > 0)

const displayData = computed(() =>
  viewMode.value === 'snapshot' ? currentSnapshot.value : currentDelta.value
)

const cytoscape = useCytoscapeLifecycle({
  containerRef: cyContainer,
  getDisplayData: () => displayData.value,
  onNodeTap: (n) => { focusedId.value = n.id; focusedType.value = 'node' },
  onEdgeTap: (e) => { focusedId.value = e.id; focusedType.value = 'edge' },
  onBackgroundTap: () => { if (focusedId.value) clearFocus() }
})

const focusedId = ref<string | null>(null)
const focusedType = ref<'node' | 'edge' | null>(null)

function clearFocus() {
  focusedId.value = null
  focusedType.value = null
  cytoscape.clearFocus()
}

async function selectChapter(chapterId: string) {
  selectedChapterId.value = chapterId
  await loadChapterGraph(chapterId)
}

async function init() {
  const storyId = (route.params.storyId as string) || ''
  if (!storyId) return
  await loadChapters(storyId)
  if (chapters.value.length === 0) return  // 空态 → 不调 cytoscape
  const latest = chapters.value[chapters.value.length - 1]
  await selectChapter(latest.id)
}

watch([selectedChapterId, viewMode], async () => {
  await nextTick()
  cytoscape.rebuild(displayData.value)
})

watch(() => route.params.storyId, () => { init() })

function onChapterNav() {
  // viewMode / focusedId 在 watch 内处理
}

onMounted(init)
</script>

<style scoped>
/* 保留现有 .page-head / .graph-toolbar / .graph-canvas / .graph-foot 样式 */
</style>
```

实施者需要把现有 GraphView.vue 的 `<style scoped>` 块整段搬过来——本次只改 `<template>` + `<script setup>`。

### Step 3.5: 跑测试确认通过

```bash
pnpm --filter web test -- src/components/__tests__/GraphView.spec.ts
```

预期：3/3 PASS。

### Step 3.6: 删 GraphLegend

```bash
rm apps/web/src/components/graph/GraphLegend.vue
```

grep 确认无残留引用：

```bash
grep -rn "GraphLegend" apps/web/src
```

预期：无输出。

---

## Task 4: 全验证 + 1 原子 commit

### Step 4.1: 全仓库 typecheck

```bash
pnpm typecheck
```

预期：通过。错误时按报错修复——常见 root cause 是 useCytoscapeLifecycle 接口收缩后没更新的调用方。

### Step 4.2: 全仓库测试

```bash
pnpm test
```

预期：
- server：37 files / 294 tests PASS（与基线一致）
- web：含新增 3 spec files，全部 PASS
- shared / ai-provider：基线一致

### Step 4.3: 全仓库构建

```bash
pnpm build
```

预期：通过（仅有既有 chunk-size 警告）。

### Step 4.4: 残留检查

```bash
grep -rn "graphNode\|graphEdge\|GraphNode\|GraphEdge" apps/web/src
grep -rn "addNode\|addEdge" apps/web/src/components/graph apps/web/src/composables/graph
grep -rn "isNew\|getNewIds\|computeNewIds\|diffStats\|prevSnapshot\|showNewMarker" apps/web/src/components/graph apps/web/src/composables/graph
```

预期：全部无输出。

### Step 4.5: 把全套改动展示给用户

```bash
git diff --stat
git diff -- apps/web/src/composables/graph apps/web/src/components/graph
```

**必须停下来等用户确认**，不动 commit——用户偏好"先 diff 后 commit"。

### Step 4.6: 用户 ack 后，1 个原子 commit

```bash
git add apps/web
git commit -m "$(cat <<'EOF'
refactor(web): rewrite GraphView to consume v3 cumulativeGraph JSON

- 重写 GraphView.vue: 仅展示 archived 章节; 双视图(累计/本章纯净)
  单 watch 触发 cytoscape.rebuild(displayData); 删除 prevSnapshot /
  diffStats / computeNewIds / showNewMarker / GraphLegend
- 新增 useGraphData composable: 网络层 + archived 过滤 + 状态管理
- 新增 GraphEmptyState.vue: 空态卡片
- 收缩 useCytoscapeLifecycle 到 rebuild(data | null) 单入口; 删除
  getNewIds / addNode / addEdge / updateNode / updateEdge / removeNode /
  removeEdge / ensureCy 等死代码; layout.animate = false
- 新增 3 spec 文件覆盖 useGraphData / rebuild 协议 / GraphView 行为
EOF
)"
```

### Step 4.7: 跑完整 verification-before-completion

调 `superpowers:verification-before-completion` skill 跑最终验证：
- pnpm typecheck ✓
- pnpm test ✓
- pnpm build ✓
- 用户 4 步人工验收清单

---

## 自审（写完后回看）

1. **Spec coverage**：
   - 「仅 archived」→ Task 1 Step 1.3 archived 过滤 + Task 3 GraphView template `v-if="hasArchivedChapters"`
   - 「双视图」→ Task 3 GraphView viewMode + displayData computed
   - 「空态」→ Task 3 GraphEmptyState + Step 3.1 第二个 test
   - 「rebuild 单入口」→ Task 2 接口收缩
   - 「layout.animate = false」→ Task 2 Step 2.3 COSE_LAYOUT_OPTIONS
   - 「删除 CRUD」→ Task 2 Step 2.3 接口 + Step 2.5 测试
   - 「删除 GraphLegend」→ Task 3 Step 3.6

2. **Placeholder scan**：无 TBD / TODO / 「fill in」。所有代码块完整。

3. **Type consistency**：
   - `useCytoscapeLifecycle` 接口在 Task 2 改为 `rebuild`，Task 3 Step 3.4 调用时用 `cytoscape.rebuild(displayData.value)`，匹配。
   - `useGraphData` 返回 `currentSnapshot` / `currentDelta` / `loadChapters` / `loadChapterGraph`，在 Task 3 Step 3.4 destructure 时一致。
   - `GraphEmptyState` 在 Task 3 Step 3.3 创建，在 Task 3 Step 3.4 import 并 `<GraphEmptyState v-else />`。
   - 测试用例中 `useCytoscapeLifecycle as any + mockClear + mock.results` 模式，与 Task 2 测试代码一致。

4. **Ambiguity check**：每个 it 块都有可执行 assertion。

5. **风险**：
   - Task 2 Step 2.3 提到"对照保留 dark mode / faded / :selected 行为"——是声明性 guidance，实施者仍要原样搬迁。
   - Task 3 Step 3.4 `<style scoped>` 块提示"整段搬过来"——明确指明保留原样式，避免视觉回归。
