import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createMockApp, callHandler } from '../setup.js'

// v4 拆分: retry-stage 的 stageName 从 v3 的 'memory' 换成 memoryExtract / memoryOptimize。
// 本文件验证:
//   1. 老 stageName 'memory' 直接 400
//   2. retry memoryExtract → 重跑抽取 + 自动续跑 optimizer
//   3. retry memoryOptimize → 只跑 optimizer(不重跑抽取)
//   4. retry memoryOptimize 但 memoryExtract 未成功 → 400

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
vi.mock('../../services/memory-optimizer.js', () => ({
  optimizeMemories: vi.fn()
}))

import { runMemoryStage } from '../../services/stages/memory-stage.js'
import { runPlotArcStage } from '../../services/stages/plot-arc-stage.js'
import { optimizeMemories } from '../../services/memory-optimizer.js'

const ts = '2026-07-31T00:00:00.000Z'

const rawMemoryResult = {
  mainEvents: [{ description: '主要事件', importance: 7 }],
  sideEvents: [], emotions: [], foreshadowing: [],
  relationshipChanges: [], scenes: [], summary: '摘要'
}

/** 构造一份 v4 pendingArchiveData,memoryExtract 状态可覆盖 */
function makePendingV4(memoryExtract: any, memoryOptimize: any = { status: 'failed', errorMessage: 'x' }) {
  return JSON.stringify({
    version: 4,
    stages: {
      character: { status: 'success', result: { characterStates: [] }, completedAt: ts },
      memoryExtract,
      memoryOptimize,
      plotArc: { status: 'success', result: { plotArcs: [] }, completedAt: ts },
      graph: { status: 'success', result: { chapterGraph: { nodes: [], edges: [], timestamp: ts } }, completedAt: ts }
    },
    meta: { extractedAt: ts, chapterNumber: 1 }
  })
}

function makeChapter(pendingArchiveData: string | null) {
  return {
    id: 'abc',
    storyId: 's1',
    status: 'reviewing',
    isSideStory: false,
    content: 'a'.repeat(200),
    outline: 'short outline',
    number: 1,
    parentChapterId: null,
    pendingArchiveData,
    chapterGraph: null,
    cumulativeGraph: null
  }
}

