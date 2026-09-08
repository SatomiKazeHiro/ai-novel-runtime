import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createMockApp, callHandler } from '../setup.js'

describe('GET /api/chapters/:chapterId/cumulative-graph — chapterGraph 契约', () => {
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

  it('chapter 有 graph + chapterGraph 两者都回', async () => {
    const isoNow = '2026-07-27T10:00:00.000Z'
    const storedGraph = {
      nodes: [{ type: 'character', key: 'linfan', label: '林凡', data: {} }],
      edges: [{ fromType: 'character', fromKey: 'linfan', toType: 'event', toKey: 'duel', relation: '参与', weight: 1 }],
      timestamp: isoNow
    }
    const storedChapterGraph = {
      nodes: [{ type: 'character', key: 'linfan', label: '林凡', data: {} }],
      edges: [{ fromType: 'character', fromKey: 'linfan', toType: 'event', toKey: 'duel', relation: '参与', weight: 1 }],
      timestamp: isoNow
    }
    mockPrisma.chapter.findUnique.mockResolvedValueOnce({
      id: 'ch-1',
      cumulativeGraph: JSON.stringify(storedGraph),
      chapterGraph: JSON.stringify(storedChapterGraph),
      cumulativeGraphGeneratedAt: new Date(isoNow),
      status: 'archived', isSideStory: false, content: 'x',
      parentChapterId: null, number: 1, storyId: 's1'
    })
    const res = await callHandler(
      routes, 'GET', '/api/chapters/:chapterId/cumulative-graph',
      undefined, { chapterId: 'ch-1' }
    )
    expect(res.body.success).toBe(true)
    expect(res.body.data.generatedAt).toBe(isoNow)
    expect(res.body.data.graph).toEqual(storedGraph)
    expect(res.body.data.chapterGraph).toEqual(storedChapterGraph)
  })

  it('chapter 都没有时,generatedAt / graph / chapterGraph 都为 null', async () => {
    mockPrisma.chapter.findUnique.mockResolvedValueOnce({
      id: 'ch-1',
      cumulativeGraph: null,
      chapterGraph: null,
      cumulativeGraphGeneratedAt: null,
      status: 'draft', isSideStory: false, content: 'x',
      parentChapterId: null, number: 1, storyId: 's1'
    })
    const res = await callHandler(
      routes, 'GET', '/api/chapters/:chapterId/cumulative-graph',
      undefined, { chapterId: 'ch-1' }
    )
    expect(res.body).toEqual({ success: true, data: { generatedAt: null, graph: null, chapterGraph: null } })
  })

  it('chapter 只有 graph 没有 chapterGraph 时,chapterGraph 字段回 null', async () => {
    const isoNow = '2026-07-27T10:00:00.000Z'
    const storedGraph = {
      nodes: [{ type: 'character', key: 'a', label: 'A', data: {} }],
      edges: [],
      timestamp: isoNow
    }
    mockPrisma.chapter.findUnique.mockResolvedValueOnce({
      id: 'ch-1',
      cumulativeGraph: JSON.stringify(storedGraph),
      chapterGraph: null,
      cumulativeGraphGeneratedAt: new Date(isoNow),
      status: 'archived', isSideStory: false, content: 'x',
      parentChapterId: null, number: 1, storyId: 's1'
    })
    const res = await callHandler(
      routes, 'GET', '/api/chapters/:chapterId/cumulative-graph',
      undefined, { chapterId: 'ch-1' }
    )
    expect(res.body.success).toBe(true)
    expect(res.body.data.generatedAt).toBe(isoNow)
    expect(res.body.data.graph).toEqual(storedGraph)
    expect(res.body.data.chapterGraph).toBeNull()
  })

  it('cumulativeGraphGeneratedAt 是 Date 类型时回 ISO 字符串', async () => {
    mockPrisma.chapter.findUnique.mockResolvedValueOnce({
      id: 'ch-1',
      cumulativeGraph: null,
      chapterGraph: null,
      cumulativeGraphGeneratedAt: new Date('2026-07-01T08:00:00.000Z'),
      status: 'archived', isSideStory: false, content: 'x',
      parentChapterId: null, number: 1, storyId: 's1'
    })
    const res = await callHandler(
      routes, 'GET', '/api/chapters/:chapterId/cumulative-graph',
      undefined, { chapterId: 'ch-1' }
    )
    expect(res.body.data.generatedAt).toBe('2026-07-01T08:00:00.000Z')
  })

  it('chapterGraph JSON 损坏时回 null 而不抛错', async () => {
    const isoNow = '2026-07-27T10:00:00.000Z'
    mockPrisma.chapter.findUnique.mockResolvedValueOnce({
      id: 'ch-1',
      cumulativeGraph: null,
      chapterGraph: '{not valid json[',
      cumulativeGraphGeneratedAt: null,
      status: 'archived', isSideStory: false, content: 'x',
      parentChapterId: null, number: 1, storyId: 's1'
    })
    const res = await callHandler(
      routes, 'GET', '/api/chapters/:chapterId/cumulative-graph',
      undefined, { chapterId: 'ch-1' }
    )
    expect(res.body.success).toBe(true)
    expect(res.body.data.chapterGraph).toBeNull()
  })
})