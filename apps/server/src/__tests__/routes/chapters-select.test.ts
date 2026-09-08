import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createMockApp, callHandler } from '../setup.js'

describe('chapters select route — chapterId isolation', () => {
  let mockPrisma: any
  let routes: Record<string, any>

  beforeEach(async () => {
    mockPrisma = {
      chapter: {
        findUnique: vi.fn(),
        update: vi.fn()
      },
      draft: {
        findUnique: vi.fn(),
        update: vi.fn(),
        updateMany: vi.fn()
      },
      $transaction: vi.fn(async (fn) => fn(mockPrisma))
    }
    const { chapterRoutes } = await import('../../routes/chapters.js')
    const built = createMockApp(mockPrisma)
    await chapterRoutes(built.app)
    routes = built.routes
  })

  it('returns 404 when draft belongs to a different chapter', async () => {
    mockPrisma.chapter.findUnique.mockResolvedValue({
      id: 'chapterB', status: 'draft'
    })
    // Without chapterId filter, current code returns the draft regardless of
    // its chapterId. With the compound (id, chapterId) filter, findUnique
    // returns null because draft_1 belongs to chapterA, not chapterB.
    mockPrisma.draft.findUnique.mockResolvedValue(null)

    const result = await callHandler(
      routes,
      'POST',
      '/api/chapters/:chapterId/select',
      { draftId: 'draft_1' },
      { chapterId: 'chapterB' }
    )

    // Verify the lookup was scoped by chapterId
    expect(mockPrisma.draft.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id_chapterId: expect.objectContaining({
            id: 'draft_1',
            chapterId: 'chapterB'
          })
        })
      })
    )

    expect(result.status).toBe(404)
    expect(result.body).toEqual(
      expect.objectContaining({ success: false, error: 'Draft not found' })
    )
    expect(mockPrisma.$transaction).not.toHaveBeenCalled()
  })

  it('accepts draft that belongs to the same chapter', async () => {
    mockPrisma.chapter.findUnique.mockResolvedValue({
      id: 'chapterA', status: 'draft'
    })
    mockPrisma.draft.findUnique.mockResolvedValue({
      id: 'draft_1', chapterId: 'chapterA', content: 'hello'
    })
    mockPrisma.draft.updateMany.mockResolvedValue({ count: 2 })
    mockPrisma.draft.update.mockResolvedValue({ id: 'draft_1', status: 'selected' })
    // v2: chapter.status 不再被 select 翻成 'selected'
    mockPrisma.chapter.update.mockResolvedValue({ id: 'chapterA', status: 'draft' })

    const result = await callHandler(
      routes,
      'POST',
      '/api/chapters/:chapterId/select',
      { draftId: 'draft_1' },
      { chapterId: 'chapterA' }
    )

    expect(mockPrisma.$transaction).toHaveBeenCalled()
    // Route uses bare return — callHandler captures the handler's return value.
    expect(result.body).toEqual({ success: true })
  })
})
