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

describe('ReviewingPanel — v4 failure isolation (一个 stage failed 不阻塞其他 stage)', () => {
  // v4 plan 的核心目标: 任何一个 stage 失败时, 其他 stage 数据仍能正常显示+编辑,
  // 用户能在 UI 上看到"这个 stage 失败 + 错误原因 + 重跑按钮", 不被整个
  // review 面板不挂载挡住 (这是之前根因 2 修前用户看到的"未能加载归档审查数据")。
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('memoryOptimize failed + 其他 4 stage success → 面板仍 mount, 失败 stage 显独立按钮', async () => {
    const pending = basePending({
      memoryOptimize: { status: 'failed', errorMessage: 'AI 返回空内容, 无法做记忆融合', result: null }
      // character / memoryExtract / plotArc / graph 保持 basePending 的 success
    })
    const wrapper = mount(ReviewingPanel, {
      props: { pending, chapterId: 'ch-1', defaultTab: 'memories' }
    })
    await nextTick()

    // 1. 面板不抛错, 正常 mount
    expect(wrapper.exists()).toBe(true)
    const html = wrapper.html()

    // 2. 失败 stage: 错误文案 + 独立重启按钮
    expect(html).toContain('AI 返回空内容, 无法做记忆融合')
    const restartBtn = wrapper.find('[data-test="restart-memoryOptimize"]')
    expect(restartBtn.exists()).toBe(true)
    await restartBtn.trigger('click')
    expect(wrapper.emitted('retry-stage')?.[0]).toEqual(['memoryOptimize'])

    // 3. 成功 stage 不显重启按钮 (证明 failure isolation 双向成立)
    expect(wrapper.find('[data-test="restart-memoryExtract"]').exists()).toBe(false)

    // 4. 总入口按钮仍存在 (失败时让用户可一键全跑两步)
    expect(wrapper.find('[data-test="restart-all-memory"]').exists()).toBe(true)
  })

  it('memoryExtract failed → memoryOptimize 显独立重启按钮 (extract 失败时仍允许单独跑 optimizer)', async () => {
    // v4 plan 设计的核心场景之一: extract 失败 → optimizer 跳过不调
    // (避免白跑), 但 UI 必须仍能独立重启 optimizer (比如 extract 修好后
    // 用户能单独触发 optimizer 补跑)。
    const pending = basePending({
      memoryExtract: { status: 'failed', errorMessage: 'extract boom', result: null },
      memoryOptimize: { status: 'failed', errorMessage: 'memoryExtract 未成功,跳过 optimizer', result: null }
    })
    const wrapper = mountPanel(pending)
    await nextTick()

    // extract 失败 → 显重启按钮
    const extractBtn = wrapper.find('[data-test="restart-memoryExtract"]')
    expect(extractBtn.exists()).toBe(true)
    await extractBtn.trigger('click')
    expect(wrapper.emitted('retry-stage')?.[0]).toEqual(['memoryExtract'])

    // optimize 失败 (因 extract 失败被跳过) → 仍显重启按钮
    // 单独跑 optimizer 要求 memoryExtract 已 success, 否则后端 400 提示
    // 先重跑 extract。这是后端校验责任, UI 显按钮是允许用户操作入口。
    const optimizeBtn = wrapper.find('[data-test="restart-memoryOptimize"]')
    expect(optimizeBtn.exists()).toBe(true)
  })

  it('character stage failed → 记忆 tab 仍正常 mount (failure isolation 跨 tab)', async () => {
    // 任意 tab 的 stage 失败不应阻塞其他 tab 的渲染。
    // 这个测试 mount 默认 tab = characters, 但重点是 memoryOptimize 和
    // 其他 stage 仍能被访问 — 通过直接检查 pending 数据完整性验证。
    const pending = basePending({
      character: { status: 'failed', errorMessage: 'character extract boom', result: null }
    })
    const wrapper = mount(ReviewingPanel, {
      props: { pending, chapterId: 'ch-1', defaultTab: 'memories' }
    })
    await nextTick()

    // 面板仍 mount, 切到记忆 tab 仍能看到两步进度
    expect(wrapper.exists()).toBe(true)
    const html = wrapper.html()
    expect(html).toContain('抽取')
    expect(html).toContain('优化')
    // success stages 数据未受影响
    expect(wrapper.find('[data-test="restart-memoryExtract"]').exists()).toBe(false)
    expect(wrapper.find('[data-test="restart-memoryOptimize"]').exists()).toBe(false)
  })
})