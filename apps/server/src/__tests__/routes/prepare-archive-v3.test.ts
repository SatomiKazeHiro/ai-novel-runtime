import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createMockApp, callHandler } from '../setup.js'

// Mock all 4 stages so route does not hit real AI
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

const baseChapter = {
  id: 'c1',
  storyId: 's1',
  status: 'draft',
  isSideStory: false,
  content: 'a'.repeat(200),
  outline: 'short',
  number: 1,
  parentChapterId: null,
  pendingArchiveData: null,
  chapterGraph: null,
  cumulativeGraph: null
}

describe('prepare-archive v3 — 4 stage parallel + status field', () => {
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
    const { chapterArchiveRoutes } = await import('../../routes/chapters-archive.js')
    const built = createMockApp(mockPrisma)
    await chapterArchiveRoutes(built.app)
    routes = built.routes
  })

  it('runs all 4 stages in parallel and persists v3 pendingArchiveData', async () => {
    mockPrisma.chapter.findUnique.mockResolvedValue({ ...baseChapter })

    ;(runCharacterStage as any).mockResolvedValue({
      status: 'success', result: { characterStates: [] }, completedAt: ts
    })
    ;(runMemoryStage as any).mockResolvedValue({
      status: 'success', result: { mainEvents: [], sideEvents: [], emotions: [], foreshadowing: [], relationshipChanges: [], scenes: [], timelinePosition: null, summary: '' }, completedAt: ts
    })
    ;(runPlotArcStage as any).mockResolvedValue({
      status: 'success', result: { plotArcs: [] }, completedAt: ts
    })
    ;(runGraphExtractStage as any).mockResolvedValue({
      status: 'success', result: { chapterGraph: { nodes: [], edges: [], timestamp: ts } }, completedAt: ts
    })

    const result = await callHandler(
      routes, 'POST', '/api/chapters/:chapterId/prepare-archive',
      undefined, { chapterId: 'c1' }
    )

    expect(runCharacterStage).toHaveBeenCalled()
    expect(runMemoryStage).toHaveBeenCalled()
    expect(runPlotArcStage).toHaveBeenCalled()
    expect(runGraphExtractStage).toHaveBeenCalled()
    // v3 当前 archive 端点不调 reply.status,所以 result.status 为 undefined; 仅校验成功路径的副作用
    expect(result.body).toMatchObject({ success: true, data: expect.objectContaining({ version: 3 }) })
    // v3 shape: pendingArchiveData 写入是带 version=3 的对象（最后一次 update）
    const updateCalls = mockPrisma.chapter.update.mock.calls.filter(
      (c: any[]) => c[0]?.data?.pendingArchiveData && c[0].data.pendingArchiveData !== null
    )
    expect(updateCalls.length).toBeGreaterThan(0)
    const parsed = JSON.parse(updateCalls[updateCalls.length - 1][0].data.pendingArchiveData)
    expect(parsed.version).toBe(3)
    expect(parsed.stages.character.status).toBe('success')
    expect(parsed.stages.memory.status).toBe('success')
    expect(parsed.stages.plotArc.status).toBe('success')
    expect(parsed.stages.graph.status).toBe('success')
  })

  it('does NOT use updateMany as lock — no race-condition barrier', async () => {
    mockPrisma.chapter.findUnique.mockResolvedValue({ ...baseChapter })
    ;(runCharacterStage as any).mockResolvedValue({ status: 'success', result: { characterStates: [] }, completedAt: ts })
    ;(runMemoryStage as any).mockResolvedValue({ status: 'success', result: {}, completedAt: ts })
    ;(runPlotArcStage as any).mockResolvedValue({ status: 'success', result: { plotArcs: [] }, completedAt: ts })
    ;(runGraphExtractStage as any).mockResolvedValue({ status: 'success', result: { chapterGraph: { nodes: [], edges: [], timestamp: ts } }, completedAt: ts })

    await callHandler(routes, 'POST', '/api/chapters/:chapterId/prepare-archive', undefined, { chapterId: 'c1' })

    // v3 删除了 updateMany 锁
    const lockCalls = mockPrisma.chapter.updateMany.mock.calls
    expect(lockCalls).toHaveLength(0)
  })

  it('isolates failure: one stage failed → others still success in payload', async () => {
    mockPrisma.chapter.findUnique.mockResolvedValue({ ...baseChapter })
    ;(runCharacterStage as any).mockResolvedValue({
      status: 'failed', errorMessage: 'AI 返回格式错误', completedAt: ts
    })
    ;(runMemoryStage as any).mockResolvedValue({ status: 'success', result: {}, completedAt: ts })
    ;(runPlotArcStage as any).mockResolvedValue({ status: 'success', result: { plotArcs: [] }, completedAt: ts })
    ;(runGraphExtractStage as any).mockResolvedValue({ status: 'success', result: { chapterGraph: { nodes: [], edges: [], timestamp: ts } }, completedAt: ts })

    await callHandler(routes, 'POST', '/api/chapters/:chapterId/prepare-archive', undefined, { chapterId: 'c1' })

    const updateCalls = mockPrisma.chapter.update.mock.calls.filter(
      (c: any[]) => c[0]?.data?.pendingArchiveData && c[0].data.pendingArchiveData !== null
    )
    expect(updateCalls.length).toBeGreaterThan(0)
    const parsed = JSON.parse(updateCalls[updateCalls.length - 1][0].data.pendingArchiveData)
    expect(parsed.stages.character.status).toBe('failed')
    expect(parsed.stages.character.errorMessage).toBe('AI 返回格式错误')
    expect(parsed.stages.memory.status).toBe('success')
    expect(parsed.stages.plotArc.status).toBe('success')
    expect(parsed.stages.graph.status).toBe('success')
  })
})