function makePrisma() {
  return {
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
}

async function setupRoutes(mockPrisma: any) {
  const { chapterArchiveRoutes } = await import('../../routes/chapters-archive.js')
  const built = createMockApp(mockPrisma)
  await chapterArchiveRoutes(built.app)
  return built.routes
}

const ROUTE = '/api/chapters/:chapterId/prepare-archive/retry-stage/:stageName'

describe('retry-stage v4 — memoryExtract / memoryOptimize', () => {
  let mockPrisma: any
  let routes: Record<string, any>

  beforeEach(async () => {
    vi.clearAllMocks()
    mockPrisma = makePrisma()
    routes = await setupRoutes(mockPrisma)
  })

  it('rejects legacy stage name "memory" with 400', async () => {
    mockPrisma.chapter.findUnique.mockResolvedValue(
      makeChapter(makePendingV4({ status: 'success', result: rawMemoryResult, completedAt: ts }))
    )

    const result = await callHandler(
      routes, 'POST', ROUTE, undefined, { chapterId: 'abc', stageName: 'memory' }
    )

    expect(result.status).toBe(400)
    expect(result.body.success).toBe(false)
    expect(result.body.error).toMatch(/memoryExtract|memoryOptimize/)
    expect(runMemoryStage).not.toHaveBeenCalled()
    expect(optimizeMemories).not.toHaveBeenCalled()
  })

  it('retry-stage:memoryExtract reruns extract + optimizer', async () => {
    mockPrisma.chapter.findUnique.mockResolvedValue(
      makeChapter(makePendingV4({ status: 'failed', errorMessage: 'extract boom', completedAt: ts }))
    )
    ;(runMemoryStage as any).mockResolvedValue({
      status: 'success', result: rawMemoryResult, completedAt: ts
    })
    ;(optimizeMemories as any).mockResolvedValue([
      { content: '全局记忆', originUid: 'NEW', importance: 6, type: 'event' }
    ])

    const result = await callHandler(
      routes, 'POST', ROUTE, undefined, { chapterId: 'abc', stageName: 'memoryExtract' }
    )

    expect(result.status).toBeUndefined()
    expect(runMemoryStage).toHaveBeenCalled()
    expect(optimizeMemories).toHaveBeenCalled()

    const updateCall = mockPrisma.chapter.update.mock.calls.at(-1)
    const parsed = JSON.parse(updateCall[0].data.pendingArchiveData)
    expect(parsed.version).toBe(4)
    expect(parsed.stages.memoryExtract.status).toBe('success')
    expect(parsed.stages.memoryOptimize.status).toBe('success')
    expect(parsed.stages.memoryOptimize.result.memories).toEqual([
      { content: '全局记忆', originUid: 'NEW', importance: 6, type: 'event' }
    ])
    // 其他 stage 不动
    expect(parsed.stages.character.status).toBe('success')
    expect(parsed.stages.graph.status).toBe('success')
  })

  it('retry-stage:memoryOptimize only runs optimizer, requires extract success', async () => {
    mockPrisma.chapter.findUnique.mockResolvedValue(
      makeChapter(makePendingV4({ status: 'success', result: rawMemoryResult, completedAt: ts }))
    )
    ;(optimizeMemories as any).mockResolvedValue([
      { content: '重跑后的全局记忆', originUid: 'U1', importance: 8, type: 'state' }
    ])

    const result = await callHandler(
      routes, 'POST', ROUTE, undefined, { chapterId: 'abc', stageName: 'memoryOptimize' }
    )

    expect(result.status).toBeUndefined()
    expect(runMemoryStage).not.toHaveBeenCalled()
    expect(optimizeMemories).toHaveBeenCalled()

    const updateCall = mockPrisma.chapter.update.mock.calls.at(-1)
    const parsed = JSON.parse(updateCall[0].data.pendingArchiveData)
    expect(parsed.stages.memoryOptimize.status).toBe('success')
    expect(parsed.stages.memoryOptimize.result.memories).toEqual([
      { content: '重跑后的全局记忆', originUid: 'U1', importance: 8, type: 'state' }
    ])
    // memoryExtract 原样保留
    expect(parsed.stages.memoryExtract.status).toBe('success')
    expect(parsed.stages.memoryExtract.result).toEqual(rawMemoryResult)
  })

  it('retry-stage:memoryOptimize returns 400 if memoryExtract failed', async () => {
    mockPrisma.chapter.findUnique.mockResolvedValue(
      makeChapter(makePendingV4({ status: 'failed', errorMessage: 'extract boom', completedAt: ts }))
    )

    const result = await callHandler(
      routes, 'POST', ROUTE, undefined, { chapterId: 'abc', stageName: 'memoryOptimize' }
    )

    expect(result.status).toBe(400)
    expect(result.body.success).toBe(false)
    expect(result.body.error).toMatch(/memoryExtract/)
    expect(optimizeMemories).not.toHaveBeenCalled()
  })

  it('retry-stage:plotArc only feeds active/inactive arcs (not completed/closed)', async () => {
    mockPrisma.chapter.findUnique.mockResolvedValue(
      makeChapter(makePendingV4({ status: 'success', result: rawMemoryResult, completedAt: ts }))
    )
    ;(runPlotArcStage as any).mockResolvedValue({
      status: 'success', result: { plotArcs: [] }, completedAt: ts
    })

    const result = await callHandler(
      routes, 'POST', ROUTE, undefined, { chapterId: 'abc', stageName: 'plotArc' }
    )

    // 关键：不把 completed/closed 终态弧线喂给 AI（与 prepare-archive 对齐，防止复活）
    expect(mockPrisma.plotArc.findMany).toHaveBeenCalledWith({
      where: { storyId: 's1', status: { in: ['active', 'inactive'] } }
    })
    expect(runPlotArcStage).toHaveBeenCalled()
    expect(result.body.success).toBe(true)
  })
})
