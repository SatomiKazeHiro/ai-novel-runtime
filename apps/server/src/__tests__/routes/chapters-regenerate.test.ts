import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createMockApp, callHandler } from '../setup.js'

// Mock the prepareArchiveData service so the route does not hit the real
// AI extraction path. Matches the vi.mock in prepare-archive.test.ts.
vi.mock('../../services/combined-extractor.js', () => ({
  prepareArchiveData: vi.fn(),
  extractAll: vi.fn()
}))

// Mock the memory optimizer so the archive route does not hit AI.
vi.mock('../../services/memory-optimizer.js', () => ({
  optimizeMemories: vi.fn().mockResolvedValue(0)
}))

// Mock the graph snapshot helper so the archive route does not touch
// the real graphNode/graphEdge write paths.
vi.mock('../../services/graph-snapshot.js', () => ({
  saveGraphSnapshotAndDelta: vi.fn().mockResolvedValue({
    snapshot: { nodes: [], edges: [], timestamp: '' },
    delta: { nodes: [], edges: [], timestamp: '' }
  })
}))

import { prepareArchiveData } from '../../services/combined-extractor.js'

describe('select route — v2 no chapter.status lock', () => {
  let mockPrisma: any
  let routes: Record<string, any>

  beforeEach(async () => {
    vi.clearAllMocks()
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
      $transaction: vi.fn(async (fn: any) => fn(mockPrisma))
    }
    const { chapterRoutes } = await import('../../routes/chapters.js')
    const built = createMockApp(mockPrisma)
    await chapterRoutes(built.app)
    routes = built.routes
  })

  it('accepts draft without 409 (v2 has no select lock)', async () => {
    // v2: select 不再翻 chapter.status, 也没有锁 updateMany;
    // 旧测试期望的 409 路径已不存在。这里证明 draft 状态 select 成功。
    mockPrisma.chapter.findUnique.mockResolvedValue({
      id: 'c1', status: 'draft'
    })
    mockPrisma.draft.findUnique.mockResolvedValue({
      id: 'd1', chapterId: 'c1', content: 'text'
    })
    mockPrisma.draft.updateMany.mockResolvedValue({ count: 1 })
    mockPrisma.chapter.update.mockResolvedValue({ id: 'c1', status: 'draft' })

    const result = await callHandler(
      routes,
      'POST',
      '/api/chapters/:chapterId/select',
      { draftId: 'd1' },
      { chapterId: 'c1' }
    )

    expect(result.status).not.toBe(409)
    expect(mockPrisma.$transaction).toHaveBeenCalled()
    expect(result.body).toEqual({ success: true })
  })

  it('proceeds without updateMany lock calls on chapter', async () => {
    mockPrisma.chapter.findUnique.mockResolvedValue({
      id: 'c1', status: 'draft'
    })
    mockPrisma.draft.findUnique.mockResolvedValue({
      id: 'd1', chapterId: 'c1', content: 'text'
    })
    mockPrisma.draft.updateMany.mockResolvedValue({ count: 1 })
    mockPrisma.chapter.update.mockResolvedValue({ id: 'c1', status: 'draft' })

    await callHandler(
      routes,
      'POST',
      '/api/chapters/:chapterId/select',
      { draftId: 'd1' },
      { chapterId: 'c1' }
    )

    // v2: select 不调用 chapter.updateMany (无锁)
    expect(mockPrisma.chapter.updateMany).not.toHaveBeenCalled()
  })
})

