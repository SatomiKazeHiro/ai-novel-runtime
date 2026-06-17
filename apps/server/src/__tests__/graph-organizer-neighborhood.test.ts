import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { GraphSnapshot } from '../services/graph-snapshot.js'
import type { GraphExtractionResult } from '../services/graph-extractor.js'

const mockCallAIWithLog = vi.fn()
const mockLoadRuntimeBase = vi.fn()
const mockLoadWorkerTask = vi.fn()
const mockResolveProvider = vi.fn()

vi.mock('../services/ai-call-logger.js', () => ({
  callAIWithLog: (...args: any[]) => mockCallAIWithLog(...args)
}))
vi.mock('../services/runtime-loader.js', () => ({
  loadRuntimeBase: (...args: any[]) => mockLoadRuntimeBase(...args),
  loadWorkerTask: (...args: any[]) => mockLoadWorkerTask(...args)
}))
// resolveProvider is imported transitively from ai-call-logger's dep, so mock the module
vi.mock('../services/ai-provider-init.js', () => ({
  resolveProvider: (...args: any[]) => mockResolveProvider(...args)
}))

import { organizeGraph } from '../services/graph-organizer.js'

const validResponse = {
  mergedGraph: {
    nodes: [{ type: 'character', key: 'a', label: 'A', data: {} }],
    edges: []
  },
  chapterGraph: {
    nodes: [{ type: 'character', key: 'a', label: 'A', data: {} }],
    edges: []
  }
}

function makePrev(): GraphSnapshot {
  return {
    nodes: [
      { type: 'character', key: 'a', label: 'A', data: {} },
      { type: 'character', key: 'b', label: 'B', data: {} },
      { type: 'character', key: 'c', label: 'C', data: {} }
    ],
    edges: [
      { fromType: 'character', fromKey: 'a', toType: 'character', toKey: 'b', relation: 'friend', weight: 1 }
    ],
    timestamp: ''
  }
}

function buildApp() {
  return { prisma: {}, log: { info: vi.fn(), error: vi.fn(), warn: vi.fn() } } as any
}

function setupCommonMocks() {
  mockLoadRuntimeBase.mockResolvedValue({ identity: '', settings: {}, behavior: '', jailbreak: '' })
  mockLoadWorkerTask.mockResolvedValue({ workerType: 'graph', taskPrompt: '' })
  mockResolveProvider.mockResolvedValue({
    provider: { generateWithRuntime: vi.fn(), lastUsage: { promptTokens: 1000, completionTokens: 0, totalTokens: 1000 } },
    config: { id: 'cfg-1', name: 'deepseek', model: 'deepseek-chat', contextLength: 64000, maxTokens: 16384, temperature: 0.3 }
  })
}

