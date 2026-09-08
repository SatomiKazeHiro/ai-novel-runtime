import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createMockApp, callHandler, createMockPrisma } from '../setup.js'

describe('generate route — v2 orthogonal to chapter status (3-value enum)', () => {
  let mockPrisma: any
  let routes: Record<string, any>

  beforeEach(async () => {
    mockPrisma = createMockPrisma({
      loreItem: { findMany: vi.fn().mockResolvedValue([]) },
      plotArc: { findMany: vi.fn().mockResolvedValue([]) },
      characterBranchState: { findMany: vi.fn().mockResolvedValue([]) },
      memory: { findMany: vi.fn().mockResolvedValue([]) },
      character: { findMany: vi.fn().mockResolvedValue([]) },
      runtimeProfile: {
        findUnique: vi.fn().mockResolvedValue(null),
        findFirst: vi.fn().mockResolvedValue(null)
      },
      storyWorkerBinding: {
        findUnique: vi.fn().mockResolvedValue(null)
      },
      workerTask: {
        findUnique: vi.fn().mockResolvedValue(null),
        findFirst: vi.fn().mockResolvedValue(null)
      },
      aiProviderConfig: {
        findFirst: vi.fn().mockResolvedValue(null),
        findMany: vi.fn().mockResolvedValue([])
      }
    })
    const { chapterRoutes } = await import('../../routes/chapters.js')
    const built = createMockApp(mockPrisma)
    await chapterRoutes(built.app)
    routes = built.routes
  })

  function setupChapter(status: string) {
    mockPrisma.chapter.findUnique.mockResolvedValue({
      id: 'c1',
      storyId: 's1',
      status,
      content: status === 'reviewing' ? 'existing content' : '',
      outline: 'outline',
      title: 'Title',
      sceneLocation: '',
      sceneMood: '',
      sceneGoal: '',
      number: 1,
      isSideStory: false,
      story: { id: 's1', title: 'Story', description: '' }
    })
    mockPrisma.draft.count.mockResolvedValue(0)
    mockPrisma.draft.create.mockResolvedValue({ id: 'd1' })
  }

  it('rejects archived status with 400 (only blocked state)', async () => {
    setupChapter('archived')
    const result = await callHandler(
      routes, 'POST', '/api/chapters/:chapterId/generate', {}, { chapterId: 'c1' }
    )
    expect(result.status).toBe(400)
    expect(result.body.error).toMatch(/已归档章节不能生成新草稿/)
  })

  it('accepts draft status (orthogonal — no lock)', async () => {
    setupChapter('draft')
    const result = await callHandler(
      routes, 'POST', '/api/chapters/:chapterId/generate', {}, { chapterId: 'c1' }
    )
    expect(result.status).not.toBe(400)
    expect(mockPrisma.draft.create).toHaveBeenCalled()
  })

  it('accepts reviewing status (orthogonal — no lock)', async () => {
    setupChapter('reviewing')
    const result = await callHandler(
      routes, 'POST', '/api/chapters/:chapterId/generate', {}, { chapterId: 'c1' }
    )
    // v2: draft adds even when reviewing — fine, candidates are independent of chapter.status
    expect(result.status).not.toBe(400)
    expect(mockPrisma.draft.create).toHaveBeenCalled()
  })

  it('does NOT delete existing drafts (additive only — spec §2.1.4)', async () => {
    setupChapter('draft')
    await callHandler(
      routes, 'POST', '/api/chapters/:chapterId/generate', {}, { chapterId: 'c1' }
    )
    expect(mockPrisma.draft.deleteMany).not.toHaveBeenCalled()
  })

  it('concurrent double-click produces 2 batches of drafts (no chapter.status lock)', async () => {
    // v2 故意不加锁: 同一 chapter 并发两次 generate → 各入队一批 draft,
    // 默认 candidateCount=3, 所以两次请求 → 6 个 draft 创建调用。
    setupChapter('draft')
    mockPrisma.draft.count.mockResolvedValue(0)

    const result1 = await callHandler(
      routes, 'POST', '/api/chapters/:chapterId/generate', {}, { chapterId: 'c1' }
    )
    const result2 = await callHandler(
      routes, 'POST', '/api/chapters/:chapterId/generate', {}, { chapterId: 'c1' }
    )

    // 两次都不应 409, 也不应 400
    expect(result1.status).not.toBe(400)
    expect(result2.status).not.toBe(400)
    // 两次都创建了 draft (各 candidateCount 个, 默认 3)
    expect(mockPrisma.draft.create.mock.calls.length).toBeGreaterThanOrEqual(6)
    // 没有调用 chapter.update 去翻 status (只写 compiledPrompt)
    const statusFlips = mockPrisma.chapter.update.mock.calls.filter(
      (c: any[]) => c[0]?.data?.status !== undefined
    )
    expect(statusFlips).toHaveLength(0)
  })
})

