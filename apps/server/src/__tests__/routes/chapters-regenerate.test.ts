import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createMockApp, callHandler } from '../setup.js'

// v3 archive route 用 4 个 stage, mock 它们让 route 走完并行段而不打真实 AI。
vi.mock('../../services/stages/character-stage.js', () => ({
  runCharacterStage: vi.fn()
}))
vi.mock('../../services/stages/memory-stage.js', () => ({
  runMemoryStage: vi.fn()
}))
vi.mock('../../services/stages/plot-arc-stage.js', () => ({
  runPlotArcStage: vi.fn()
}))
vi.mock('../../services/stages/graph-extract-stage.js', () => ({
  runGraphExtractStage: vi.fn()
}))
vi.mock('../../services/cumulative-graph.js', () => ({
  buildCumulativeGraph: vi.fn()
}))

import { runCharacterStage } from '../../services/stages/character-stage.js'
import { runMemoryStage } from '../../services/stages/memory-stage.js'
import { runPlotArcStage } from '../../services/stages/plot-arc-stage.js'
import { runGraphExtractStage } from '../../services/stages/graph-extract-stage.js'
import { buildCumulativeGraph } from '../../services/cumulative-graph.js'

const ts = '2026-07-25T00:00:00.000Z'

describe('select route — v2 no chapter.status lock', () => {
  let mockPrisma: any
  let routes: Record<string, any>

  beforeEach(async () => {
    vi.clearAllMocks()
    mockPrisma = {
      chapter: {
        findUnique: vi.fn(),
        update: vi.fn(),
        updateMany: vi.fn()
      },
      draft: {
        findUnique: vi.fn(),
        update: vi.fn(),
        updateMany: vi.fn()
      },
      $transaction: vi.fn(async (fn: any) => fn(mockPrisma))
    }
    const { chapterRoutes } = await import('../../routes/chapters.js')
    const built = createMockApp(mockPrisma)
    await chapterRoutes(built.app)
    routes = built.routes
  })

  it('accepts draft without 409 (v2 has no select lock)', async () => {
    // v2: select 不再翻 chapter.status, 也没有锁 updateMany;
    // 旧测试期望的 409 路径已不存在。这里证明 draft 状态 select 成功。
    mockPrisma.chapter.findUnique.mockResolvedValue({
      id: 'c1', status: 'draft'
    })
    mockPrisma.draft.findUnique.mockResolvedValue({
      id: 'd1', chapterId: 'c1', content: 'text'
    })
    mockPrisma.draft.updateMany.mockResolvedValue({ count: 1 })
    mockPrisma.chapter.update.mockResolvedValue({ id: 'c1', status: 'draft' })

    const result = await callHandler(
      routes,
      'POST',
      '/api/chapters/:chapterId/select',
      { draftId: 'd1' },
      { chapterId: 'c1' }
    )

    expect(result.status).not.toBe(409)
    expect(mockPrisma.$transaction).toHaveBeenCalled()
    expect(result.body).toEqual({ success: true })
  })

  it('proceeds without updateMany lock calls on chapter', async () => {
    mockPrisma.chapter.findUnique.mockResolvedValue({
      id: 'c1', status: 'draft'
    })
    mockPrisma.draft.findUnique.mockResolvedValue({
      id: 'd1', chapterId: 'c1', content: 'text'
    })
    mockPrisma.draft.updateMany.mockResolvedValue({ count: 1 })
    mockPrisma.chapter.update.mockResolvedValue({ id: 'c1', status: 'draft' })

    await callHandler(
      routes,
      'POST',
      '/api/chapters/:chapterId/select',
      { draftId: 'd1' },
      { chapterId: 'c1' }
    )

    // v2: select 不调用 chapter.updateMany (无锁)
    expect(mockPrisma.chapter.updateMany).not.toHaveBeenCalled()
  })
})

