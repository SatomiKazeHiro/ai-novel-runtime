/**
 * v4 split-stage: ReviewingPanel 记忆 tab 两步进度 UI。
 *
 * 这些测试只关心记忆 tab 的两步进度展示 + 重跑按钮 ——
 * character / plotArc / graph tabs 保持 v3 形态, 不在本测试范围。
 *
 * 隔离策略: ReviewingPanel.vue 顶部挂了一个 <n-tabs>, 全 tab 都会 mount。
 * EditableGraph 依赖 cytoscape → jsdom 跑不动, 需要 mock。
 * 父组件传入 pendingArchiveData (v4 shape), 测试只走记忆 tab 的状态点。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'

// EditableGraph 直接 import cytoscape, jsdom 无 canvas → 必须 mock 整个组件。
vi.mock('../../components/graph/EditableGraph.vue', () => ({
  default: {
    name: 'EditableGraph',
    template: '<div data-test="editable-graph-stub" />',
    methods: {
      getData() { return { nodes: [], edges: [] } }
    }
  }
}))

// 拦截 useDialog/useMessage, 避免 jsdom 找不到对应上下文。
vi.mock('naive-ui', async () => {
  const actual = await vi.importActual<any>('naive-ui')
  return {
    ...actual,
    useDialog: () => ({
      warning: vi.fn(({ onPositiveClick }: any) => onPositiveClick?.())
    }),
    useMessage: () => ({
      info: vi.fn(),
      success: vi.fn(),
      error: vi.fn(),
      warning: vi.fn()
    })
  }
})

import ReviewingPanel from '../ReviewingPanel.vue'
import type { V4PendingArchiveData } from '../ReviewingPanel.adapter'

const basePending = (overrides: Partial<V4PendingArchiveData['stages']> = {}): V4PendingArchiveData => ({
  version: 4,
  stages: {
    character: { status: 'success', result: { characterStates: [] } },
    memoryExtract: {
      status: 'success',
      result: { mainEvents: [], sideEvents: [], emotions: [], foreshadowing: [], relationshipChanges: [], summary: '' }
    },
    memoryOptimize: { status: 'success', result: { memories: [] } },
    plotArc: { status: 'success', result: { plotArcs: [] } },
    graph: { status: 'success', result: { chapterGraph: { nodes: [], edges: [] } } },
    ...overrides
  },
  meta: { extractedAt: '2026-07-31T00:00:00Z', chapterNumber: 1 }
} as V4PendingArchiveData)

/**
 * n-tabs 默认 active 是 'characters', 没激活的 n-tab-pane 走 v-if 不渲染。
 * 测试只关心记忆 tab 的两步进度, mount 后强制 setProps NTabs.value='memories'
 * 让记忆 pane 渲染出来 (然后用 wrapper.find 找 data-test 按钮)。
 */
function mountPanel(pending: V4PendingArchiveData) {
  // 传 defaultTab='memories' 让 n-tabs 初始化时直接渲染记忆 pane
  // (默认 'characters' 会让记忆 pane 走 v-if 不渲染, 测试无法 find)
  return mount(ReviewingPanel, {
    props: { pending, chapterId: 'ch-1', defaultTab: 'memories' }
  })
}

describe('ReviewingPanel 记忆 tab — v4 两步进度', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders two-step progress bar in 记忆 tab (抽取 + 优化 + 错误文案)', async () => {
    const pending = basePending({
      memoryExtract: { status: 'success', result: { mainEvents: [], sideEvents: [], emotions: [], foreshadowing: [], relationshipChanges: [], summary: '' } },
      memoryOptimize: { status: 'failed', errorMessage: 'optimizer boom', result: null }
    })

    const wrapper = mountPanel(pending)
    await nextTick()
    const html = wrapper.html()

    // 两步标签必须渲染
    expect(html).toContain('抽取')
    expect(html).toContain('优化')
    // 优化 stage 失败时, 错误条必须把 errorMessage 写出来
    expect(html).toContain('optimizer boom')
  })

  it('hides restart button for memoryExtract when status=success', async () => {
    const pending = basePending()
    const wrapper = mountPanel(pending)
    await nextTick()

    expect(wrapper.find('[data-test="restart-memoryExtract"]').exists()).toBe(false)
  })

  it('shows restart button for memoryOptimize when status=failed, 点击 emit retry-stage', async () => {
    const pending = basePending({
      memoryOptimize: { status: 'failed', errorMessage: 'kaboom', result: null }
    })
    const wrapper = mountPanel(pending)
    await nextTick()

    const btn = wrapper.find('[data-test="restart-memoryOptimize"]')
    expect(btn.exists()).toBe(true)
    await btn.trigger('click')
    expect(wrapper.emitted('retry-stage')?.[0]).toEqual(['memoryOptimize'])
  })

  it('shows "重新解析两步" total entry regardless of stage status', async () => {
    // 即使两个 stage 都 success, 总入口按钮也必须保留
    const pending = basePending()
    const wrapper = mountPanel(pending)
    await nextTick()

    expect(wrapper.find('[data-test="restart-all-memory"]').exists()).toBe(true)
  })
})