import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createMockApp, callHandler } from '../setup.js'

// Mock the prepareArchiveData service so the route does not hit the real
// AI extraction path. The actual import in chapters.ts is:
//   `import { extractAll, prepareArchiveData, type PendingArchiveData } from '../services/combined-extractor.js'`
// Vitest resolves the mock via the same relative path the route uses.
vi.mock('../../services/combined-extractor.js', () => ({
  prepareArchiveData: vi.fn(),
  extractAll: vi.fn()
}))

import { prepareArchiveData } from '../../services/combined-extractor.js'

const VALID_PENDING = {
  memories: { memories: [], characterStates: [], timelineEvents: [], summary: null, timelinePosition: null },
  graph: {
    mergedGraph: { nodes: [], edges: [], timestamp: '2026-06-17T00:00:00.000Z' },
    chapterGraph: { nodes: [], edges: [], timestamp: '2026-06-17T00:00:00.000Z' }
  },
  plotArcs: [],
  meta: { extractedAt: '2026-06-17T00:00:00.000Z', chapterNumber: 1 }
}

describe('prepare-archive route — v2 rollback to draft', () => {
  let mockPrisma: any
  let routes: Record<string, any>

  beforeEach(async () => {
    vi.clearAllMocks()
    mockPrisma = {
      chapter: {
        findUnique: vi.fn(),
        update: vi.fn(),
        updateMany: vi.fn().mockResolvedValue({ count: 1 })
      }
    }
    const { chapterRoutes } = await import('../../routes/chapters.js')
    const built = createMockApp(mockPrisma)
    await chapterRoutes(built.app)
    routes = built.routes
  })

  it('rolls back chapter.status to draft (not preLockStatus) when prepareArchiveData throws', async () => {
    // v2: 失败回退统一到 'draft', 不再依赖 preLockStatus。
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
    mockPrisma.chapter.update.mockResolvedValue({ id: 'c1', status: 'draft' })
    ;(prepareArchiveData as any).mockRejectedValue(new Error('AI extraction failed'))

    const result = await callHandler(
      routes,
      'POST',
      '/api/chapters/:chapterId/prepare-archive',
      undefined,
      { chapterId: 'c1' }
    )

    const rollbackCall = mockPrisma.chapter.update.mock.calls.find(
      (call: any[]) =>
        call[0]?.where?.id === 'c1' &&
        call[0]?.data?.status === 'draft'
    )
    expect(rollbackCall).toBeDefined()

    expect(result.status).toBe(500)
    expect(result.body).toEqual(
      expect.objectContaining({ success: false })
    )
  })
})