describe('prepare-archive route — v2 lock uses [draft, reviewing]', () => {
  let mockPrisma: any
  let routes: Record<string, any>

  beforeEach(async () => {
    vi.clearAllMocks()
    mockPrisma = {
      chapter: {
        findUnique: vi.fn(),
        update: vi.fn(),
        updateMany: vi.fn()
      }
    }
    const { chapterRoutes } = await import('../../routes/chapters.js')
    const built = createMockApp(mockPrisma)
    await chapterRoutes(built.app)
    routes = built.routes
  })

  it('returns 409 when status lock fails (chapter raced past draft/reviewing — concurrent prepare)', async () => {
    // v2: 锁条件是 [draft, reviewing]。这里模拟 findUnique 读到 'draft' 但并发请求
    // 已把它翻到 'archived' — 原子 updateMany where status IN [draft, reviewing]
    // 返回 0 → 409,防止并发 prepare-archive 触发 2× AI 提取。
    mockPrisma.chapter.findUnique.mockResolvedValue({
      id: 'c1',
      storyId: 's1',
      status: 'draft',
      isSideStory: false,
      content: 'a'.repeat(200),
      outline: 'short outline',
      number: 1,
      parentChapterId: null,
      story: { id: 's1' }
    })
    mockPrisma.chapter.updateMany.mockResolvedValue({ count: 0 })

    const result = await callHandler(
      routes,
      'POST',
      '/api/chapters/:chapterId/prepare-archive',
      undefined,
      { chapterId: 'c1' }
    )

    expect(result.status).toBe(409)
    expect(result.body).toEqual(
      expect.objectContaining({ success: false })
    )
    expect(prepareArchiveData).not.toHaveBeenCalled()
  })

  it('proceeds when lock succeeds (draft status)', async () => {
    // v2 主流程: draft (有 content) → 走 prepare-archive
    mockPrisma.chapter.findUnique.mockResolvedValue({
      id: 'c1',
      storyId: 's1',
      status: 'draft',
      isSideStory: false,
      content: 'a'.repeat(200),
      outline: 'short outline',
      number: 1,
      parentChapterId: null,
      story: { id: 's1' }
    })
    mockPrisma.chapter.updateMany.mockResolvedValue({ count: 1 })
    ;(prepareArchiveData as any).mockResolvedValue({
      memories: { items: [], summary: '' },
      graph: { mergedGraph: { nodes: [], edges: [], timestamp: '' }, chapterGraph: { nodes: [], edges: [], timestamp: '' } },
      plotArcs: { toCreate: [], toUpdate: [] }
    })
    mockPrisma.chapter.update.mockResolvedValue({ id: 'c1', status: 'reviewing' })

    const result = await callHandler(
      routes,
      'POST',
      '/api/chapters/:chapterId/prepare-archive',
      undefined,
      { chapterId: 'c1' }
    )

    expect(result.status).not.toBe(409)
    expect(prepareArchiveData).toHaveBeenCalledTimes(1)
  })
})

describe('archive route — reviewing → archived (unchanged)', () => {
  let mockPrisma: any
  let routes: Record<string, any>

  beforeEach(async () => {
    vi.clearAllMocks()
    mockPrisma = {
      chapter: {
        findUnique: vi.fn(),
        update: vi.fn(),
        updateMany: vi.fn()
      },
      $transaction: vi.fn(async (fn: any) => fn(mockPrisma))
    }
    const { chapterRoutes } = await import('../../routes/chapters.js')
    const built = createMockApp(mockPrisma)
    await chapterRoutes(built.app)
    routes = built.routes
  })

  it('returns 409 when status lock fails (chapter raced past reviewing — concurrent archive)', async () => {
    // findUnique 读到 'reviewing', 但并发请求已经把它翻到 'archived' —
    // 原子 updateMany where status='reviewing' 返回 0 → 409,
    // 防止两次 archive 路径重复写 Memory/TimelineEvent/PlotArc/GraphNode/GraphEdge。
    mockPrisma.chapter.findUnique.mockResolvedValue({
      id: 'c1',
      storyId: 's1',
      status: 'reviewing',
      isSideStory: false,
      content: 'a'.repeat(200),
      number: 1,
      pendingArchiveData: JSON.stringify({
        memories: { items: [], summary: '' },
        graph: { mergedGraph: { nodes: [], edges: [], timestamp: '' }, chapterGraph: { nodes: [], edges: [], timestamp: '' } },
        plotArcs: { toCreate: [], toUpdate: [] }
      }),
      story: { id: 's1' }
    })
    mockPrisma.chapter.updateMany.mockResolvedValue({ count: 0 })

    const result = await callHandler(
      routes,
      'POST',
      '/api/chapters/:chapterId/archive',
      undefined,
      { chapterId: 'c1' }
    )

    expect(result.status).toBe(409)
    expect(result.body).toEqual(
      expect.objectContaining({ success: false })
    )
    expect(mockPrisma.$transaction).not.toHaveBeenCalled()
  })

  it('proceeds when lock succeeds (count=1)', async () => {
    mockPrisma.chapter.findUnique.mockResolvedValue({
      id: 'c1',
      storyId: 's1',
      status: 'reviewing',
      isSideStory: false,
      content: 'a'.repeat(200),
      number: 1,
      pendingArchiveData: JSON.stringify({
        memories: { items: [], summary: '' },
        graph: { mergedGraph: { nodes: [], edges: [], timestamp: '' }, chapterGraph: { nodes: [], edges: [], timestamp: '' } },
        plotArcs: { toCreate: [], toUpdate: [] }
      }),
      story: { id: 's1' }
    })
    mockPrisma.chapter.updateMany.mockResolvedValue({ count: 1 })
    mockPrisma.chapter.update.mockResolvedValue({ id: 'c1', status: 'archived' })

    const result = await callHandler(
      routes,
      'POST',
      '/api/chapters/:chapterId/archive',
      undefined,
      { chapterId: 'c1' }
    )

    expect(result.status).not.toBe(409)
    expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1)
  })
})
