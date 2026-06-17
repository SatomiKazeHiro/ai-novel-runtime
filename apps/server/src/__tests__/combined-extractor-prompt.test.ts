import { describe, it, expect, vi, beforeEach } from 'vitest'

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

describe('extractAll — node quality & edge importance (L2 prompt constraints)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockLoadRuntimeBase.mockResolvedValue({ identity: '', settings: {}, behavior: '', jailbreak: '' })
    mockLoadWorkerTask.mockResolvedValue({ workerType: 'memory', taskPrompt: '' })
    mockCallAIWithLog.mockResolvedValue('```json\n' + JSON.stringify(emptyPayload) + '\n```')
  })

  it('prompt includes node quality constraint block', async () => {
    const prisma = buildPrisma()
    const app: any = { prisma, log: { info: vi.fn(), error: vi.fn(), warn: vi.fn() } }
    await extractAll(app, 'c1', 's1', 'content', 'outline', 1)
    const userMessage: string = mockCallAIWithLog.mock.calls[0][1].compiled.userMessage
    expect(userMessage).toContain('节点质量约束')
    expect(userMessage).toContain('路人甲乙丙')  // anti-example mentioned in spec
  })

  it('edge schema in prompt mentions importance field', async () => {
    const prisma = buildPrisma()
    const app: any = { prisma, log: { info: vi.fn(), error: vi.fn(), warn: vi.fn() } }
    await extractAll(app, 'c1', 's1', 'content', 'outline', 1)
    const userMessage: string = mockCallAIWithLog.mock.calls[0][1].compiled.userMessage
    expect(userMessage).toMatch(/edges.*importance.*1-10/)
  })
})
