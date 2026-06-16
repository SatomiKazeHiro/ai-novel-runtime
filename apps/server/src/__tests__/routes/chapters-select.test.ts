import { describe, it, expect, vi, beforeEach } from 'vitest'

describe('chapters select route — chapterId isolation', () => {
  let mockPrisma: any
  let handler: any

  beforeEach(async () => {
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
      $transaction: vi.fn(async (fn) => fn(mockPrisma))
    }
    const { chapterRoutes } = await import('../../routes/chapters.js')
    const routes: Record<string, any> = {}
    const app: any = {
      prisma: mockPrisma,
      log: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
      get: (path: string, h: any) => { routes[`GET ${path}`] = h },
      post: (path: string, h: any) => { routes[`POST ${path}`] = h },
      put: (path: string, h: any) => { routes[`PUT ${path}`] = h },
      delete: (path: string, h: any) => { routes[`DELETE ${path}`] = h }
    }
    await chapterRoutes(app)
    handler = routes['POST /api/chapters/:chapterId/select']
  })

  it('returns 404 when draft belongs to a different chapter', async () => {
    mockPrisma.chapter.findUnique.mockResolvedValue({
      id: 'chapterB', status: 'generated'
    })
    // Without chapterId filter, current code returns the draft regardless of
    // its chapterId. With the compound (id, chapterId) filter, findUnique
    // returns null because draft_1 belongs to chapterA, not chapterB.
    mockPrisma.draft.findUnique.mockResolvedValue(null)

    const reply: any = { status: vi.fn().mockReturnThis(), send: vi.fn().mockReturnThis() }
    await handler(
      { params: { chapterId: 'chapterB' }, body: { draftId: 'draft_1' } } as any,
      reply
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

    expect(reply.status).toHaveBeenCalledWith(404)
    expect(reply.send).toHaveBeenCalledWith(
      expect.objectContaining({ success: false, error: 'Draft not found' })
    )
    expect(mockPrisma.$transaction).not.toHaveBeenCalled()
  })

  it('accepts draft that belongs to the same chapter', async () => {
    mockPrisma.chapter.findUnique.mockResolvedValue({
      id: 'chapterA', status: 'generated'
    })
    mockPrisma.draft.findUnique.mockResolvedValue({
      id: 'draft_1', chapterId: 'chapterA', content: 'hello'
    })
    mockPrisma.draft.updateMany.mockResolvedValue({ count: 2 })
    mockPrisma.draft.update.mockResolvedValue({ id: 'draft_1', status: 'selected' })
    mockPrisma.chapter.update.mockResolvedValue({ id: 'chapterA', status: 'selected' })

    const reply: any = { status: vi.fn().mockReturnThis(), send: vi.fn().mockReturnThis() }
    await handler(
      { params: { chapterId: 'chapterA' }, body: { draftId: 'draft_1' } } as any,
      reply
    )

    expect(mockPrisma.$transaction).toHaveBeenCalled()
    // Route returns { success: true } as a bare return — capture both forms
    const returned = reply.send.mock.calls[0]?.[0] ?? undefined
    expect(returned).toEqual({ success: true })
  })
})
