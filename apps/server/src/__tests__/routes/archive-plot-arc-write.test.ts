import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createMockApp, callHandler } from '../setup.js'

const ts = '2026-07-25T00:00:00.000Z'

const plotArcWrite = {
  storyId: 'test-story',
  name: '不速之客',
  type: 'main',
  status: 'active',
  progress: 10,
  stages: '[{"stage":"初遇","completed":false,"description":"楼道偶遇"}]',
  currentStage: '初遇',
  nextGoal: '适应现代',
  unresolved: '["穿越原因"]',
  summary: '楼道偶遇采药少女',
  isNew: true
}

const basePending = {
  version: 3,
  stages: {
    character: { status: 'success', result: { characterStates: [] } },
    memory: {
      status: 'success',
      result: {
        mainEvents: [{ description: '主角觉醒', importance: 8 }],
        sideEvents: [],
        emotions: [],
        foreshadowing: [],
        relationshipChanges: [],
        scenes: [],
        summary: '主角觉醒',
        memories: []
      }
    },
    plotArc: {
      status: 'success',
      result: { plotArcs: [plotArcWrite] }
    },
    graph: {
      status: 'success',
      result: { chapterGraph: { nodes: [], edges: [] } },
      completedAt: ts
    }
  },
  cumulativeGraph: { nodes: [], edges: [] },
  cumulativeGraphGeneratedAt: ts,
  meta: { chapterNumber: 1 }
}

const baseChapter = {
  id: 'ch-1',
  storyId: 'test-story',
  number: 1,
  title: '第1章 测试',
  status: 'reviewing',
  isSideStory: false,
  content: 'a'.repeat(200),
  outline: 'short',
  pendingArchiveData: JSON.stringify(basePending),
  chapterGraph: null,
  cumulativeGraph: null
}

describe('archive v3 — PlotArc 写库 (P0 修复)', () => {
  let mockPrisma: any
  let routes: Record<string, any>

  beforeEach(async () => {
    vi.clearAllMocks()
    mockPrisma = {
      chapter: {
        findUnique: vi.fn(),
        update: vi.fn()
      },
      plotArc: {
        findMany: vi.fn().mockResolvedValue([]),
        create: vi.fn().mockResolvedValue({ id: 'new-arc-1' })
      },
      memory: { create: vi.fn().mockResolvedValue({ id: 'mem-1' }) },
      // NOTE: tx 与 mockPrisma 是同一对象 (见 $transaction 实现)。这意味着
      // commitPlotArcWrites 内的 tx.plotArc.create 与直调 mockPrisma.plotArc.create
      // 行为一致 — 但反过来:本 mock 无法验证 commitPlotArcWrites *一定* 在 tx 内被调。
      // 真生产环境 Prisma $transaction 内 create 失败会回滚整段 (含 chapter.update),
      // 这里的 mock 由于 tx === mockPrisma, throw 会直接冒到外层,行为一致。
      $transaction: vi.fn(async (fn: any) => fn(mockPrisma))
    }
    const { chapterArchiveRoutes } = await import('../../routes/chapters-archive.js')
    const built = createMockApp(mockPrisma)
    await chapterArchiveRoutes(built.app)
    routes = built.routes
  })

  it('happy path: archive confirm 触发 commitPlotArcWrites → PlotArc 表新增 (isNew)', async () => {
    mockPrisma.chapter.findUnique.mockResolvedValue({ ...baseChapter })

    const result = await callHandler(
      routes, 'POST', '/api/chapters/:chapterId/archive',
      undefined, { chapterId: 'ch-1' }
    )

    expect(result.body).toMatchObject({ success: true })
    // 关键断言: tx.plotArc.create 被调 1 次 (承接 consolidator 输出的 isNew arc)
    expect(mockPrisma.plotArc.create).toHaveBeenCalledTimes(1)
    expect(mockPrisma.plotArc.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          storyId: 'test-story',
          name: '不速之客',
          type: 'main',
          progress: 10,
          lastTouchedChapter: baseChapter.number
        })
      })
    )
    // 章节翻 archived
    expect(mockPrisma.chapter.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'archived' })
      })
    )
  })

  it('rollback: commitPlotArcWrites 抛错 → 整个 transaction rollback, chapter 保持 reviewing', async () => {
    mockPrisma.chapter.findUnique.mockResolvedValue({ ...baseChapter })
    // 让 plotArc.create 抛错 (模拟 AI 字段异常等极端情况)
    mockPrisma.plotArc.create.mockRejectedValue(new Error('plotArc.create failed'))

    // createMockApp 未注册 errorHandler,callHandler 在 handler 抛错时会 reject
    // (result.status 此时为 undefined,而非 500)
    await expect(
      callHandler(routes, 'POST', '/api/chapters/:chapterId/archive', undefined, { chapterId: 'ch-1' })
    ).rejects.toThrow(/plotArc.create failed/)
    // 章节 status 没翻 archived (rollback 生效) — tx.chapter.update 在 commitPlotArcWrites 之后调用,抛错后整段跳过
    const updateCalls = mockPrisma.chapter.update.mock.calls
    const archivedUpdate = updateCalls.find((c: any[]) => c[0]?.data?.status === 'archived')
    expect(archivedUpdate).toBeUndefined()
    // 这条断言依赖:commitPlotArcWrites 抛错必须发生在 tx.chapter.update 之前 (否则 chapter 已翻 archived)
  })
})
