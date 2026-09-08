import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createMockApp, callHandler } from '../setup.js'

describe('graph route — JSON.parse resilience', () => {
  let mockPrisma: any
  let routes: Record<string, any>

  beforeEach(async () => {
    mockPrisma = {
      chapter: {
        findFirst: vi.fn(),
        findUnique: vi.fn(),
        update: vi.fn()
      },
      graphNode: { create: vi.fn(), findUnique: vi.fn() },
      graphEdge: { create: vi.fn() }
    }
    const { graphRoutes } = await import('../../routes/graph.js')
    const built = createMockApp(mockPrisma)
    await graphRoutes(built.app)
    routes = built.routes
  })

  it('returns empty graph when cumulativeGraph is corrupted (not 500)', async () => {
    // Corrupted string in DB — current code throws SyntaxError, fix should
    // fall back to empty graph via safeJsonParse.
    mockPrisma.chapter.findFirst.mockResolvedValue({
      cumulativeGraph: 'this is not json{{'
    })

    const result = await callHandler(
      routes,
      'GET',
      '/api/stories/:storyId/graph',
      undefined,
      { storyId: 's1' }
    )

    // No 500 status
    expect(result.status).not.toBe(500)
    // Fallback returns success with empty graph
    expect(result.body).toEqual(
      expect.objectContaining({ success: true, data: { nodes: [], edges: [] } })
    )
  })

  it('returns empty graph when no archived chapter exists', async () => {
    mockPrisma.chapter.findFirst.mockResolvedValue(null)

    const result = await callHandler(
      routes,
      'GET',
      '/api/stories/:storyId/graph',
      undefined,
      { storyId: 's1' }
    )

    expect(result.body).toEqual(
      expect.objectContaining({ success: true, data: { nodes: [], edges: [] } })
    )
  })
})
