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
    isMainline: true,
    status: 'active',
    firstChapterNumber: 1,
    closedBy: null,
    closedTargetArcId: null
  }
}

function buildApp() {
  return { prisma: {}, log: { info: vi.fn(), error: vi.fn(), warn: vi.fn() } } as any
}

describe('plot-arc-stage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockLoadRuntimeBase.mockResolvedValue({ identity: '', settings: {}, behavior: '', jailbreak: '' })
    mockLoadWorkerTask.mockResolvedValue({ workerType: 'memory', taskPrompt: '' })
  })

  it('returns success with consolidated plot arcs', async () => {
    mockCallAIWithLog.mockResolvedValue(JSON.stringify({
      arcUpdates: [{ arcId: 'arc-主线', content: '推进', isEnd: false }],
      newArcs: [],
      closes: []
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

  it('AI 失败 → stage failed（不再 carry-forward）', async () => {
    mockCallAIWithLog.mockRejectedValue(new Error('AI down'))

    const state = await runPlotArcStage(buildApp(), {
      storyId: 's1', chapterId: 'c1', content: 'x', outline: '', chapterNumber: 1,
      existingArcs: [buildExistingArc('主线')],
      characterNames: [], latestBranchStates: []
    })

    expect(state.status).toBe('failed')
    expect(state.errorMessage).toContain('AI down')
  })
})
