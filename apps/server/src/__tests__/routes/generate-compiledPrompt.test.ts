import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createMockApp, callHandler, createMockPrisma } from '../setup.js'

describe('generate route — compiledPrompt validation', () => {
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
    // Q#10: generate route now does an atomic updateMany lock. Default to
    // "lock acquired" so the existing zod-validation tests still reach the
    // compiledPrompt check (instead of failing earlier on the lock).
    mockPrisma.chapter.updateMany.mockResolvedValue({ count: 1 })
    const { chapterRoutes } = await import('../../routes/chapters.js')
    const built = createMockApp(mockPrisma)
    await chapterRoutes(built.app)
    routes = built.routes
  })

  it('returns 400 when compiledPrompt is missing userMessage', async () => {
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

    const result = await callHandler(
      routes,
      'POST',
      '/api/chapters/:chapterId/generate',
      { compiledPrompt: { systemMessage: 'sys' } }, // missing userMessage
      { chapterId: 'c1' }
    )

    expect(result.status).toBe(400)
    expect(result.body).toEqual(
      expect.objectContaining({
        success: false,
        error: expect.stringContaining('compiledPrompt')
      })
    )
  })

  it('returns 400 when systemMessage is whitespace-only', async () => {
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

    const result = await callHandler(
      routes,
      'POST',
      '/api/chapters/:chapterId/generate',
      { compiledPrompt: { systemMessage: '   \n  ', userMessage: 'usr' } },
      { chapterId: 'c1' }
    )

    expect(result.status).toBe(400)
    expect(result.body).toEqual(
      expect.objectContaining({ success: false })
    )
  })

  it('returns 400 when compiledPrompt has wrong types', async () => {
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

    const result = await callHandler(
      routes,
      'POST',
      '/api/chapters/:chapterId/generate',
      { compiledPrompt: { systemMessage: 123, userMessage: 'usr' } }, // systemMessage not a string
      { chapterId: 'c1' }
    )

    expect(result.status).toBe(400)
    expect(result.body).toEqual(
      expect.objectContaining({
        success: false,
        error: expect.stringContaining('compiledPrompt')
      })
    )
  })

  it('accepts valid compiledPrompt (does not 400 on validation)', async () => {
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

    const result = await callHandler(
      routes,
      'POST',
      '/api/chapters/:chapterId/generate',
      { compiledPrompt: { systemMessage: 'sys', userMessage: 'usr' } },
      { chapterId: 'c1' }
    )

    // Validation passed: response must not carry the zod validation error.
    // (Status alone is too weak — a 500 from an unrelated downstream failure
    // would also pass `not 400`; assert the validation-specific rejection
    // is absent.)
    const body = JSON.stringify(result.body)
    expect(body).not.toContain('compiledPrompt 格式错误')
  })
})