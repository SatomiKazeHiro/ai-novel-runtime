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
        findFirst: vi.fn().mockResolvedValue(null),
        update: vi.fn(),
        updateMany: vi.fn()
      },
      character: { findMany: vi.fn().mockResolvedValue([]) },
      characterBranchState: { findMany: vi.fn().mockResolvedValue([]) },
      plotArc: {
        findMany: vi.fn().mockResolvedValue([]),
        create: vi.fn().mockResolvedValue({ id: 'new-arc-1' }),
        update: vi.fn().mockResolvedValue({ id: 'updated-arc-1' })
      },
      memory: { create: vi.fn().mockResolvedValue({ id: 'mem-1' }) },
      $transaction: vi.fn(async (fn: any) => fn(mockPrisma))
    }
    const { chapterArchiveRoutes } = await import('../../routes/chapters-archive.js')
    const built = createMockApp(mockPrisma)
    await chapterArchiveRoutes(built.app)
    routes = built.routes
  })

  it('happy path: archive confirm 触发 commitPlotArcWrites → PlotArc 表新增/更新', async () => {
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
          lastTouchedChapter: 1
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

    const result = await callHandler(
      routes, 'POST', '/api/chapters/:chapterId/archive',
      undefined, { chapterId: 'ch-1' }
    )

    expect(result.status).toBe(500)
    expect(result.body).toMatchObject({ success: false })
    // 章节 status 没翻 archived (rollback 生效)
    const updateCalls = mockPrisma.chapter.update.mock.calls
    const archivedUpdate = updateCalls.find((c: any[]) => c[0]?.data?.status === 'archived')
    expect(archivedUpdate).toBeUndefined()
  })
})
