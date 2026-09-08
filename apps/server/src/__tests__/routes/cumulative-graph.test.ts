import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createMockApp, callHandler } from '../setup.js'

// 全局 setup.ts 在每个 test 前 vi.resetAllMocks(), 各 describe 再自建 mockPrisma 保证隔离。

// v3: route 用的是 services/cumulative-graph.js 里的 buildCumulativeGraph,
// 不再走 stages/cumulative-graph-build-service.js 那个 wrapper。
vi.mock('../../services/cumulative-graph.js', () => ({
  buildCumulativeGraph: vi.fn()
}))

import { buildCumulativeGraph } from '../../services/cumulative-graph.js'

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
  let mockPrisma: any
  let app: any
  let routes: Record<string, any>

  beforeEach(async () => {
    vi.clearAllMocks()
    mockPrisma = {
      chapter: {
        findUnique: vi.fn(),
        findFirst: vi.fn(),
        update: vi.fn()
      }
    }
    const built = createMockApp(mockPrisma)
    app = built.app
    routes = built.routes
    const { chapterArchiveRoutes } = await import('../../routes/chapters-archive.js')
    await chapterArchiveRoutes(app)
  })

  it('writes cumulativeGraph + generatedAt to pendingArchiveData only (not columns) on success', async () => {
    const generatedGraph = {
      nodes: [{ type: 'character', key: 'a', label: 'A', data: {} }],
      edges: [],
      timestamp: '2026-07-27T10:00:00.000Z',
    }
    ;(buildCumulativeGraph as any).mockResolvedValueOnce({
      cumulativeGraph: generatedGraph,
      aiCalled: true,
    })
    mockPrisma.chapter.findUnique.mockResolvedValueOnce({
      id: 'ch-1', storyId: 's1', number: 1, status: 'reviewing',
      cumulativeGraph: null, cumulativeGraphGeneratedAt: null,
      parentChapterId: null, isSideStory: false, content: 'x',
      pendingArchiveData: JSON.stringify({
        version: 4,
        stages: { character: { status: 'success' }, memoryExtract: { status: 'success' }, memoryOptimize: { status: 'success' }, plotArc: { status: 'success' }, graph: { status: 'success' } },
        meta: { extractedAt: '2026-07-27T09:00:00.000Z', chapterNumber: 1 },
      }),
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
    // reviewing 期间三列整个过程不被读写
    expect(updateArgs.data).not.toHaveProperty('cumulativeGraph')
    expect(updateArgs.data).not.toHaveProperty('cumulativeGraphGeneratedAt')
    expect(updateArgs.data).not.toHaveProperty('chapterGraph')
    // 数据落到 pendingArchiveData
    const parsed = JSON.parse(updateArgs.data.pendingArchiveData)
    expect(parsed.cumulativeGraph).toEqual(generatedGraph)
    expect(typeof parsed.cumulativeGraphGeneratedAt).toBe('string')
    expect(res.body.success).toBe(true)
    expect(res.body.data.aiCalled).toBe(true)
  })
})

// PATCH /api/chapters/:chapterId/cumulative-graph 端点已删除。
// 用户编辑累计图谱后保存走 chaptersApi.update({ pendingArchiveData }) 通路
// (ReviewingPanel.handleSave → emit('save') → editor.savePendingArchiveData)。
// 见 chapters-archive.ts L467-470 的注释。
