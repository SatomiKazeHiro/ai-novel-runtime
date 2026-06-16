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