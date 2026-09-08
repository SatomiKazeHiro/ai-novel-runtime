import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createMockApp, callHandler } from '../setup.js'

// v4 拆分: prepare-archive 把 v3 单 memory stage 拆为 memoryExtract + memoryOptimize 两 stage。
// 本文件验证:
//   1. 5 stage 并行 + pendingData.version === 4 + 字段名 memoryExtract/memoryOptimize
//   2. memoryOptimize 失败隔离 (raw 仍 success)
//   3. memoryExtract 失败 → memoryOptimize 不调 (no wasted work)

// Mock 4 个 stage + optimizer (chapters-archive 不直接 import runtime-loader, 通过 stages 内部调)
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

import { runCharacterStage } from '../../services/stages/character-stage.js'
import { runMemoryStage } from '../../services/stages/memory-stage.js'
import { runPlotArcStage } from '../../services/stages/plot-arc-stage.js'
import { runGraphExtractStage } from '../../services/stages/graph-extract-stage.js'
import { optimizeMemories } from '../../services/memory-optimizer.js'

const ts = '2026-07-31T00:00:00.000Z'

const baseChapter = {
  id: 'c1',
  storyId: 's1',
  status: 'draft',
  isSideStory: false,
  content: 'a'.repeat(200),
  outline: 'short outline',
  number: 1,
  parentChapterId: null,
  pendingArchiveData: null,
  chapterGraph: null,
  cumulativeGraph: null
}

/**
 * 默认 mock: 4 stage 全 success (memory 返回 raw result,无 memories 字段) +
 * optimizer 返回 1 个 global 记忆。
 */