describe('prepare-archive route — v3 no updateMany lock, status pre-check only', () => {
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
      plotArc: { findMany: vi.fn().mockResolvedValue([]) }
    }
    const { chapterRoutes } = await import('../../routes/chapters.js')
    const built = createMockApp(mockPrisma)
    await chapterRoutes(built.app)
    routes = built.routes
  })

  it('returns 400 on archived status (v3 pre-check, no 409 lock path)', async () => {
    // v3: prepare-archive 入口只看 chapter.status — 'archived' 在 findUnique 后
    // 立刻 400,不再走 v2 updateMany 锁路径 (lock 已删除, 没有 409 race barrier)。
    mockPrisma.chapter.findUnique.mockResolvedValue({
      id: 'c1',
      storyId: 's1',
      status: 'archived',
      isSideStory: false,
      content: 'a'.repeat(200),
      outline: 'short outline',
      number: 1,
      parentChapterId: null,
      story: { id: 's1' }
    })

    const result = await callHandler(
      routes,
      'POST',
      '/api/chapters/:chapterId/prepare-archive',
      undefined,
      { chapterId: 'c1' }
    )

    expect(result.status).toBe(400)
    expect(result.body).toEqual(
      expect.objectContaining({ success: false })
    )
    expect(runCharacterStage).not.toHaveBeenCalled()
    expect(mockPrisma.chapter.updateMany).not.toHaveBeenCalled()
  })

  it('proceeds from draft without updateMany lock — v3 stages write pendingArchiveData', async () => {
    // v3 主流程: draft + content → 跑 4 stage 并行 → 写 pendingArchiveData (version=3)。
    // 全程不应出现 updateMany 锁调用。
    mockPrisma.chapter.findUnique.mockResolvedValue({
      id: 'c1',
      storyId: 's1',
      status: 'draft',
      isSideStory: false,
      content: 'a'.repeat(200),
      outline: 'short outline',
      number: 1,
      parentChapterId: null,
      story: { id: 's1' }
    })
    ;(runCharacterStage as any).mockResolvedValue({
      status: 'success', result: { characterStates: [] }, completedAt: ts
    })
    ;(runMemoryStage as any).mockResolvedValue({
      status: 'success', result: {
        mainEvents: [], sideEvents: [], emotions: [], foreshadowing: [],
        relationshipChanges: [], scenes: [], summary: ''
      }, completedAt: ts
    })
    ;(runPlotArcStage as any).mockResolvedValue({
      status: 'success', result: { plotArcs: [] }, completedAt: ts
    })
    ;(runGraphExtractStage as any).mockResolvedValue({
      status: 'success', result: { chapterGraph: { nodes: [], edges: [], timestamp: ts } }, completedAt: ts
    })
    mockPrisma.chapter.update.mockResolvedValue({ id: 'c1', status: 'reviewing' })

    const result = await callHandler(
      routes,
      'POST',
      '/api/chapters/:chapterId/prepare-archive',
      undefined,
      { chapterId: 'c1' }
    )

    expect(result.status).not.toBe(400)
    expect(result.body).toEqual(expect.objectContaining({ success: true }))
    expect(runCharacterStage).toHaveBeenCalledTimes(1)
    expect(runMemoryStage).toHaveBeenCalledTimes(1)
    expect(runPlotArcStage).toHaveBeenCalledTimes(1)
    expect(runGraphExtractStage).toHaveBeenCalledTimes(1)
    // v3 删除 updateMany 锁
    expect(mockPrisma.chapter.updateMany).not.toHaveBeenCalled()
  })
})