describe('select route — v2 orthogonal to chapter status (3-value enum)', () => {
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

  it('accepts draft status (v2 — orthogonal)', async () => {
    mockPrisma.chapter.findUnique.mockResolvedValue({
      id: 'c1', status: 'draft', content: 'old'
    })
    mockPrisma.draft.findUnique.mockResolvedValue({
      id: 'd_new', chapterId: 'c1', content: 'new content', status: 'completed'
    })
    mockPrisma.draft.updateMany.mockResolvedValue({ count: 1 })
    mockPrisma.chapter.update.mockResolvedValue({ id: 'c1', status: 'draft' })

    const result = await callHandler(
      routes, 'POST', '/api/chapters/:chapterId/select',
      { draftId: 'd_new' }, { chapterId: 'c1' }
    )

    expect(result.status).not.toBe(400)
    expect(mockPrisma.$transaction).toHaveBeenCalled()
  })

  it('accepts reviewing status (v2 — orthogonal)', async () => {
    mockPrisma.chapter.findUnique.mockResolvedValue({
      id: 'c1', status: 'reviewing', content: 'old'
    })
    mockPrisma.draft.findUnique.mockResolvedValue({
      id: 'd_new', chapterId: 'c1', content: 'new content', status: 'completed'
    })
    mockPrisma.draft.updateMany.mockResolvedValue({ count: 1 })
    mockPrisma.chapter.update.mockResolvedValue({ id: 'c1', status: 'reviewing' })

    const result = await callHandler(
      routes, 'POST', '/api/chapters/:chapterId/select',
      { draftId: 'd_new' }, { chapterId: 'c1' }
    )

    expect(result.status).not.toBe(400)
    expect(mockPrisma.$transaction).toHaveBeenCalled()
  })

  it('rejects archived status with 400', async () => {
    mockPrisma.chapter.findUnique.mockResolvedValue({
      id: 'c1', status: 'archived'
    })

    const result = await callHandler(
      routes, 'POST', '/api/chapters/:chapterId/select',
      { draftId: 'd1' }, { chapterId: 'c1' }
    )

    expect(result.status).toBe(400)
    expect(result.body.error).toMatch(/已归档章节不能选择新候选/)
  })

  it('writes Chapter.content and does not flip chapter.status', async () => {
    mockPrisma.chapter.findUnique.mockResolvedValue({
      id: 'c1', status: 'draft', content: 'old'
    })
    mockPrisma.draft.findUnique.mockResolvedValue({
      id: 'd_new', chapterId: 'c1', content: 'new content', status: 'completed'
    })
    mockPrisma.draft.updateMany.mockResolvedValue({ count: 1 })
    mockPrisma.chapter.update.mockResolvedValue({ id: 'c1', status: 'draft' })

    const result = await callHandler(
      routes, 'POST', '/api/chapters/:chapterId/select',
      { draftId: 'd_new' }, { chapterId: 'c1' }
    )

    expect(result.status).not.toBe(400)
    // v2: select 总是写 Chapter.content
    expect(mockPrisma.chapter.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'c1' },
        data: expect.objectContaining({ content: 'new content' })
      })
    )
    // 验证 chapter.update 不带 status 翻转
    const updateCall = mockPrisma.chapter.update.mock.calls[0]
    expect(updateCall[0].data.status).toBeUndefined()
  })
})