function mockAllSuccess() {
  ;(runCharacterStage as any).mockResolvedValue({
    status: 'success', result: { characterStates: [] }, completedAt: ts
  })
  ;(runMemoryStage as any).mockResolvedValue({
    status: 'success',
    result: {
      mainEvents: [{ description: '主要事件', importance: 7 }],
      sideEvents: [], emotions: [], foreshadowing: [],
      relationshipChanges: [], scenes: [], summary: '摘要'
    },
    completedAt: ts
  })
  ;(runPlotArcStage as any).mockResolvedValue({
    status: 'success', result: { plotArcs: [] }, completedAt: ts
  })
  ;(runGraphExtractStage as any).mockResolvedValue({
    status: 'success', result: { chapterGraph: { nodes: [], edges: [], timestamp: ts } }, completedAt: ts
  })
  ;(optimizeMemories as any).mockResolvedValue([
    { content: '全局记忆', originUid: 'NEW', importance: 6, type: 'event' }
  ])
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

describe('prepare-archive v4 — split memory into memoryExtract + memoryOptimize', () => {
  let mockPrisma: any
  let routes: Record<string, any>

  beforeEach(async () => {
    vi.clearAllMocks()
    mockPrisma = makePrisma()
    routes = await setupRoutes(mockPrisma)
  })

  it('writes 5 stages separately (memoryExtract + memoryOptimize) with version 4', async () => {
    mockAllSuccess()
    mockPrisma.chapter.findUnique.mockResolvedValue({ ...baseChapter })

    const result = await callHandler(
      routes, 'POST', '/api/chapters/:chapterId/prepare-archive',
      undefined, { chapterId: 'c1' }
    )

    // 4 stage 全跑 + optimizer 全跑
    expect(runCharacterStage).toHaveBeenCalled()
    expect(runMemoryStage).toHaveBeenCalled()
    expect(runPlotArcStage).toHaveBeenCalled()
    expect(runGraphExtractStage).toHaveBeenCalled()
    expect(optimizeMemories).toHaveBeenCalled()

    // 解析最后一次 chapter.update 写入的 pendingArchiveData
    const updateCalls = mockPrisma.chapter.update.mock.calls.filter(
      (c: any[]) => c[0]?.data?.pendingArchiveData && c[0].data.pendingArchiveData !== null
    )
    expect(updateCalls.length).toBeGreaterThan(0)
    const parsed = JSON.parse(updateCalls[updateCalls.length - 1][0].data.pendingArchiveData)

    // v4 关键断言
    expect(parsed.version).toBe(4)
    // 其他 4 stage 都应保持 success,不被 memory 拆分影响
    expect(parsed.stages.character.status).toBe('success')
    expect(parsed.stages.character.result).toEqual({ characterStates: [] })
    expect(parsed.stages.plotArc.status).toBe('success')
    expect(parsed.stages.plotArc.result).toEqual({ plotArcs: [] })
    expect(parsed.stages.graph.status).toBe('success')
    expect(parsed.stages.graph.result).toEqual({ chapterGraph: { nodes: [], edges: [], timestamp: ts } })
    // 拆分后的 2 stage
    expect(parsed.stages.memoryExtract.status).toBe('success')
    expect(parsed.stages.memoryOptimize.status).toBe('success')
    // 旧 v3 memory 字段不应再存在
    expect(parsed.stages.memory).toBeUndefined()
    // 优化结果应写入 memoryOptimize.result.memories
    expect(parsed.stages.memoryOptimize.result.memories).toEqual([
      { content: '全局记忆', originUid: 'NEW', importance: 6, type: 'event' }
    ])
  })

  it('memoryOptimize fails independently when provider throws (raw still success)', async () => {
    mockAllSuccess()
    mockPrisma.chapter.findUnique.mockResolvedValue({ ...baseChapter })
    // optimizer 抛错
    ;(optimizeMemories as any).mockRejectedValueOnce(new Error('optimizer boom'))

    const result = await callHandler(
      routes, 'POST', '/api/chapters/:chapterId/prepare-archive',
      undefined, { chapterId: 'c1' }
    )

    // 整个 prepare-archive 不应 200/500 失败;应是 200 + 失败 stage 单独标记
    expect(result.status).toBeUndefined() // bare return, 不是 reply.send
    const updateCalls = mockPrisma.chapter.update.mock.calls.filter(
      (c: any[]) => c[0]?.data?.pendingArchiveData && c[0].data.pendingArchiveData !== null
    )
    expect(updateCalls.length).toBeGreaterThan(0)
    const parsed = JSON.parse(updateCalls[updateCalls.length - 1][0].data.pendingArchiveData)

    // pendingData 整体形状正确
    expect(parsed.version).toBe(4)
    // 其他 4 stage 不应受 optimizer 失败影响
    expect(parsed.stages.character.status).toBe('success')
    expect(parsed.stages.character.result).toEqual({ characterStates: [] })
    expect(parsed.stages.plotArc.status).toBe('success')
    expect(parsed.stages.plotArc.result).toEqual({ plotArcs: [] })
    expect(parsed.stages.graph.status).toBe('success')
    expect(parsed.stages.graph.result).toEqual({ chapterGraph: { nodes: [], edges: [], timestamp: ts } })
    // memoryExtract 仍 success (raw 抽取不受影响)
    expect(parsed.stages.memoryExtract.status).toBe('success')
    expect(parsed.stages.memoryExtract.result.mainEvents).toEqual([{ description: '主要事件', importance: 7 }])
    // memoryOptimize 失败独立标记
    expect(parsed.stages.memoryOptimize.status).toBe('failed')
    expect(parsed.stages.memoryOptimize.errorMessage).toContain('optimizer boom')
  })

  it('memoryExtract failed → optimizer not called (no wasted work)', async () => {
    mockAllSuccess()
    mockPrisma.chapter.findUnique.mockResolvedValue({ ...baseChapter })
    // memory stage 返回 failed (raw 抽取失败)
    ;(runMemoryStage as any).mockResolvedValueOnce({
      status: 'failed', errorMessage: 'extract boom', completedAt: ts
    })

    const result = await callHandler(
      routes, 'POST', '/api/chapters/:chapterId/prepare-archive',
      undefined, { chapterId: 'c1' }
    )

    // 整个 prepare-archive 不应 throw
    expect(result.status).toBeUndefined()
    // 关键: optimizer 完全不应被调用
    expect(optimizeMemories).not.toHaveBeenCalled()

    const updateCalls = mockPrisma.chapter.update.mock.calls.filter(
      (c: any[]) => c[0]?.data?.pendingArchiveData && c[0].data.pendingArchiveData !== null
    )
    expect(updateCalls.length).toBeGreaterThan(0)
    const parsed = JSON.parse(updateCalls[updateCalls.length - 1][0].data.pendingArchiveData)

    // 整体形状正确 (version 4)
    expect(parsed.version).toBe(4)
    // 其他 4 stage 不应受 memoryExtract 失败影响
    expect(parsed.stages.character.status).toBe('success')
    expect(parsed.stages.character.result).toEqual({ characterStates: [] })
    expect(parsed.stages.plotArc.status).toBe('success')
    expect(parsed.stages.plotArc.result).toEqual({ plotArcs: [] })
    expect(parsed.stages.graph.status).toBe('success')
    expect(parsed.stages.graph.result).toEqual({ chapterGraph: { nodes: [], edges: [], timestamp: ts } })
    // memoryExtract 失败,memoryOptimize 也应标记 failed (带明确原因)
    expect(parsed.stages.memoryExtract.status).toBe('failed')
    expect(parsed.stages.memoryExtract.errorMessage).toBe('extract boom')
    expect(parsed.stages.memoryOptimize.status).toBe('failed')
    expect(parsed.stages.memoryOptimize.errorMessage).toContain('memoryExtract')
  })
})