describe('archive v3 — cumulative graph build + transaction', () => {
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
    const { chapterArchiveRoutes } = await import('../../routes/chapters-archive.js')
    const built = createMockApp(mockPrisma)
    await chapterArchiveRoutes(built.app)
    routes = built.routes
  })

  it('commits archive when all stages success and cumulative graph builds', async () => {
    mockPrisma.chapter.findUnique.mockResolvedValue({
      id: 'c1', storyId: 's1', status: 'reviewing',
      isSideStory: false, content: 'x', outline: '', number: 1,
      parentChapterId: null,
      pendingArchiveData: JSON.stringify({
        version: 3,
        stages: {
          character: { status: 'success' },
          memory: { status: 'success' },
          plotArc: { status: 'success' },
          graph: { status: 'success' }
        },
        meta: { extractedAt: ts, chapterNumber: 1 }
      }),
      chapterGraph: JSON.stringify({ nodes: [], edges: [], timestamp: ts })
    })
    ;(buildCumulativeGraph as any).mockResolvedValue({
      cumulativeGraph: { nodes: [], edges: [], timestamp: ts },
      aiCalled: false
    })

    const result = await callHandler(
      routes, 'POST', '/api/chapters/:chapterId/archive',
      undefined, { chapterId: 'c1' }
    )

    expect(result.body).toEqual(expect.objectContaining({ success: true }))
    expect(buildCumulativeGraph).toHaveBeenCalled()
    const archivedUpdate = mockPrisma.chapter.update.mock.calls.find(
      (c: any[]) => c[0]?.data?.status === 'archived'
    )
    expect(archivedUpdate).toBeDefined()
    expect(archivedUpdate[0].data.cumulativeGraph).toBeDefined()
  })

  it('returns 500 when cumulative graph build fails', async () => {
    mockPrisma.chapter.findUnique.mockResolvedValue({
      id: 'c1', storyId: 's1', status: 'reviewing',
      isSideStory: false, content: 'x', outline: '', number: 1,
      parentChapterId: null,
      pendingArchiveData: JSON.stringify({
        version: 3,
        stages: {
          character: { status: 'success' },
          memory: { status: 'success' },
          plotArc: { status: 'success' },
          graph: { status: 'success' }
        },
        meta: { extractedAt: ts, chapterNumber: 1 }
      }),
      chapterGraph: null
    })
    ;(buildCumulativeGraph as any).mockRejectedValue(new Error('AI 抽风'))

    const result = await callHandler(
      routes, 'POST', '/api/chapters/:chapterId/archive',
      undefined, { chapterId: 'c1' }
    )

    expect(result.status).toBe(500)
    expect(result.body.error).toContain('全局图谱构建失败')
  })

  it('returns 400 when any stage is failed', async () => {
    mockPrisma.chapter.findUnique.mockResolvedValue({
      id: 'c1', storyId: 's1', status: 'reviewing',
      isSideStory: false, content: 'x', outline: '', number: 1,
      parentChapterId: null,
      pendingArchiveData: JSON.stringify({
        version: 3,
        stages: {
          character: { status: 'failed', errorMessage: 'x' },
          memory: { status: 'success' },
          plotArc: { status: 'success' },
          graph: { status: 'success' }
        },
        meta: { extractedAt: ts, chapterNumber: 1 }
      })
    })

    const result = await callHandler(
      routes, 'POST', '/api/chapters/:chapterId/archive',
      undefined, { chapterId: 'c1' }
    )

    expect(result.status).toBe(400)
    expect(result.body.error).toContain('character')
    expect(buildCumulativeGraph).not.toHaveBeenCalled()
  })
})
