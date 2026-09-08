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

import { runGraphExtractStage } from '../../services/stages/graph-extract-stage.js'
import { callAIWithLog } from '../../services/ai-call-logger.js'

const mockApp: any = { prisma: {}, log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }

describe('graph-extract-stage', () => {
  it('returns success with parsed chapterGraph', async () => {
    const ai = {
      nodes: [{ type: 'character', key: 'zhangsan', label: '张三', importance: 8 }],
      edges: []
    }
    ;(callAIWithLog as any).mockResolvedValueOnce(JSON.stringify(ai))

    const state = await runGraphExtractStage(mockApp, {
      storyId: 's1', chapterId: 'c1', content: 'x', outline: '', chapterNumber: 1,
      characterNames: ['张三'],
      prevCumulativeGraphKeys: [],
      latestBranchStates: []
    })

    expect(state.status).toBe('success')
    expect(state.result?.chapterGraph.nodes).toHaveLength(1)
  })

  it('returns failed on persistent parse error', async () => {
    ;(callAIWithLog as any).mockResolvedValueOnce('not-json')
    ;(callAIWithLog as any).mockResolvedValueOnce('still-bad')

    const state = await runGraphExtractStage(mockApp, {
      storyId: 's1', chapterId: 'c1', content: 'x', outline: '', chapterNumber: 1,
      characterNames: [], prevCumulativeGraphKeys: [], latestBranchStates: []
    })

    expect(state.status).toBe('failed')
  })

  it('returns empty chapterGraph on empty AI response', async () => {
    ;(callAIWithLog as any).mockResolvedValueOnce('{}')

    const state = await runGraphExtractStage(mockApp, {
      storyId: 's1', chapterId: 'c1', content: 'x', outline: '', chapterNumber: 1,
      characterNames: [], prevCumulativeGraphKeys: [], latestBranchStates: []
    })

    expect(state.status).toBe('success')
    expect(state.result?.chapterGraph.nodes).toEqual([])
  })
})
