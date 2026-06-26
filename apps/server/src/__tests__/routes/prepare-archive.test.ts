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

describe('prepare-archive route — error rollback', () => {
  let mockPrisma: any
  let routes: Record<string, any>

  beforeEach(async () => {
    vi.clearAllMocks()
    mockPrisma = {
      chapter: {
        findUnique: vi.fn(),
        update: vi.fn(),
        // Task 14: prepare-archive now acquires an atomic updateMany status
        // lock before calling prepareArchiveData. Default to success so the
        // rollback test reaches the prepareArchiveData call.
        updateMany: vi.fn().mockResolvedValue({ count: 1 })
      }
    }
    const { chapterRoutes } = await import('../../routes/chapters.js')
    const built = createMockApp(mockPrisma)
    await chapterRoutes(built.app)
    routes = built.routes
  })

  it('rolls back chapter.status to selected when prepareArchiveData throws', async () => {
    mockPrisma.chapter.findUnique.mockResolvedValue({
      id: 'c1',
      storyId: 's1',
      status: 'selected',
      isSideStory: false,
      content: 'a'.repeat(200),
      outline: 'short outline',
      number: 1,
      parentChapterId: null,
      story: { id: 's1' }
    })
    mockPrisma.chapter.update.mockResolvedValue({ id: 'c1', status: 'selected' })
    ;(prepareArchiveData as any).mockRejectedValue(new Error('AI extraction failed'))

    const result = await callHandler(
      routes,
      'POST',
      '/api/chapters/:chapterId/prepare-archive',
      undefined,
      { chapterId: 'c1' }
    )

    // After a thrown prepareArchiveData, the route must attempt to roll
    // chapter.status back to 'selected'. The rollback update is what the
    // task is verifying — without it, the chapter is left in 'selected'
    // (status update to 'reviewing' is AFTER prepareArchiveData in the
    // current code, so without rollback it stays 'selected', which is
    // actually fine — but the test guards future reordering where the
    // status flip might move ahead of the AI call).
    const rollbackCall = mockPrisma.chapter.update.mock.calls.find(
      (call: any[]) =>
        call[0]?.where?.id === 'c1' &&
        call[0]?.data?.status === 'selected'
    )
    expect(rollbackCall).toBeDefined()

    expect(result.status).toBe(500)
    expect(result.body).toEqual(
      expect.objectContaining({ success: false })
    )
  })
})

describe('prepare-archive route — re-prepare from reviewing (Q#11)', () => {
  // 用户场景：上次 prepare-archive 失败把 chapter 卡在 reviewing +
  // pendingArchiveData=null，唯一的恢复按钮是删除章节。现在需要支持从
  // reviewing 状态重新触发 prepare-archive（覆盖 pendingArchiveData），
  // 让用户修了 AI 配置后能继续归档，不用丢章节。

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
    // 旧的 updateMany 锁只接受 status='selected'。Reviewing 状态会拿到
    // count=0，被 409 拒掉。新行为允许从 reviewing 重试。
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

    // 路由成功路径用 bare return (Fastify 默认 200)，不显式 set status。
    // 所以这里只看：不是 409 + body.success=true。
    expect(result.status).not.toBe(409)
    expect(result.body).toEqual(expect.objectContaining({ success: true }))
  })

  it('uses updateMany where status IN (selected, reviewing) — rejects only illegal statuses', async () => {
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

    // 锁必须接受 reviewing，否则 409
    const lockCall = mockPrisma.chapter.updateMany.mock.calls.find(
      (call: any[]) =>
        call[0]?.where?.id === 'c1' &&
        call[0]?.data?.status === 'reviewing'
    )
    expect(lockCall).toBeDefined()
    // where.status 应该是 { in: [...] } 结构
    expect(lockCall[0].where.status).toEqual({ in: ['selected', 'reviewing'] })
  })

  it('rejects status=generated with 400 — illegal transition caught by pre-check', async () => {
    // 回归测试：其他状态（generated, scored, archived）仍要被拒掉。
    // pre-check 在 updateMany 锁之前用 400 拦掉（更清晰的错误信息），
    // 409 只用于并发竞态。
    mockPrisma.chapter.findUnique.mockResolvedValue({
      id: 'c1',
      storyId: 's1',
      status: 'generated',
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
  })

  it('clears stale pendingArchiveData on re-prepare so the new payload can take over', async () => {
    // 用户场景：reviewing + 有 stale/损坏的 pendingArchiveData。重试时
    // 必须先清掉，否则会保留脏数据。updateMany 的 data 应该包含
    // pendingArchiveData: null。
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

  it('rolls back to reviewing (not selected) when re-prepare from reviewing fails', async () => {
    // 关键：不破坏 reviewing 状态的"可重试"语义。如果回滚总是 selected，
    // 用户就只能在 selected 状态重试，无法从 reviewing 直接 retry。
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
    mockPrisma.chapter.update.mockResolvedValue({ id: 'c1', status: 'reviewing' })
    ;(prepareArchiveData as any).mockRejectedValue(new Error('AI extraction still failing'))

    await callHandler(
      routes,
      'POST',
      '/api/chapters/:chapterId/prepare-archive',
      undefined,
      { chapterId: 'c1' }
    )

    // 回滚必须把 status 改回 'reviewing'（原状态），不是 'selected'
    const rollbackCall = mockPrisma.chapter.update.mock.calls.find(
      (call: any[]) =>
        call[0]?.where?.id === 'c1' &&
        (call[0]?.data?.status === 'reviewing' || call[0]?.data?.status === 'selected')
    )
    expect(rollbackCall).toBeDefined()
    expect(rollbackCall[0].data.status).toBe('reviewing')
  })

  it('rolls back to selected (not reviewing) when first-time prepare fails from selected', async () => {
    // 回归测试：原始行为 — selected → 失败 → 回滚 selected。如果新逻辑
    // 错误地总是用 'reviewing' 当 preLockStatus 默认值，这个测试会失败。
    mockPrisma.chapter.findUnique.mockResolvedValue({
      id: 'c1',
      storyId: 's1',
      status: 'selected',
      isSideStory: false,
      content: 'a'.repeat(200),
      outline: 'short outline',
      number: 1,
      parentChapterId: null,
      story: { id: 's1' }
    })
    mockPrisma.chapter.update.mockResolvedValue({ id: 'c1', status: 'selected' })
    ;(prepareArchiveData as any).mockRejectedValue(new Error('AI extraction failed'))

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
        (call[0]?.data?.status === 'reviewing' || call[0]?.data?.status === 'selected')
    )
    expect(rollbackCall).toBeDefined()
    expect(rollbackCall[0].data.status).toBe('selected')
  })
})