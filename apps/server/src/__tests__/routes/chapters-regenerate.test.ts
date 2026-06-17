import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createMockApp, callHandler, createMockPrisma } from '../setup.js'

describe('generate route — allowed status list (Task #66)', () => {
  let mockPrisma: any
  let routes: Record<string, any>

  beforeEach(async () => {
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

  function setupChapter(status: string) {
    mockPrisma.chapter.findUnique.mockResolvedValue({
      id: 'c1',
      storyId: 's1',
      status,
      content: status === 'selected' ? 'existing content' : '',
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
  }

  it('rejects generating status with 400', async () => {
    setupChapter('generating')
    const result = await callHandler(
      routes, 'POST', '/api/chapters/:chapterId/generate', {}, { chapterId: 'c1' }
    )
    expect(result.status).toBe(400)
    expect(result.body.error).toMatch(/只允许 draft \/ generated \/ selected/)
  })

  it('rejects scored status with 400', async () => {
    setupChapter('scored')
    const result = await callHandler(
      routes, 'POST', '/api/chapters/:chapterId/generate', {}, { chapterId: 'c1' }
    )
    expect(result.status).toBe(400)
    expect(result.body.error).toMatch(/只允许 draft \/ generated \/ selected/)
  })

  it('rejects reviewing status with 400', async () => {
    setupChapter('reviewing')
    const result = await callHandler(
      routes, 'POST', '/api/chapters/:chapterId/generate', {}, { chapterId: 'c1' }
    )
    expect(result.status).toBe(400)
    expect(result.body.error).toMatch(/只允许 draft \/ generated \/ selected/)
  })

  it('rejects archived status with 400', async () => {
    setupChapter('archived')
    const result = await callHandler(
      routes, 'POST', '/api/chapters/:chapterId/generate', {}, { chapterId: 'c1' }
    )
    expect(result.status).toBe(400)
    expect(result.body.error).toMatch(/只允许 draft \/ generated \/ selected/)
  })

  it('accepts generated status (Task #66 new capability)', async () => {
    setupChapter('generated')
    const result = await callHandler(
      routes, 'POST', '/api/chapters/:chapterId/generate', {}, { chapterId: 'c1' }
    )
    expect(result.status).not.toBe(400)
    expect(result.status).not.toBe(409)
    // Lock acquired (proceeds past status check)
    expect(mockPrisma.draft.create).toHaveBeenCalled()
  })

  it('accepts selected status (Task #66 new capability)', async () => {
    setupChapter('selected')
    const result = await callHandler(
      routes, 'POST', '/api/chapters/:chapterId/generate', {}, { chapterId: 'c1' }
    )
    expect(result.status).not.toBe(400)
    expect(result.status).not.toBe(409)
    expect(mockPrisma.draft.create).toHaveBeenCalled()
  })

  it('does NOT delete existing drafts (additive only — spec §2.1.4)', async () => {
    setupChapter('selected')
    await callHandler(
      routes, 'POST', '/api/chapters/:chapterId/generate', {}, { chapterId: 'c1' }
    )
    expect(mockPrisma.draft.deleteMany).not.toHaveBeenCalled()
  })

  it('captures preLockStatus and passes it to generateQueue.add (Task #66)', async () => {
    // Mock generateQueue to inspect what payload it receives
    const { generateQueue } = await import('../../queue/index.js')
    const addSpy = vi.spyOn(generateQueue, 'add').mockResolvedValue({} as any)

    setupChapter('selected')
    await callHandler(
      routes, 'POST', '/api/chapters/:chapterId/generate', {}, { chapterId: 'c1' }
    )

    expect(addSpy).toHaveBeenCalled()
    const payload: any = addSpy.mock.calls[0][1]
    expect(payload).toHaveProperty('preLockStatus', 'selected')
    addSpy.mockRestore()
  })

  it('passes preLockStatus=draft for first-time generation', async () => {
    const { generateQueue } = await import('../../queue/index.js')
    const addSpy = vi.spyOn(generateQueue, 'add').mockResolvedValue({} as any)

    setupChapter('draft')
    await callHandler(
      routes, 'POST', '/api/chapters/:chapterId/generate', {}, { chapterId: 'c1' }
    )

    const payload: any = addSpy.mock.calls[0][1]
    expect(payload.preLockStatus).toBe('draft')
    addSpy.mockRestore()
  })
})
