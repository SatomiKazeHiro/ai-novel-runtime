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

import { extractAll } from '../services/combined-extractor.js'

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
    const nodes = Array.from({ length: 800 }, (_, i) => ({
      type: 'character' as const,
      key: `k${i}`,
      label: `L${i}`,
      data: { importance: i % 10 } // higher i = higher importance
    }))
    const prev: GraphSnapshot = { nodes, edges: [], timestamp: '' }
    const prisma = buildPrisma()
    const app: any = { prisma, log: { info: vi.fn(), error: vi.fn(), warn: vi.fn() } }

    await extractAll(app, 'c1', 's1', 'content', 'outline', 1, prev)

    const userMessage: string = mockCallAIWithLog.mock.calls[0][1].compiled.userMessage
    // 800 → 500; the 300 lowest-importance nodes (k0..k299 with importance 0..9) are dropped.
    // The 500 highest-importance (k300..k799) survive.
    const occurrences = (userMessage.match(/character:k\d+/g) || []).length
    expect(occurrences).toBe(500)
  })
})
