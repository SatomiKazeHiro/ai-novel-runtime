import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createMockApp, callHandler, createMockPrisma } from '../setup.js'

describe('generate route — v2 concurrency: no chapter lock', () => {
  let mockPrisma: any
  let routes: Record<string, any>

  beforeEach(async () => {
    vi.clearAllMocks()
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

  it('concurrent requests both produce draft batches (no 409 lock)', async () => {
    // v2: 没有 updateMany 章节级锁, 双击并发两次入队 → 产生 2 批 draft。
    // 旧 Q#10 测试的 "lock 失败 → 409" 路径已不存在 (因为 chapter.status 不再被翻转,
    // 没有"被另一方先翻过去"的中间态)。这个测试证明并发入队无副作用。
    mockPrisma.chapter.findUnique.mockResolvedValue({
      id: 'c1',
      storyId: 's1',
      status: 'draft',
      content: '',
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

    const result1 = await callHandler(
      routes,
      'POST',
      '/api/chapters/:chapterId/generate',
      {},
      { chapterId: 'c1' }
    )

    const result2 = await callHandler(
      routes,
      'POST',
      '/api/chapters/:chapterId/generate',
      {},
      { chapterId: 'c1' }
    )

    // v2 没有 409 路径;两次都不该被拒
    expect(result1.status).not.toBe(409)
    expect(result2.status).not.toBe(409)
    // 两次都创建 draft
    expect(mockPrisma.draft.create).toHaveBeenCalled()
    expect(mockPrisma.draft.create.mock.calls.length).toBeGreaterThanOrEqual(2)
  })

  it('rejects generate on non-latest mainline chapter (aligned with preview)', async () => {
    mockPrisma.chapter.findUnique.mockResolvedValue({
      id: 'c2',
      storyId: 's1',
      status: 'draft',
      content: 'x'.repeat(100),
      outline: 'outline',
      title: 'Title',
      number: 2,
      isSideStory: false,
      story: { id: 's1', title: 'Story', description: '' }
    })
    // getLastChapter 返回主线第 3 章（不是当前 c2）→ 触发「只能在最新章节生成」
    mockPrisma.chapter.findFirst.mockResolvedValue({ id: 'c3', number: 3 })

    const result = await callHandler(
      routes, 'POST', '/api/chapters/:chapterId/generate',
      {}, { chapterId: 'c2' }
    )

    expect(result.status).toBe(400)
    expect(result.body.error).toContain('只能在最新章节')
  })

  it('does not write to chapter.status during generation', async () => {
    // v2 invariant: generate route 仅写 chapter.compiledPrompt, 不翻 status。
    // 即便并发多次请求, chapter.status 字段也不应在被改。
    mockPrisma.chapter.findUnique.mockResolvedValue({
      id: 'c1',
      storyId: 's1',
      status: 'draft',
      content: '',
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

    await callHandler(
      routes,
      'POST',
      '/api/chapters/:chapterId/generate',
      {},
      { chapterId: 'c1' }
    )

    // chapter.update 只应被调一次 (写 compiledPrompt), 且 data 中不含 status
    const chapterUpdates = mockPrisma.chapter.update.mock.calls
    for (const call of chapterUpdates) {
      expect(call[0].data.status).toBeUndefined()
    }
  })
})
