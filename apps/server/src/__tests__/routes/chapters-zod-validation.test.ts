import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createMockApp, callHandler, createMockPrisma } from '../setup.js'

// 本文件专门覆盖 chapters.ts 6 个 body endpoint 的 zod 校验行为。
// 单元粒度:每个 schema 1 个 happy(返回成功或进入业务分支) + 1 个 negative(zod 拒绝,返回 400)。
// 业务逻辑的 happy/negative 在其他 __tests__/routes/*-test.ts 里覆盖,本文件不重复。

describe('POST /stories/:storyId/chapters — CreateChapterRequestSchema', () => {
  let mockPrisma: any
  let routes: Record<string, any>

  beforeEach(async () => {
    vi.clearAllMocks()
    mockPrisma = createMockPrisma({
      chapter: {
        ...createMockPrisma().chapter,
        count: vi.fn().mockResolvedValue(0),     // 无现存章节 → 通过「非首章」校验
        findFirst: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({
          id: 'c1', storyId: 's1', number: 1, isSideStory: false,
          title: 't', outline: '', status: 'draft'
        })
      }
    })
    const { chapterRoutes } = await import('../../routes/chapters.js')
    const built = createMockApp(mockPrisma)
    await chapterRoutes(built.app)
    routes = built.routes
  })

  it('accepts valid body (title only)', async () => {
    const result = await callHandler(
      routes, 'POST', '/api/stories/:storyId/chapters',
      { title: 'Chapter 1' },
      { storyId: 's1' }
    )
    expect(result.status).not.toBe(400)
    expect(result.body).toEqual(expect.objectContaining({ success: true }))
  })

  it('rejects missing title with 400 + zod error', async () => {
    const result = await callHandler(
      routes, 'POST', '/api/stories/:storyId/chapters',
      { outline: 'no title' },
      { storyId: 's1' }
    )
    expect(result.status).toBe(400)
    expect(result.body).toEqual(
      expect.objectContaining({ success: false, error: expect.stringContaining('title') })
    )
    expect(mockPrisma.chapter.create).not.toHaveBeenCalled()
  })
})

describe('PUT /chapters/:chapterId — UpdateChapterRequestSchema', () => {
  let mockPrisma: any
  let routes: Record<string, any>

  beforeEach(async () => {
    vi.clearAllMocks()
    mockPrisma = createMockPrisma({
      chapter: {
        ...createMockPrisma().chapter,
        findUnique: vi.fn().mockResolvedValue({
          id: 'c1', storyId: 's1', status: 'draft', title: 't'
        }),
        update: vi.fn().mockResolvedValue({ id: 'c1' })
      }
    })
    const { chapterRoutes } = await import('../../routes/chapters.js')
    const built = createMockApp(mockPrisma)
    await chapterRoutes(built.app)
    routes = built.routes
  })

  it('accepts valid partial update', async () => {
    const result = await callHandler(
      routes, 'PUT', '/api/chapters/:chapterId',
      { title: 'New Title' },
      { chapterId: 'c1' }
    )
    expect(result.status).not.toBe(400)
    expect(result.body).toEqual(expect.objectContaining({ success: true }))
  })

  it('rejects wrong type (title must be string)', async () => {
    const result = await callHandler(
      routes, 'PUT', '/api/chapters/:chapterId',
      { title: 123 },
      { chapterId: 'c1' }
    )
    expect(result.status).toBe(400)
    expect(result.body).toEqual(
      expect.objectContaining({ success: false, error: expect.stringContaining('title') })
    )
    expect(mockPrisma.chapter.update).not.toHaveBeenCalled()
  })
})

describe('POST /chapters/:chapterId/preview — PreviewRequestSchema', () => {
  let mockPrisma: any
  let routes: Record<string, any>

  beforeEach(async () => {
    vi.clearAllMocks()
    mockPrisma = createMockPrisma({
      chapter: {
        ...createMockPrisma().chapter,
        findUnique: vi.fn().mockResolvedValue({
          id: 'c1', storyId: 's1', status: 'draft',
          outline: 'o', sceneLocation: '', sceneMood: '', sceneGoal: '',
          number: 1, isSideStory: false, story: { id: 's1', title: 'S', description: '' }
        }),
        findFirst: vi.fn().mockResolvedValue(null)
      },
      loreItem: { findMany: vi.fn().mockResolvedValue([]) },
      timelineEvent: { findMany: vi.fn().mockResolvedValue([]) },
      plotArc: { findMany: vi.fn().mockResolvedValue([]) },
      memory: { findMany: vi.fn().mockResolvedValue([]) },
      character: { findMany: vi.fn().mockResolvedValue([]) },
      characterBranchState: { findMany: vi.fn().mockResolvedValue([]) },
      runtimeProfile: { findUnique: vi.fn().mockResolvedValue(null), findFirst: vi.fn().mockResolvedValue(null) },
      storyWorkerBinding: { findUnique: vi.fn().mockResolvedValue(null) },
      workerTask: { findUnique: vi.fn().mockResolvedValue(null), findFirst: vi.fn().mockResolvedValue(null) },
      aiProviderConfig: { findFirst: vi.fn().mockResolvedValue(null), findMany: vi.fn().mockResolvedValue([]) }
    })
    const { chapterRoutes } = await import('../../routes/chapters.js')
    const built = createMockApp(mockPrisma)
    await chapterRoutes(built.app)
    routes = built.routes
  })

  it('accepts body with storyId', async () => {
    const result = await callHandler(
      routes, 'POST', '/api/chapters/:chapterId/preview',
      { storyId: 's1' },
      { chapterId: 'c1' }
    )
    expect(result.status).not.toBe(400)
  })

  it('rejects missing storyId with 400', async () => {
    const result = await callHandler(
      routes, 'POST', '/api/chapters/:chapterId/preview',
      {},
      { chapterId: 'c1' }
    )
    expect(result.status).toBe(400)
    expect(result.body).toEqual(
      expect.objectContaining({ success: false, error: expect.stringContaining('storyId') })
    )
  })
})

