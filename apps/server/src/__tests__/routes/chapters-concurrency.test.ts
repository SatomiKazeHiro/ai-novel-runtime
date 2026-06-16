import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createMockApp, callHandler, createMockPrisma } from '../setup.js'

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

describe('select route — status-exclusive lock (Q#10 follow-up)', () => {
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

  it('returns 409 when status lock fails (chapter not in generated/scored)', async () => {
    // findUnique reads the chapter as 'generated' (stale view), but a concurrent
    // request has already flipped it to 'selected' between the read and the
    // updateMany — the atomic lock must reject this submission with 409.
    mockPrisma.chapter.findUnique.mockResolvedValue({
      id: 'c1', status: 'generated'
    })
    mockPrisma.draft.findUnique.mockResolvedValue({
      id: 'd1', chapterId: 'c1', content: 'text', chapter: { id: 'c1' }
    })
    // The atomic updateMany reports 0 rows flipped — the precondition
    // `status IN ('generated','scored')` failed.
    mockPrisma.chapter.updateMany.mockResolvedValue({ count: 0 })

    const result = await callHandler(
      routes,
      'POST',
      '/api/chapters/:chapterId/select',
      { draftId: 'd1' },
      { chapterId: 'c1' }
    )

    expect(result.status).toBe(409)
    expect(result.body).toEqual(
      expect.objectContaining({ success: false })
    )
    // No transaction should run — the second concurrent submission must be
    // rejected before any side effects.
    expect(mockPrisma.$transaction).not.toHaveBeenCalled()
  })

  it('proceeds when lock succeeds (count=1)', async () => {
    mockPrisma.chapter.findUnique.mockResolvedValue({
      id: 'c1', status: 'generated'
    })
    mockPrisma.draft.findUnique.mockResolvedValue({
      id: 'd1', chapterId: 'c1', content: 'text', chapter: { id: 'c1' }
    })
    mockPrisma.chapter.updateMany.mockResolvedValue({ count: 1 })
    mockPrisma.draft.updateMany.mockResolvedValue({ count: 1 })
    mockPrisma.draft.update.mockResolvedValue({ id: 'd1', status: 'selected' })
    mockPrisma.chapter.update.mockResolvedValue({ id: 'c1', status: 'selected' })

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
})

describe('prepare-archive route — status-exclusive lock (Q#10 follow-up)', () => {
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

  it('returns 409 when status lock fails (chapter not in selected)', async () => {
    // findUnique reads the chapter as 'selected' (stale view), but a concurrent
    // request has already flipped it to 'reviewing' between the read and the
    // updateMany — the atomic lock must reject this submission with 409,
    // preventing a 2× AI extraction call.
    mockPrisma.chapter.findUnique.mockResolvedValue({
      id: 'c1',
      storyId: 's1',
      status: 'selected',
      isSideStory: false,
      content: 'a'.repeat(200),
      outline: 'short outline',
      number: 1,
      parentChapterId: null,
      story: { id: 's1' }
    })
    // The atomic updateMany reports 0 rows flipped — the precondition
    // `status='selected'` failed.
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
    // prepareArchiveData must NOT be called — the second concurrent submission
    // must be rejected before any AI extraction runs.
    expect(prepareArchiveData).not.toHaveBeenCalled()
  })

  it('proceeds when lock succeeds (count=1)', async () => {
    mockPrisma.chapter.findUnique.mockResolvedValue({
      id: 'c1',
      storyId: 's1',
      status: 'selected',
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

describe('archive route — status-exclusive lock (Q#10 follow-up)', () => {
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

  it('returns 409 when status lock fails (chapter not in reviewing)', async () => {
    // findUnique reads the chapter as 'reviewing' (stale view), but a concurrent
    // request has already flipped it to 'archived' between the read and the
    // updateMany — the atomic lock must reject this submission with 409,
    // preventing duplicate Memory/TimelineEvent/PlotArc/GraphNode/GraphEdge
    // writes from two concurrent transactions.
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
    // The atomic updateMany reports 0 rows flipped — the precondition
    // `status='reviewing'` failed.
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
    // No transaction should run — duplicate writes must be impossible.
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
    // Transaction must run exactly once.
    expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1)
  })
})
