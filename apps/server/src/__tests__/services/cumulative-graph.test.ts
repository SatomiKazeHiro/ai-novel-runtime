import { describe, it, expect, vi } from 'vitest'

vi.mock('../../services/ai-call-logger.js', () => ({
  callAIWithLog: vi.fn()
}))

vi.mock('../../services/runtime-loader.js', () => ({
  loadRuntimeBase: vi.fn().mockResolvedValue({
    identity: '',
    settings: {},
    behavior: ''
  }),
  loadWorkerTask: vi.fn().mockResolvedValue({
    workerType: 'graph',
    taskPrompt: ''
  })
}))

vi.mock('../../services/graph-snapshot.js', async () => {
  const actual = await vi.importActual<any>('../../services/graph-snapshot.js')
  return {
    ...actual,
    expandNeighborhood: vi.fn()
  }
})

vi.mock('../../services/ai-provider-init.js', () => ({
  resolveProvider: vi.fn().mockResolvedValue({
    provider: {},
    config: { contextLength: 64000, maxTokens: 16384 }
  }),
  getProviderById: vi.fn(),
  getDefaultProvider: vi.fn()
}))

vi.mock('@novel-runtime/ai-provider', () => {
  class RuntimePromptCompiler {
    compile(_base: unknown, _task: unknown, userMessage: string) {
      return {
        systemMessage: '',
        userMessage,
        meta: { totalTokens: 0 }
      }
    }
  }
  return { RuntimePromptCompiler }
})

import { buildCumulativeGraph } from '../../services/cumulative-graph.js'
import { callAIWithLog } from '../../services/ai-call-logger.js'
import { expandNeighborhood } from '../../services/graph-snapshot.js'

const mockApp: any = {
  prisma: {},
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}

const ts = '2026-07-25T00:00:00.000Z'

describe('buildCumulativeGraph', () => {
  it('returns prevCumulativeGraph when chapterGraph is empty (no AI called)', async () => {
    const prev = { nodes: [{ type: 'character', key: 'a', label: 'A', data: {} }], edges: [], timestamp: ts }

    const result = await buildCumulativeGraph(mockApp, {
      storyId: 's1', chapterId: 'c1', chapterNumber: 2,
      chapterGraph: { nodes: [], edges: [], timestamp: ts },
      prevCumulativeGraph: prev
    })

    expect(result.aiCalled).toBe(false)
    expect(result.cumulativeGraph).toEqual(prev)
    expect(callAIWithLog).not.toHaveBeenCalled()
    expect(expandNeighborhood).not.toHaveBeenCalled()
  })

  it('returns chapterGraph copy when prev is null (first chapter)', async () => {
    const chapterGraph = { nodes: [{ type: 'character', key: 'a', label: 'A', data: {} }], edges: [], timestamp: ts }

    const result = await buildCumulativeGraph(mockApp, {
      storyId: 's1', chapterId: 'c1', chapterNumber: 1,
      chapterGraph, prevCumulativeGraph: null
    })

    expect(result.aiCalled).toBe(false)
    expect(result.cumulativeGraph.nodes).toEqual(chapterGraph.nodes)
    expect(callAIWithLog).not.toHaveBeenCalled()
    expect(expandNeighborhood).not.toHaveBeenCalled()
  })

  it('calls AI dedup and merges when both chapterGraph and prev are non-empty', async () => {
    const prev = {
      nodes: [
        { type: 'character', key: 'a', label: 'A', data: {} },
        { type: 'character', key: 'b', label: 'B', data: {} }
      ],
      edges: [{ fromType: 'character', fromKey: 'a', toType: 'character', toKey: 'b', relation: '朋友', weight: 1 }],
      timestamp: ts
    }
    const chapterGraph = {
      nodes: [{ type: 'character', key: 'a', label: 'A', data: { newAttr: 'x' } }],
      edges: [{ fromType: 'character', fromKey: 'a', toType: 'character', toKey: 'b', relation: '敌对', weight: 1 }],
      timestamp: ts
    }

    // AI dedup 后的子图
    const deduped = {
      nodes: [
        { type: 'character', key: 'a', label: 'A', data: { newAttr: 'x' } },
        { type: 'character', key: 'b', label: 'B', data: {} }
      ],
      edges: [
        { fromType: 'character', fromKey: 'a', toType: 'character', toKey: 'b', relation: '朋友', weight: 1 },
        { fromType: 'character', fromKey: 'a', toType: 'character', toKey: 'b', relation: '敌对', weight: 1 }
      ]
    }
    ;(expandNeighborhood as any).mockReturnValueOnce({
      nodes: prev.nodes,
      edges: prev.edges,
      truncated: false,
      estimatedTokens: 0
    })
    ;(callAIWithLog as any).mockResolvedValueOnce(JSON.stringify(deduped))

    const result = await buildCumulativeGraph(mockApp, {
      storyId: 's1', chapterId: 'c1', chapterNumber: 2,
      chapterGraph, prevCumulativeGraph: prev
    })

    expect(result.aiCalled).toBe(true)
    expect(callAIWithLog).toHaveBeenCalled()
    expect(expandNeighborhood).toHaveBeenCalled()
    // a 在 dedup 中保留,b 也保留,两条边都保留
    expect(result.cumulativeGraph.nodes).toHaveLength(2)
    expect(result.cumulativeGraph.edges).toHaveLength(2)
  })

  it('throws when AI fails', async () => {
    const chapterGraph = { nodes: [{ type: 'character', key: 'a', label: 'A', data: {} }], edges: [], timestamp: ts }
    const prev = { nodes: [{ type: 'character', key: 'a', label: 'A', data: {} }], edges: [], timestamp: ts }

    ;(expandNeighborhood as any).mockReturnValueOnce({
      nodes: prev.nodes,
      edges: prev.edges,
      truncated: false,
      estimatedTokens: 0
    })
    ;(callAIWithLog as any).mockResolvedValueOnce(null)

    await expect(buildCumulativeGraph(mockApp, {
      storyId: 's1', chapterId: 'c1', chapterNumber: 2,
      chapterGraph, prevCumulativeGraph: prev
    })).rejects.toThrow()
  })
})
