import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockCallAIWithLog = vi.fn()
const mockLoadRuntimeBase = vi.fn()
const mockLoadWorkerTask = vi.fn()

vi.mock('../../services/ai-call-logger.js', () => ({
  callAIWithLog: (...args: any[]) => mockCallAIWithLog(...args)
}))
vi.mock('../../services/runtime-loader.js', () => ({
  loadRuntimeBase: (...args: any[]) => mockLoadRuntimeBase(...args),
  loadWorkerTask: (...args: any[]) => mockLoadWorkerTask(...args)
}))

import { runPlotArcStage } from '../../services/stages/plot-arc-stage.js'
import type { ExistingArcView } from '../../services/plot-consolidator.js'

function buildExistingArc(name: string): ExistingArcView {
  return {
    id: `arc-${name}`,
    name,
    type: 'main',
    status: 'active',
    progress: 40,
    currentStage: 'old',
    nextGoal: 'og',
    unresolved: '[]',
    summary: 'old sum',
    stages: '[]',
    createdAt: new Date(),
    updatedAt: new Date(),
    closedReason: null,
    closedTargetArcId: null
  }
}

function buildApp() {
  return { prisma: {}, log: { info: vi.fn(), error: vi.fn(), warn: vi.fn() } } as any
}

describe('plot-arc-stage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockLoadRuntimeBase.mockResolvedValue({ identity: '', settings: {}, behavior: '' })
    mockLoadWorkerTask.mockResolvedValue({ workerType: 'memory', taskPrompt: '' })
  })

  it('returns success with consolidated plot arcs', async () => {
    mockCallAIWithLog.mockResolvedValue(JSON.stringify({
      updates: [
        { existingId: 'arc-主线', progress: 60, currentStage: 's', nextGoal: 'g', unresolved: ['u'], summary: 'sum' }
      ],
      newArcs: []
    }))

    const state = await runPlotArcStage(buildApp(), {
      storyId: 's1', chapterId: 'c1', content: 'x', outline: '', chapterNumber: 1,
      existingArcs: [buildExistingArc('主线')],
      characterNames: ['张三'],
      latestBranchStates: []
    })

    expect(state.status).toBe('success')
    expect(state.result?.plotArcs).toBeDefined()
    expect(state.result!.plotArcs.length).toBeGreaterThan(0)
  })

  it('falls back to carry-forward when AI parsing fails twice', async () => {
    mockCallAIWithLog.mockResolvedValueOnce('not-json')
    mockCallAIWithLog.mockResolvedValueOnce('still-not-json')

    const state = await runPlotArcStage(buildApp(), {
      storyId: 's1', chapterId: 'c1', content: 'x', outline: '', chapterNumber: 1,
      existingArcs: [buildExistingArc('主线')],
      characterNames: [], latestBranchStates: []
    })

    // consolidatePlotArcs 内部有 carry-forward 兜底，AI 失败两次仍返回 success
    expect(state.status).toBe('success')
    expect(state.result?.plotArcs).toBeDefined()
    expect(state.result!.plotArcs.length).toBeGreaterThan(0)
  })
})
