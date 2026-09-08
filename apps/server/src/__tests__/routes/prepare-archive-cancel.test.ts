import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createMockApp, callHandler } from '../setup.js'

describe('prepare-archive/cancel route', () => {
  let mockPrisma: any
  let routes: Record<string, any>

  beforeEach(async () => {
    vi.clearAllMocks()
    mockPrisma = {
      chapter: {
        findUnique: vi.fn(),
        update: vi.fn()
      }
    }
    const { chapterArchiveRoutes } = await import('../../routes/chapters-archive.js')
    const built = createMockApp(mockPrisma)
    await chapterArchiveRoutes(built.app)
    routes = built.routes
  })

  it('reverts chapter to draft and clears pendingArchiveData + chapterGraph', async () => {
    mockPrisma.chapter.findUnique.mockResolvedValue({
      id: 'c1', storyId: 's1', status: 'reviewing',
      pendingArchiveData: '{"version":3}', chapterGraph: '{"nodes":[]}'
    })
    mockPrisma.chapter.update.mockResolvedValue({ id: 'c1', status: 'draft' })

    const result = await callHandler(
      routes, 'POST', '/api/chapters/:chapterId/prepare-archive/cancel',
      undefined, { chapterId: 'c1' }
    )

    expect(result.body).toEqual(expect.objectContaining({ success: true, data: { status: 'draft' } }))

    const updateCall = mockPrisma.chapter.update.mock.calls[0]
    expect(updateCall[0].where).toEqual({ id: 'c1' })
    expect(updateCall[0].data).toMatchObject({
      status: 'draft', pendingArchiveData: null, chapterGraph: null
    })
  })

  it.each(['draft', 'archived'])('returns 400 when chapter is %s — no update performed', async (status) => {
    mockPrisma.chapter.findUnique.mockResolvedValue({ id: 'c1', status })

    const result = await callHandler(
      routes, 'POST', '/api/chapters/:chapterId/prepare-archive/cancel',
      undefined, { chapterId: 'c1' }
    )

    expect(result.status).toBe(400)
    expect(result.body).toEqual(expect.objectContaining({ success: false }))
    expect(mockPrisma.chapter.update).not.toHaveBeenCalled()
  })

  it('returns 404 when chapter does not exist', async () => {
    mockPrisma.chapter.findUnique.mockResolvedValue(null)

    const result = await callHandler(
      routes, 'POST', '/api/chapters/:chapterId/prepare-archive/cancel',
      undefined, { chapterId: 'nonexistent' }
    )

    expect(result.status).toBe(404)
    expect(result.body).toEqual(expect.objectContaining({
      success: false, error: 'Chapter not found'
    }))
  })
})
