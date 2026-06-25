import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createMockApp, callHandler, createMockPrisma } from '../setup.js'

describe('DELETE /api/stories/:id — cascade cover cleanup', () => {
  let mockPrisma: any
  let routes: Record<string, any>
  let coverStorageMock: any

  beforeEach(async () => {
    vi.clearAllMocks()
    mockPrisma = createMockPrisma({
      story: {
        delete: vi.fn().mockResolvedValue({ id: 's1' })
      }
    })
    coverStorageMock = {
      deleteCoversByStoryId: vi.fn().mockResolvedValue(undefined)
    }
    vi.resetModules()
    vi.doMock('../../lib/cover-storage.js', () => coverStorageMock)
    const { storyRoutes } = await import('../../routes/stories.js')
    const built = createMockApp(mockPrisma)
    await storyRoutes(built.app)
    routes = built.routes
  })

  it('removes all covers for storyId after DB delete', async () => {
    const result = await callHandler(routes, 'DELETE', '/:id', {}, { id: 's1' })
    expect(result.body.success).toBe(true)
    expect(mockPrisma.story.delete).toHaveBeenCalledWith({ where: { id: 's1' } })
    expect(coverStorageMock.deleteCoversByStoryId).toHaveBeenCalledWith(expect.any(String), 's1')
  })

  it('does not fail when deleteCoversByStoryId throws (log only)', async () => {
    coverStorageMock.deleteCoversByStoryId.mockRejectedValue(new Error('disk error'))
    const result = await callHandler(routes, 'DELETE', '/:id', {}, { id: 's1' })
    expect(result.body.success).toBe(true)
  })
})