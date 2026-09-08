import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createMockApp, callHandler } from '../setup.js'

// v3 拆 prepare-archive 为 4 stage 端点 + cancel + archive。
// 本文件仅覆盖 prepare-archive 端点的状态机预检 (400) 与 updateMany 锁已删除两点。
// 4 stage 并行写 v3 shape 的副作用已在 prepare-archive-v3.test.ts 覆盖, 此处不重复。
// cancel 与 archive 端点的专项测试分别落在 Task 3.3 / Task 4.2。
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

import { runCharacterStage } from '../../services/stages/character-stage.js'
import { runMemoryStage } from '../../services/stages/memory-stage.js'
import { runPlotArcStage } from '../../services/stages/plot-arc-stage.js'
import { runGraphExtractStage } from '../../services/stages/graph-extract-stage.js'

const ts = '2026-07-25T00:00:00.000Z'

const baseChapter = {
  id: 'c1',
  storyId: 's1',
  isSideStory: false,
  content: 'a'.repeat(200),
  outline: 'short outline',
  number: 1,
  parentChapterId: null,
  pendingArchiveData: null,
  chapterGraph: null,
  cumulativeGraph: null
}

/** 让 4 个 stage 都返回 success, 以便穿过 route 的并行段。 */
function mockAllStagesSuccess() {
  ;(runCharacterStage as any).mockResolvedValue({
    status: 'success', result: { characterStates: [] }, completedAt: ts
  })
  ;(runMemoryStage as any).mockResolvedValue({
    status: 'success',
    result: {
      mainEvents: [], sideEvents: [], emotions: [], foreshadowing: [],
      relationshipChanges: [], scenes: [], summary: ''
    },
    completedAt: ts
  })
  ;(runPlotArcStage as any).mockResolvedValue({
    status: 'success', result: { plotArcs: [] }, completedAt: ts
  })
  ;(runGraphExtractStage as any).mockResolvedValue({
    status: 'success',
    result: { chapterGraph: { nodes: [], edges: [], timestamp: ts } },
    completedAt: ts
  })
}

function makePrisma() {
  return {
    chapter: {
      findUnique: vi.fn(),
      findFirst: vi.fn().mockResolvedValue(null),
      update: vi.fn(),
      updateMany: vi.fn().mockResolvedValue({ count: 1 })
    },
    character: { findMany: vi.fn().mockResolvedValue([]) },
    characterBranchState: { findMany: vi.fn().mockResolvedValue([]) },
    plotArc: { findMany: vi.fn().mockResolvedValue([]) }
  }
}

async function setupRoutes(mockPrisma: any) {
  const { chapterRoutes } = await import('../../routes/chapters.js')
  const built = createMockApp(mockPrisma)
  await chapterRoutes(built.app)
  return built.routes
}

