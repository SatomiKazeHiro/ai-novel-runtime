import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createMockApp, callHandler } from '../setup.js'

describe('GET /api/chapters/:chapterId/cumulative-graph', () => {
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

  it('returns generatedAt=null and graph=null when not yet generated', async () => {
    mockPrisma.chapter.findUnique.mockResolvedValueOnce({
      id: 'ch-1',
      cumulativeGraph: null,
      cumulativeGraphGeneratedAt: null,
      status: 'reviewing', isSideStory: false, content: 'x',
      parentChapterId: null, number: 1, storyId: 's1'
    })
    const res = await callHandler(
      routes, 'GET', '/api/chapters/:chapterId/cumulative-graph',
      undefined, { chapterId: 'ch-1' }
    )
    expect(res.body).toEqual({ success: true, data: { generatedAt: null, graph: null } })
  })

  it('returns existing graph and generatedAt', async () => {
    const isoNow = '2026-07-27T10:00:00.000Z'
    const storedGraph = {
      nodes: [{ type: 'character', key: 'linfan', label: '林凡', data: {} }],
      edges: [],
      timestamp: isoNow
    }
    mockPrisma.chapter.findUnique.mockResolvedValueOnce({
      id: 'ch-1',
      cumulativeGraph: JSON.stringify(storedGraph),
      cumulativeGraphGeneratedAt: new Date(isoNow),
      status: 'reviewing', isSideStory: false, content: 'x',
      parentChapterId: null, number: 1, storyId: 's1'
    })
    const res = await callHandler(
      routes, 'GET', '/api/chapters/:chapterId/cumulative-graph',
      undefined, { chapterId: 'ch-1' }
    )
    expect(res.body.success).toBe(true)
    expect(res.body.data.generatedAt).toBe(isoNow)
    expect(res.body.data.graph.nodes).toEqual(storedGraph.nodes)
  })
})