describe('POST /chapters/:chapterId/generate — GenerateRequestSchema', () => {
  let mockPrisma: any
  let routes: Record<string, any>

  beforeEach(async () => {
    vi.clearAllMocks()
    mockPrisma = createMockPrisma({
      chapter: {
        ...createMockPrisma().chapter,
        findUnique: vi.fn().mockResolvedValue({
          id: 'c1', storyId: 's1', status: 'draft',
          content: '', outline: 'o', title: 't',
          sceneLocation: '', sceneMood: '', sceneGoal: '',
          number: 1, isSideStory: false, story: { id: 's1', title: 'S', description: '' }
        }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 })  // 锁成功
      },
      draft: { count: vi.fn().mockResolvedValue(0), create: vi.fn().mockResolvedValue({ id: 'd1' }) },
      loreItem: { findMany: vi.fn().mockResolvedValue([]) },
      timelineEvent: { findMany: vi.fn().mockResolvedValue([]) },
      plotArc: { findMany: vi.fn().mockResolvedValue([]) },
      memory: { findMany: vi.fn().mockResolvedValue([]) },
      character: { findMany: vi.fn().mockResolvedValue([]) },
      characterBranchState: { findMany: vi.fn().mockResolvedValue([]) },
      runtimeProfile: { findUnique: vi.fn().mockResolvedValue(null), findFirst: vi.fn().mockResolvedValue(null) },
      storyWorkerBinding: { findUnique: vi.fn().mockResolvedValue(null) },
      workerTask: { findUnique: vi.fn().mockResolvedValue(null), findFirst: vi.fn().mockResolvedValue(null) },
      aiProviderConfig: { findFirst: vi.fn().mockResolvedValue(null), findMany: vi.fn().mockResolvedValue([]) }
    })
    const { chapterRoutes } = await import('../../routes/chapters.js')
    const built = createMockApp(mockPrisma)
    await chapterRoutes(built.app)
    routes = built.routes
  })

  it('accepts empty body (all fields optional — GenerateRequestSchema.storyId 是 optional)', async () => {
    const result = await callHandler(
      routes, 'POST', '/api/chapters/:chapterId/generate',
      {},
      { chapterId: 'c1' }
    )
    expect(result.status).not.toBe(400)
  })

  it('rejects compiledPrompt with missing userMessage (CompiledPromptSchema 嵌套校验)', async () => {
    const result = await callHandler(
      routes, 'POST', '/api/chapters/:chapterId/generate',
      { compiledPrompt: { systemMessage: 'sys' } },
      { chapterId: 'c1' }
    )
    expect(result.status).toBe(400)
    expect(result.body).toEqual(
      expect.objectContaining({ success: false, error: expect.stringContaining('userMessage') })
    )
  })
})

describe('POST /chapters/:chapterId/select — SelectDraftRequestSchema', () => {
  let mockPrisma: any
  let routes: Record<string, any>

  beforeEach(async () => {
    vi.clearAllMocks()
    mockPrisma = createMockPrisma({
      chapter: {
        ...createMockPrisma().chapter,
        findUnique: vi.fn().mockResolvedValue({ id: 'c1', status: 'generated' }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 })  // 锁成功
      },
      draft: {
        ...createMockPrisma().draft,
        findUnique: vi.fn().mockResolvedValue({ id: 'd1', chapterId: 'c1', content: 'c' }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        update: vi.fn().mockResolvedValue({ id: 'd1', status: 'selected' })
      },
      $transaction: vi.fn(async (fn: any) => fn(mockPrisma))
    })
    const { chapterRoutes } = await import('../../routes/chapters.js')
    const built = createMockApp(mockPrisma)
    await chapterRoutes(built.app)
    routes = built.routes
  })

  it('accepts body with draftId', async () => {
    const result = await callHandler(
      routes, 'POST', '/api/chapters/:chapterId/select',
      { draftId: 'd1' },
      { chapterId: 'c1' }
    )
    expect(result.status).not.toBe(400)
    expect(result.body).toEqual(expect.objectContaining({ success: true }))
  })

  it('rejects missing draftId with 400', async () => {
    const result = await callHandler(
      routes, 'POST', '/api/chapters/:chapterId/select',
      {},
      { chapterId: 'c1' }
    )
    expect(result.status).toBe(400)
    expect(result.body).toEqual(
      expect.objectContaining({ success: false, error: expect.stringContaining('draftId') })
    )
    expect(mockPrisma.$transaction).not.toHaveBeenCalled()
  })
})