describe('prepare-archive route — v2 re-prepare from reviewing', () => {
  let mockPrisma: any
  let routes: Record<string, any>

  beforeEach(async () => {
    vi.clearAllMocks()
    mockPrisma = {
      chapter: {
        findUnique: vi.fn(),
        update: vi.fn(),
        updateMany: vi.fn().mockResolvedValue({ count: 1 })
      }
    }
    const { chapterRoutes } = await import('../../routes/chapters.js')
    const built = createMockApp(mockPrisma)
    await chapterRoutes(built.app)
    routes = built.routes
  })

  it('accepts reviewing state — does not 409 when chapter.status is reviewing', async () => {
    mockPrisma.chapter.findUnique.mockResolvedValue({
      id: 'c1',
      storyId: 's1',
      status: 'reviewing',
      isSideStory: false,
      content: 'a'.repeat(200),
      outline: 'short outline',
      number: 1,
      parentChapterId: null,
      pendingArchiveData: null,
      story: { id: 's1' }
    })
    ;(prepareArchiveData as any).mockResolvedValue(VALID_PENDING)

    const result = await callHandler(
      routes,
      'POST',
      '/api/chapters/:chapterId/prepare-archive',
      undefined,
      { chapterId: 'c1' }
    )

    expect(result.status).not.toBe(409)
    expect(result.body).toEqual(expect.objectContaining({ success: true }))
  })

  it('uses updateMany where status IN [draft, reviewing] — rejects only archived', async () => {
    mockPrisma.chapter.findUnique.mockResolvedValue({
      id: 'c1',
      storyId: 's1',
      status: 'reviewing',
      isSideStory: false,
      content: 'a'.repeat(200),
      outline: 'short outline',
      number: 1,
      parentChapterId: null,
      pendingArchiveData: null,
      story: { id: 's1' }
    })
    ;(prepareArchiveData as any).mockResolvedValue(VALID_PENDING)

    await callHandler(
      routes,
      'POST',
      '/api/chapters/:chapterId/prepare-archive',
      undefined,
      { chapterId: 'c1' }
    )

    const lockCall = mockPrisma.chapter.updateMany.mock.calls.find(
      (call: any[]) =>
        call[0]?.where?.id === 'c1' &&
        call[0]?.data?.status === 'reviewing'
    )
    expect(lockCall).toBeDefined()
    // v2: 锁条件改为 ['draft', 'reviewing']
    expect(lockCall[0].where.status).toEqual({ in: ['draft', 'reviewing'] })
  })

  it('rejects archived status with 409 — illegal transition caught by lock', async () => {
    // v2: 预检只允许 [draft, reviewing]; archived 不是合法入口。
    // 预检会 400 拦截,而 updateMany 锁竞争路径处理更少见的状态竞态
    // (findUnique 读到允许值但被并发抢走)。
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
    // 锁 count=0, 模拟并发抢走 (findUnique 看到 draft 但实际已经被并发改成 archived)
    mockPrisma.chapter.updateMany.mockResolvedValue({ count: 0 })

    const result = await callHandler(
      routes,
      'POST',
      '/api/chapters/:chapterId/prepare-archive',
      undefined,
      { chapterId: 'c1' }
    )

    expect(result.status).toBe(409)
  })

  it('clears stale pendingArchiveData on re-prepare so the new payload can take over', async () => {
    mockPrisma.chapter.findUnique.mockResolvedValue({
      id: 'c1',
      storyId: 's1',
      status: 'reviewing',
      isSideStory: false,
      content: 'a'.repeat(200),
      outline: 'short outline',
      number: 1,
      parentChapterId: null,
      pendingArchiveData: '"stale"',
      story: { id: 's1' }
    })
    ;(prepareArchiveData as any).mockResolvedValue(VALID_PENDING)

    await callHandler(
      routes,
      'POST',
      '/api/chapters/:chapterId/prepare-archive',
      undefined,
      { chapterId: 'c1' }
    )

    const lockCall = mockPrisma.chapter.updateMany.mock.calls.find(
      (call: any[]) => call[0]?.where?.id === 'c1'
    )
    expect(lockCall).toBeDefined()
    expect(lockCall[0].data.pendingArchiveData).toBeNull()
  })

  it('rolls back to draft (not reviewing) when re-prepare from reviewing fails', async () => {
    // v2: 失败统一回退到 'draft', 不再保留 retry 入口到 'reviewing'。
    mockPrisma.chapter.findUnique.mockResolvedValue({
      id: 'c1',
      storyId: 's1',
      status: 'reviewing',
      isSideStory: false,
      content: 'a'.repeat(200),
      outline: 'short outline',
      number: 1,
      parentChapterId: null,
      pendingArchiveData: null,
      story: { id: 's1' }
    })
    mockPrisma.chapter.update.mockResolvedValue({ id: 'c1', status: 'draft' })
    ;(prepareArchiveData as any).mockRejectedValue(new Error('AI extraction still failing'))

    await callHandler(
      routes,
      'POST',
      '/api/chapters/:chapterId/prepare-archive',
      undefined,
      { chapterId: 'c1' }
    )

    const rollbackCall = mockPrisma.chapter.update.mock.calls.find(
      (call: any[]) =>
        call[0]?.where?.id === 'c1' &&
        call[0]?.data?.status === 'draft'
    )
    expect(rollbackCall).toBeDefined()
    expect(rollbackCall[0].data.status).toBe('draft')
  })
})