describe('prepare-archive route — v3 status pre-check (no updateMany lock)', () => {
  let mockPrisma: any
  let routes: Record<string, any>

  beforeEach(async () => {
    vi.clearAllMocks()
    mockPrisma = makePrisma()
    routes = await setupRoutes(mockPrisma)
  })

  it('returns 400 when chapter.status is archived (pre-check rejects archived)', async () => {
    // v3: 状态机预检 — 非法入口在 findUnique 后立刻 400,
    // 不依赖 updateMany 锁竞争路径。archived → 不可 prepare。
    mockPrisma.chapter.findUnique.mockResolvedValue({
      ...baseChapter,
      status: 'archived'
    })

    const result = await callHandler(
      routes, 'POST', '/api/chapters/:chapterId/prepare-archive',
      undefined, { chapterId: 'c1' }
    )

    expect(result.status).toBe(400)
    expect(result.body.error).toContain('archived')

    // 预检失败后不应有任何 chapter.update 调用 (无锁竞争, 无副作用)
    expect(mockPrisma.chapter.update).not.toHaveBeenCalled()
    // v3 彻底移除 updateMany 锁: 全程不应有 updateMany 调用
    expect(mockPrisma.chapter.updateMany).not.toHaveBeenCalled()
  })

  it('uses updateMany optimistic lock on final write-back (from draft)', async () => {
    // v4: 最终写回用 updateMany 乐观锁（where status='reviewing'），防止覆盖 cancel。
    mockAllStagesSuccess()
    mockPrisma.chapter.findUnique.mockResolvedValue({
      ...baseChapter,
      status: 'draft'
    })

    await callHandler(
      routes, 'POST', '/api/chapters/:chapterId/prepare-archive',
      undefined, { chapterId: 'c1' }
    )

    expect(mockPrisma.chapter.updateMany).toHaveBeenCalledWith({
      where: { id: 'c1', status: 'reviewing' },
      data: expect.objectContaining({ status: 'reviewing', pendingArchiveData: expect.any(String) })
    })
  })

  it('uses updateMany optimistic lock when re-preparing from reviewing', async () => {
    mockAllStagesSuccess()
    mockPrisma.chapter.findUnique.mockResolvedValue({
      ...baseChapter,
      status: 'reviewing',
      pendingArchiveData: '"stale"'
    })

    await callHandler(
      routes, 'POST', '/api/chapters/:chapterId/prepare-archive',
      undefined, { chapterId: 'c1' }
    )

    expect(mockPrisma.chapter.updateMany).toHaveBeenCalledWith({
      where: { id: 'c1', status: 'reviewing' },
      data: expect.objectContaining({ status: 'reviewing', pendingArchiveData: expect.any(String) })
    })
  })

  it('clears stale pendingArchiveData via update, then writes back via updateMany optimistic lock', async () => {
    // re-prepare: 第一波 update 清 pendingArchiveData（无锁），最终写回用 updateMany 乐观锁。
    mockAllStagesSuccess()
    mockPrisma.chapter.findUnique.mockResolvedValue({
      ...baseChapter,
      status: 'reviewing',
      pendingArchiveData: '"stale"'
    })

    await callHandler(
      routes, 'POST', '/api/chapters/:chapterId/prepare-archive',
      undefined, { chapterId: 'c1' }
    )

    // 第一波 update 应包含 pendingArchiveData: null + status: reviewing
    const clearCall = mockPrisma.chapter.update.mock.calls.find(
      (call: any[]) =>
        call[0]?.where?.id === 'c1' &&
        call[0]?.data?.pendingArchiveData === null
    )
    expect(clearCall).toBeDefined()
    expect(clearCall[0].data.status).toBe('reviewing')

    // 最终写回走 updateMany 乐观锁
    const finalUpdateCall = mockPrisma.chapter.updateMany.mock.calls.find(
      (call: any[]) =>
        call[0]?.where?.id === 'c1' &&
        typeof call[0]?.data?.pendingArchiveData === 'string'
    )
    expect(finalUpdateCall).toBeDefined()
    expect(finalUpdateCall[0].data.pendingArchiveData).not.toBe('')
    expect(JSON.parse(finalUpdateCall[0].data.pendingArchiveData).version).toBe(4)
  })

  it('accepts draft state without 409 — no updateMany race barrier', async () => {
    // 反例: 旧版本曾用 409 表示 updateMany count=0 (并发抢走)。
    // v3 删掉了 lock, 也不再有 409 path; 错误的入口状态才返回 400。
    mockAllStagesSuccess()
    mockPrisma.chapter.findUnique.mockResolvedValue({
      ...baseChapter,
      status: 'draft'
    })

    const result = await callHandler(
      routes, 'POST', '/api/chapters/:chapterId/prepare-archive',
      undefined, { chapterId: 'c1' }
    )

    expect(result.status).not.toBe(409)
  })
})

describe('prepare-archive route — v3 short-circuits', () => {
  let mockPrisma: any
  let routes: Record<string, any>

  beforeEach(async () => {
    vi.clearAllMocks()
    mockPrisma = makePrisma()
    routes = await setupRoutes(mockPrisma)
  })

  it('returns 400 when content is shorter than outline without invoking stages or updates', async () => {
    mockPrisma.chapter.findUnique.mockResolvedValue({
      ...baseChapter,
      status: 'draft',
      content: 'short',
      outline: 'a longer outline'
    })

    const result = await callHandler(
      routes, 'POST', '/api/chapters/:chapterId/prepare-archive',
      undefined, { chapterId: 'c1' }
    )

    expect(result.status).toBe(400)
    expect(runCharacterStage).not.toHaveBeenCalled()
    expect(runMemoryStage).not.toHaveBeenCalled()
    expect(runPlotArcStage).not.toHaveBeenCalled()
    expect(runGraphExtractStage).not.toHaveBeenCalled()
    expect(mockPrisma.chapter.update).not.toHaveBeenCalled()
    expect(mockPrisma.chapter.updateMany).not.toHaveBeenCalled()
  })

  it('side story short-circuits to archived without invoking stages', async () => {
    mockPrisma.chapter.findUnique.mockResolvedValue({
      ...baseChapter,
      status: 'draft',
      isSideStory: true
    })

    const result = await callHandler(
      routes, 'POST', '/api/chapters/:chapterId/prepare-archive',
      undefined, { chapterId: 'c1' }
    )

    expect(result.body).toEqual(expect.objectContaining({
      success: true,
      data: expect.objectContaining({ sideStory: true, status: 'archived' })
    }))
    const updateCall = mockPrisma.chapter.update.mock.calls[0]
    expect(updateCall[0].data.status).toBe('archived')
  })

  it('chapter with no content short-circuits to archived without invoking stages', async () => {
    mockPrisma.chapter.findUnique.mockResolvedValue({
      ...baseChapter,
      status: 'draft',
      content: ''
    })

    const result = await callHandler(
      routes, 'POST', '/api/chapters/:chapterId/prepare-archive',
      undefined, { chapterId: 'c1' }
    )

    expect(result.body).toEqual(expect.objectContaining({
      success: true,
      data: expect.objectContaining({ noContent: true, status: 'archived' })
    }))
  })
})