describe('archive route — v3 commit (single $transaction, no 409 lock)', () => {
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
      memory: { create: vi.fn() },
      // v3 archive confirm 在 $transaction 内调 commitPlotArcWrites → 需要 plotArc 模型
      plotArc: {
        findMany: vi.fn().mockResolvedValue([]),
        create: vi.fn(),
        update: vi.fn()
      },
      $transaction: vi.fn(async (fn: any) => fn(mockPrisma))
    }
    const { chapterRoutes } = await import('../../routes/chapters.js')
    const built = createMockApp(mockPrisma)
    await chapterRoutes(built.app)
    routes = built.routes
  })

  it('returns 400 when chapter.status is not reviewing (v3 status pre-check, no 409 lock path)', async () => {
    // v3 archive 入口只看 chapter.status — 'draft' 立刻 400,
    // 没有 v2 updateMany 锁路径 (lock 已删除, 没有 409 race barrier)。
    // pendingArchiveData 故意保留: 即便有数据, 错误状态也直接 400。
    mockPrisma.chapter.findUnique.mockResolvedValue({
      id: 'c1',
      storyId: 's1',
      status: 'draft',
      isSideStory: false,
      content: 'a'.repeat(200),
      number: 1,
      pendingArchiveData: JSON.stringify({ version: 3 }),
      story: { id: 's1' }
    })

    const result = await callHandler(
      routes,
      'POST',
      '/api/chapters/:chapterId/archive',
      undefined,
      { chapterId: 'c1' }
    )

    expect(result.status).toBe(400)
    expect(result.body).toEqual(
      expect.objectContaining({ success: false })
    )
    // v3 archive 仍是 gate stub: 不调 $transaction, 不调 updateMany
    expect(mockPrisma.chapter.updateMany).not.toHaveBeenCalled()
  })

  it('proceeds from reviewing with v4 pendingArchiveData (single $transaction, no updateMany lock)', async () => {
    // v4 archive (Task 4.2): reviewing + version=4 + 5 stage 全 success + cumulativeGraph
    // → 单 prisma.$transaction 内依次: 写 Memory 三层 (chapter/scene/global) +
    // commitPlotArcWrites + commitCharacterBranchStateWrites + 写 Chapter.summary +
    // 拷 pendingArchiveData 三列 + 翻 status=archived。
    // v4 全程无 updateMany 锁 (UI 防双击)。
    mockPrisma.chapter.findUnique.mockResolvedValue({
      id: 'c1',
      storyId: 's1',
      status: 'reviewing',
      isSideStory: false,
      content: 'a'.repeat(200),
      number: 1,
      pendingArchiveData: JSON.stringify({
        version: 4,
        stages: {
          character: { status: 'success', result: {}, completedAt: ts },
          memoryExtract: { status: 'success', result: {}, completedAt: ts },
          memoryOptimize: { status: 'success', result: { memories: [] }, completedAt: ts },
          plotArc: { status: 'success', result: {}, completedAt: ts },
          graph: { status: 'success', result: { chapterGraph: { nodes: [], edges: [], timestamp: ts } }, completedAt: ts }
        },
        cumulativeGraph: { nodes: [], edges: [], timestamp: ts },
        cumulativeGraphGeneratedAt: ts,
        meta: { extractedAt: ts, chapterNumber: 1 }
      }),
      chapterGraph: null,
      cumulativeGraph: null,
      cumulativeGraphGeneratedAt: null,
      story: { id: 's1' }
    })
    mockPrisma.chapter.update.mockResolvedValue({ id: 'c1', status: 'archived' })

    const result = await callHandler(
      routes,
      'POST',
      '/api/chapters/:chapterId/archive',
      undefined,
      { chapterId: 'c1' }
    )

    expect(result.status).not.toBe(400)
    expect(result.body).toEqual(expect.objectContaining({ success: true }))
    // v4: archive 用单 $transaction 写 memory 三层 + chapter.update
    expect(mockPrisma.$transaction).toHaveBeenCalled()
    // v4 全程无 updateMany 锁
    expect(mockPrisma.chapter.updateMany).not.toHaveBeenCalled()
    // archive 路径应至少一次 chapter.update (翻 status → archived)
    expect(mockPrisma.chapter.update).toHaveBeenCalled()
    const archiveUpdate = mockPrisma.chapter.update.mock.calls.find(
      (c: any[]) => c[0]?.data?.status === 'archived'
    )
    expect(archiveUpdate).toBeDefined()
    // archive 把 pendingArchiveData 数据拷到三列, 然后清 pendingArchiveData
    expect(archiveUpdate[0].data.pendingArchiveData).toBeNull()
    expect(archiveUpdate[0].data.cumulativeGraph).toBe(JSON.stringify({ nodes: [], edges: [], timestamp: ts }))
    expect(archiveUpdate[0].data.cumulativeGraphGeneratedAt).toBeInstanceOf(Date)
  })
})
