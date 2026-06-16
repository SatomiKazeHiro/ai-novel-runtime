import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createMockApp, callHandler, createMockPrisma } from '../setup.js'

describe('generate route — compiledPrompt validation', () => {
  let mockPrisma: any
  let routes: Record<string, any>

  beforeEach(async () => {
    vi.clearAllMocks()
    mockPrisma = createMockPrisma({
      loreItem: { findMany: vi.fn().mockResolvedValue([]) },
      timelineEvent: { findMany: vi.fn().mockResolvedValue([]) },
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

    // Validation passed: status must not be 400. The route may or may not
    // reach a successful end (other mocks may short-circuit), but the
    // important guarantee is that validation did not reject it.
    expect(result.status).not.toBe(400)
  })
})