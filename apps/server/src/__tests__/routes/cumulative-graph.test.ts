import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createMockApp, callHandler, createMockPrisma } from '../setup.js'

// 全局 setup.ts 在每个 test 前 vi.resetAllMocks(), 各 describe 再自建 mockPrisma 保证隔离。

vi.mock('../../services/stages/cumulative-graph-build-service.js', () => ({
  buildCumulativeGraphWithTimestamp: vi.fn()
}))

import { buildCumulativeGraphWithTimestamp } from '../../services/stages/cumulative-graph-build-service.js'

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
    expect(res.body).toEqual({ success: true, data: { generatedAt: null, graph: null, chapterGraph: null } })
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
    expect(res.body.data.graph).toEqual(storedGraph)
  })
})

describe('POST /api/chapters/:chapterId/cumulative-graph/build', () => {
  let mockPrisma: ReturnType<typeof createMockPrisma>
  let app: any
  let routes: Record<string, any>

  beforeEach(async () => {
    vi.clearAllMocks()
    mockPrisma = createMockPrisma()
    const built = createMockApp(mockPrisma)
    app = built.app
    routes = built.routes
    const { chapterArchiveRoutes } = await import('../../routes/chapters-archive.js')
    await chapterArchiveRoutes(app)
  })

  it('writes both cumulativeGraph and cumulativeGraphGeneratedAt on success', async () => {
    const generatedGraph = {
      nodes: [{ type: 'character', key: 'a', label: 'A', data: {} }],
      edges: [],
      timestamp: '2026-07-27T10:00:00.000Z',
    }
    ;(buildCumulativeGraphWithTimestamp as any).mockResolvedValueOnce({
      graph: generatedGraph,
      generatedAt: '2026-07-27T10:00:00.000Z',
      aiCalled: true,
    })
    mockPrisma.chapter.findUnique.mockResolvedValueOnce({
      id: 'ch-1', storyId: 's1', number: 1, status: 'reviewing',
      cumulativeGraph: null, cumulativeGraphGeneratedAt: null,
      parentChapterId: null, isSideStory: false, content: 'x',
    })
    mockPrisma.chapter.findFirst.mockResolvedValueOnce(null)
    mockPrisma.chapter.update.mockResolvedValueOnce({})
    const res = await callHandler(
      routes,
      'POST',
      '/api/chapters/:chapterId/cumulative-graph/build',
      { chapterGraph: { nodes: [{ type: 'character', key: 'a' }], edges: [] } },
      { chapterId: 'ch-1' },
    )
    expect(mockPrisma.chapter.update).toHaveBeenCalledTimes(1)
    const updateArgs = mockPrisma.chapter.update.mock.calls[0][0]
    expect(updateArgs.data.cumulativeGraph).toBe(JSON.stringify(generatedGraph))
    expect(updateArgs.data.cumulativeGraphGeneratedAt).toBeInstanceOf(Date)
    expect(res.body.success).toBe(true)
    expect(res.body.data.aiCalled).toBe(true)
  })
})

describe('PATCH /api/chapters/:chapterId/cumulative-graph', () => {
  let mockPrisma: ReturnType<typeof createMockPrisma>
  let app: any
  let routes: Record<string, any>

  beforeEach(async () => {
    vi.clearAllMocks()
    mockPrisma = createMockPrisma()
    const built = createMockApp(mockPrisma)
    app = built.app
    routes = built.routes
    const { chapterArchiveRoutes } = await import('../../routes/chapters-archive.js')
    await chapterArchiveRoutes(app)
  })

  it('rejects when cumulativeGraphGeneratedAt is null', async () => {
    mockPrisma.chapter.findUnique.mockResolvedValueOnce({
      id: 'ch-1', status: 'reviewing',
      cumulativeGraph: null, cumulativeGraphGeneratedAt: null,
    })
    const res = await callHandler(
      routes,
      'PATCH',
      '/api/chapters/:chapterId/cumulative-graph',
      { graph: { nodes: [], edges: [], timestamp: '2026-07-27T10:00:00.000Z' } },
      { chapterId: 'ch-1' },
    )
    expect(mockPrisma.chapter.update).not.toHaveBeenCalled()
    expect(res.body.success).toBe(false)
    expect(res.body.error).toBe('cumulative-graph-not-generated')
  })

  it('writes graph without touching generatedAt', async () => {
    const fixedDate = new Date('2026-07-27T08:00:00.000Z')
    mockPrisma.chapter.findUnique.mockResolvedValueOnce({
      id: 'ch-1', status: 'reviewing',
      cumulativeGraph: null, cumulativeGraphGeneratedAt: fixedDate,
    })
    mockPrisma.chapter.update.mockResolvedValueOnce({})
    const editedGraph = {
      nodes: [{ type: 'character', key: 'linfan', label: '林凡', data: {} }],
      edges: [],
      timestamp: '2026-07-27T10:00:00.000Z',
    }
    const res = await callHandler(
      routes,
      'PATCH',
      '/api/chapters/:chapterId/cumulative-graph',
      { graph: editedGraph },
      { chapterId: 'ch-1' },
    )
    expect(res.body.success).toBe(true)
    expect(mockPrisma.chapter.update).toHaveBeenCalledTimes(1)
    const updateArgs = mockPrisma.chapter.update.mock.calls[0][0]
    expect(updateArgs.data).not.toHaveProperty('cumulativeGraphGeneratedAt')
    expect(JSON.parse(updateArgs.data.cumulativeGraph).nodes).toEqual([
      { type: 'character', key: 'linfan', label: '林凡', data: {} },
    ])
  })
})