describe('organizeGraph — key matching and prompt', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setupCommonMocks()
    mockCallAIWithLog.mockResolvedValue('```json\n' + JSON.stringify(validResponse) + '\n```')
  })

  it('matchedKeys > 0: feeds neighborhood (not full snapshot) to AI', async () => {
    const prev = makePrev()
    const extracted: GraphExtractionResult = {
      nodes: [
        { type: 'character', key: 'a', label: 'A', importance: 8, data: {} }  // matches prev
      ],
      edges: []
    }
    const app = buildApp()
    await organizeGraph(app, 's1', 'c1', prev, extracted)

    expect(mockCallAIWithLog).toHaveBeenCalledTimes(1)
    const userMessage: string = mockCallAIWithLog.mock.calls[0][1].compiled.userMessage
    // Neighborhood should include 'a' (matched) and its 1-hop neighbor 'b'.
    // The neighborhood excludes 'c' (no edge connects a/b to c in makePrev).
    expect(userMessage).toContain('"key":"a"')
    expect(userMessage).toContain('"key":"b"')
    expect(userMessage).not.toContain('"key":"c"')
    // The prompt header should reference the neighborhood concept
    expect(userMessage).toMatch(/邻域|neighborhood/i)
  })

  it('logs TODO warn when neighborhood was truncated by budget', async () => {
    // Force truncation via the token_budget cap and size the budget so that
    // usageRatio >= NEIGHBORHOOD_BUDGET_HEADROOM (0.9) — the spec's trigger.
    //
    // Setup:
    //   - 200 nodes connected as a star centered on n0 so 1-hop BFS from n0
    //     reaches all 200 of them, hits the token_budget cap, yielding
    //     estimatedTokens ≈ 10000+ (each node ~54 tokens)
    //   - contextLength: 45000 → graphBudget ≈ 45000 - nonGraphTokens(~16445)
    //     - 16384 - 2000 ≈ 10171, so usageRatio ≈ 100%, well above 0.9
    const hugePrev: GraphSnapshot = {
      nodes: Array.from({ length: 200 }, (_, i) => ({
        type: 'character' as const, key: `n${i}`, label: `L${i}`, data: { blob: 'x'.repeat(200) }
      })),
      // Star centered on n0: n0 connects to every other node so 1-hop BFS
      // from n0 reaches all 199 neighbors; the budget cap truncates mid-add.
      edges: Array.from({ length: 199 }, (_, i) => ({
        fromType: 'character' as const, fromKey: 'n0',
        toType: 'character' as const, toKey: `n${i + 1}`,
        relation: 'knows', weight: 1
      })),
      timestamp: ''
    }
    mockResolveProvider.mockResolvedValue({
      provider: { generateWithRuntime: vi.fn(), lastUsage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 } },
      config: { id: 'cfg-1', name: 'd', model: 'd', contextLength: 45000, maxTokens: 16384, temperature: 0.3 }
    })
    const extracted: GraphExtractionResult = {
      nodes: [{ type: 'character', key: 'n0', label: 'L0', importance: 8, data: {} }],
      edges: []
    }
    const app = buildApp()
    const log = app.log

    await organizeGraph(app, 's1', 'c1', hugePrev, extracted)

    expect(log.warn).toHaveBeenCalled()
    const warnMsg = (log.warn as any).mock.calls[0][0]
    expect(warnMsg).toMatch(/TODO/)
    expect(warnMsg).toMatch(/truncated|截断|token_budget|max_entities/)
  })
})

describe('organizeGraph — code-merge fallback when matchedKeys = 0', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setupCommonMocks()
  })

  it('skips AI call entirely; mergedGraph = union of prev ∪ extracted (deduped)', async () => {
    const prev = makePrev()
    const extracted: GraphExtractionResult = {
      nodes: [
        // None of these match prev keys (a/b/c)
        { type: 'character', key: 'new1', label: 'New1', importance: 7, data: {} },
        { type: 'character', key: 'new2', label: 'New2', importance: 7, data: {} }
      ],
      edges: [
        { fromType: 'character', fromKey: 'new1', toType: 'character', toKey: 'new2', relation: 'ally' }
      ]
    }
    const app = buildApp()
    const result = await organizeGraph(app, 's1', 'c1', prev, extracted)

    // No AI call
    expect(mockCallAIWithLog).not.toHaveBeenCalled()

    // mergedGraph: prev (3 nodes) ∪ extracted (2 nodes) = 5
    expect(result.mergedGraph.nodes).toHaveLength(5)
    const keys = result.mergedGraph.nodes.map(n => `${n.type}:${n.key}`).sort()
    expect(keys).toEqual(['character:a', 'character:b', 'character:c', 'character:new1', 'character:new2'])

    // Edges: prev edge (a->b) + new edge (new1->new2) = 2
    expect(result.mergedGraph.edges).toHaveLength(2)

    // chapterGraph = extracted (透传)
    expect(result.chapterGraph.nodes).toHaveLength(2)
    expect(result.chapterGraph.edges).toHaveLength(1)
  })

  it('dedupes edges by (fromType:fromKey, relation, toType:toKey) when prev and extracted overlap', async () => {
    const prev: GraphSnapshot = {
      nodes: [{ type: 'character', key: 'a', label: 'A', data: {} }],
      edges: [
        { fromType: 'character', fromKey: 'a', toType: 'character', toKey: 'b', relation: 'friend', weight: 1 }
      ],
      timestamp: ''
    }
    // Extracted has NO matching node keys, so matchedKeys=0 -> code-merge path
    const extracted: GraphExtractionResult = {
      nodes: [{ type: 'character', key: 'b', label: 'B', importance: 7, data: {} }],
      edges: [
        // Same edge as prev but it would only matter if we went through the AI path;
        // code-merge by (fromType,fromKey,relation,toType) should dedupe
        { fromType: 'character', fromKey: 'a', toType: 'character', toKey: 'b', relation: 'friend' }
      ]
    }
    const app = buildApp()
    const result = await organizeGraph(app, 's1', 'c1', prev, extracted)

    expect(result.mergedGraph.edges).toHaveLength(1)
  })
})
