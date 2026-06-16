import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createMockApp, callHandler, createMockPrisma } from '../setup.js'

describe('generate route — concurrency protection (Q#10)', () => {
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

  it('returns 409 when status lock fails (chapter not in draft status)', async () => {
    // findUnique reads the chapter as 'draft' (stale view), but a concurrent
    // request has already flipped it to 'generating' between the read and the
    // updateMany — the atomic lock must reject this submission with 409.
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
    // The atomic updateMany reports 0 rows flipped — the precondition `status='draft'` failed.
    mockPrisma.chapter.updateMany.mockResolvedValue({ count: 0 })

    const result = await callHandler(
      routes,
      'POST',
      '/api/chapters/:chapterId/generate',
      {},
      { chapterId: 'c1' }
    )

    expect(result.status).toBe(409)
    expect(result.body).toEqual(
      expect.objectContaining({ success: false })
    )
    // No drafts created — the second concurrent submission must be rejected before any side effects.
    expect(mockPrisma.draft.create).not.toHaveBeenCalled()
  })

  it('proceeds when lock succeeds (count=1)', async () => {
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
    mockPrisma.chapter.updateMany.mockResolvedValue({ count: 1 })
    mockPrisma.draft.count.mockResolvedValue(0)
    mockPrisma.draft.create.mockResolvedValue({ id: 'd1' })

    const result = await callHandler(
      routes,
      'POST',
      '/api/chapters/:chapterId/generate',
      {},
      { chapterId: 'c1' }
    )

    expect(result.status).not.toBe(409)
  })
})