import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { GraphSnapshot } from '../services/graph-snapshot.js'

const mockCallAIWithLog = vi.fn()
const mockLoadRuntimeBase = vi.fn()
const mockLoadWorkerTask = vi.fn()

vi.mock('../services/ai-call-logger.js', () => ({
  callAIWithLog: (...args: any[]) => mockCallAIWithLog(...args)
}))
vi.mock('../services/runtime-loader.js', () => ({
  loadRuntimeBase: (...args: any[]) => mockLoadRuntimeBase(...args),
  loadWorkerTask: (...args: any[]) => mockLoadWorkerTask(...args)
}))

import { extractAll, PREV_SNAPSHOT_INVENTORY_CAP } from '../services/combined-extractor.js'

const emptyPayload = {
  memories: { mainEvents: [], sideEvents: [], emotions: [], foreshadowing: [],
              relationshipChanges: [], characterStatusChanges: {},
              timelineDay: 1, summary: '', scenes: [] },
  graph: { nodes: [], edges: [] },
  plotArcs: { arcs: [] }
}

function buildPrisma() {
  return {
    character: { findMany: vi.fn().mockResolvedValue([]) },
    plotArc: { findMany: vi.fn().mockResolvedValue([]) },
    graphNode: { findMany: vi.fn().mockResolvedValue([]) }
  }
}

describe('extractAll — N-1 entity inventory injection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockLoadRuntimeBase.mockResolvedValue({ identity: '', settings: {}, behavior: '', jailbreak: '' })
    mockLoadWorkerTask.mockResolvedValue({ workerType: 'memory', taskPrompt: '' })
    mockCallAIWithLog.mockResolvedValue('```json\n' + JSON.stringify(emptyPayload) + '\n```')
  })

  it('injects N-1 entity list into prompt when previousSnapshot is provided', async () => {
    const prev: GraphSnapshot = {
      nodes: [
        { type: 'character', key: 'zhangsan', label: '张三', data: {} },
        { type: 'faction',   key: 'qingmeng',  label: '青盟', data: { note: 'rank:1' } }
      ],
      edges: [],
      timestamp: ''
    }
    const prisma = buildPrisma()
    const app: any = { prisma, log: { info: vi.fn(), error: vi.fn(), warn: vi.fn() } }

    await extractAll(app, 'c1', 's1', 'content', 'outline', 1, prev)

    const userMessage: string = mockCallAIWithLog.mock.calls[0][1].compiled.userMessage
    expect(userMessage).toContain('N-1 全局图谱中的实体清单')
    expect(userMessage).toContain('character:zhangsan (张三)')
    expect(userMessage).toContain('faction:qingmeng (青盟)')
  })

  it('omits N-1 inventory block when previousSnapshot is null', async () => {
    const prisma = buildPrisma()
    const app: any = { prisma, log: { info: vi.fn(), error: vi.fn(), warn: vi.fn() } }

    await extractAll(app, 'c1', 's1', 'content', 'outline', 1, null)

    const userMessage: string = mockCallAIWithLog.mock.calls[0][1].compiled.userMessage
    expect(userMessage).not.toContain('N-1 全局图谱中的实体清单')
  })

  it('caps N-1 inventory at 500 nodes (defensive: trims by importance desc)', async () => {
    // Interleaved: 400 high-importance (crit_*, importance=10) + 400 low-importance
    // (filler_*, importance=0), total 800.
    // - With correct descending sort by importance: all 400 crit_* (importance 10)
    //   survive into the 500 cap, plus 100 filler_* (importance 0) fill the rest
    //   → 400 crit + 100 filler.
    // - Without sort (interleaved order preserved): slice(0,500) gives
    //   crit_0..crit_249 + filler_0..filler_249 → 250 crit + 250 filler, so
    //   the crit_* count assertion (400) would FAIL.
    const nodes: GraphSnapshot['nodes'] = []
    for (let i = 0; i < 400; i++) {
      nodes.push({
        type: 'character' as const, key: `crit_${i}`, label: `C${i}`,
        data: { importance: 10 }
      })
      nodes.push({
        type: 'character' as const, key: `filler_${i}`, label: `F${i}`,
        data: { importance: 0 }
      })
    }
    const prev: GraphSnapshot = { nodes, edges: [], timestamp: '' }
    const prisma = buildPrisma()
    const app: any = { prisma, log: { info: vi.fn(), error: vi.fn(), warn: vi.fn() } }

    await extractAll(app, 'c1', 's1', 'content', 'outline', 1, prev)

    const userMessage: string = mockCallAIWithLog.mock.calls[0][1].compiled.userMessage
    // All 400 high-importance nodes must survive.
    expect((userMessage.match(/character:crit_\d+/g) || []).length).toBe(400)
    // Only 100 low-importance nodes survive (filling the remaining cap slots).
    expect((userMessage.match(/character:filler_\d+/g) || []).length).toBe(100)
    // Total is exactly the cap.
    expect((userMessage.match(/character:\w+_\d+/g) || []).length)
      .toBe(PREV_SNAPSHOT_INVENTORY_CAP)
  })
})