describe('POST /chapters/:chapterId/develop — DevelopRequestSchema', () => {
  let mockPrisma: any
  let routes: Record<string, any>

  beforeEach(async () => {
    vi.clearAllMocks()
    mockPrisma = createMockPrisma({
      chapter: {
        ...createMockPrisma().chapter,
        findUnique: vi.fn().mockResolvedValue({
          id: 'c1', storyId: 's1', status: 'archived', number: 1, isSideStory: false,
          story: { id: 's1', runtimeProfileId: null }
        }),
        findFirst: vi.fn().mockResolvedValue(null),
        count: vi.fn().mockResolvedValue(0),       // 无子章节
        create: vi.fn().mockResolvedValue({ id: 'c2', number: 2 })
      }
    })
    const { chapterRoutes } = await import('../../routes/chapters.js')
    const built = createMockApp(mockPrisma)
    await chapterRoutes(built.app)
    routes = built.routes
  })

  it('accepts empty body (all fields optional)', async () => {
    const result = await callHandler(
      routes, 'POST', '/api/chapters/:chapterId/develop',
      {},
      { chapterId: 'c1' }
    )
    expect(result.status).not.toBe(400)
    expect(result.body).toEqual(expect.objectContaining({ success: true }))
  })

  it('rejects wrong type (number must be number, not string)', async () => {
    const result = await callHandler(
      routes, 'POST', '/api/chapters/:chapterId/develop',
      { number: 'not-a-number' },
      { chapterId: 'c1' }
    )
    expect(result.status).toBe(400)
    expect(result.body).toEqual(
      expect.objectContaining({ success: false, error: expect.stringContaining('number') })
    )
    expect(mockPrisma.chapter.create).not.toHaveBeenCalled()
  })
})

describe('POST /chapters/:chapterId/prepare-archive — PrepareArchiveRequestSchema (empty strict)', () => {
  // 复用 prepare-archive.test.ts 的 mock 模式:mock combined-extractor + memory-optimizer + graph-snapshot
  vi.mock('../../services/combined-extractor.js', () => ({
    prepareArchiveData: vi.fn(),
    extractAll: vi.fn()
  }))
  vi.mock('../../services/memory-optimizer.js', () => ({
    optimizeMemories: vi.fn().mockResolvedValue(0)
  }))
  vi.mock('../../services/graph-snapshot.js', () => ({
    saveGraphSnapshotAndDelta: vi.fn().mockResolvedValue({
      snapshot: { nodes: [], edges: [], timestamp: '' },
      delta: { nodes: [], edges: [], timestamp: '' }
    })
  }))

  let mockPrisma: any
  let routes: Record<string, any>

  beforeEach(async () => {
    vi.clearAllMocks()
    mockPrisma = createMockPrisma({
      chapter: {
        ...createMockPrisma().chapter,
        findUnique: vi.fn().mockResolvedValue({
          id: 'c1', storyId: 's1', status: 'selected',
          isSideStory: false, content: 'a'.repeat(200), outline: 'o',
          number: 1, parentChapterId: null,
          story: { id: 's1' }
        }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        update: vi.fn().mockResolvedValue({ id: 'c1', status: 'reviewing' })
      }
    })
    const { prepareArchiveData } = await import('../../services/combined-extractor.js')
    ;(prepareArchiveData as any).mockResolvedValue({
      memories: { memories: [], characterStates: [], timelineEvents: [], summary: null, timelinePosition: null },
      graph: {
        mergedGraph: { nodes: [], edges: [], timestamp: '2026-06-18T00:00:00.000Z' },
        chapterGraph: { nodes: [], edges: [], timestamp: '2026-06-18T00:00:00.000Z' }
      },
      plotArcs: [],
      meta: { extractedAt: '2026-06-18T00:00:00.000Z', chapterNumber: 1 }
    })
    const { chapterRoutes } = await import('../../routes/chapters.js')
    const built = createMockApp(mockPrisma)
    await chapterRoutes(built.app)
    routes = built.routes
  })

  it('accepts empty body (no client input expected)', async () => {
    const result = await callHandler(
      routes, 'POST', '/api/chapters/:chapterId/prepare-archive',
      {},
      { chapterId: 'c1' }
    )
    expect(result.status).not.toBe(400)
  })

  it('rejects body with unrecognized keys (strict mode)', async () => {
    const result = await callHandler(
      routes, 'POST', '/api/chapters/:chapterId/prepare-archive',
      { someField: 'unexpected' },
      { chapterId: 'c1' }
    )
    expect(result.status).toBe(400)
    expect(result.body).toEqual(
      expect.objectContaining({ success: false, error: expect.stringContaining('someField') })
    )
  })
})
