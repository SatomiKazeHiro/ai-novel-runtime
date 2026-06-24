import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createMockApp, callHandler, createMockPrisma } from '../setup.js'

describe('DELETE /api/stories/:storyId/cover', () => {
  let mockPrisma: any
  let routes: Record<string, any>
  let coverStorageMock: any

  beforeEach(async () => {
    vi.clearAllMocks()
    mockPrisma = createMockPrisma({
      story: {
        findUnique: vi.fn().mockResolvedValue({
          id: '97b9efa5-9cb4-4630-9d46-925ed0b08b2a',
          coverUrl: '/uploads/covers/97b9efa5-9cb4-4630-9d46-925ed0b08b2a-1700000000000.jpg'
        }),
        update: vi.fn().mockResolvedValue({ id: '97b9efa5-9cb4-4630-9d46-925ed0b08b2a', coverUrl: null })
      }
    })
    coverStorageMock = { deleteCover: vi.fn().mockResolvedValue(undefined) }

    vi.doMock('../../lib/cover-storage.js', () => coverStorageMock)
    const { coverRoutes } = await import('../../routes/covers.js')
    const built = createMockApp(mockPrisma)
    await coverRoutes(built.app)
    routes = built.routes
    vi.doUnmock('../../lib/cover-storage.js')
  })

  it('clears coverUrl and unlinks file', async () => {
    const result = await callHandler(routes, 'DELETE', '/api/stories/:storyId/cover', {}, { storyId: '97b9efa5-9cb4-4630-9d46-925ed0b08b2a' })
    expect(result.status).not.toBe(404)
    expect(result.body.success).toBe(true)
    expect(mockPrisma.story.update).toHaveBeenCalledWith({
      where: { id: '97b9efa5-9cb4-4630-9d46-925ed0b08b2a' },
      data: { coverUrl: null }
    })
    expect(coverStorageMock.deleteCover).toHaveBeenCalledWith(expect.any(String), '/uploads/covers/97b9efa5-9cb4-4630-9d46-925ed0b08b2a-1700000000000.jpg')
  })

  it('is idempotent when coverUrl is already null', async () => {
    mockPrisma.story.findUnique.mockResolvedValue({ id: '97b9efa5-9cb4-4630-9d46-925ed0b08b2a', coverUrl: null })
    const result = await callHandler(routes, 'DELETE', '/api/stories/:storyId/cover', {}, { storyId: '97b9efa5-9cb4-4630-9d46-925ed0b08b2a' })
    expect(result.body.success).toBe(true)
    expect(coverStorageMock.deleteCover).not.toHaveBeenCalled()
  })

  it('returns 404 when story not found', async () => {
    mockPrisma.story.findUnique.mockResolvedValue(null)
    const result = await callHandler(routes, 'DELETE', '/api/stories/:storyId/cover', {}, { storyId: 'missing' })
    expect(result.status).toBe(404)
    expect(result.body.success).toBe(false)
  })
})