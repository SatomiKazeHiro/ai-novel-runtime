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
    workerType: 'memory',
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

import { runMemoryStage } from '../../services/stages/memory-stage.js'
import { callAIWithLog } from '../../services/ai-call-logger.js'

const mockApp: any = { prisma: {}, log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }

describe('memory-stage', () => {
  it('returns success with parsed memory result', async () => {
    const ai = {
      mainEvents: [{ description: 'd', participants: ['p'], importance: 7 }],
      sideEvents: [],
      emotions: ['紧张'],
      foreshadowing: ['伏笔1'],
      relationshipChanges: ['关系变化1'],
      scenes: [{ location: 'l', event: 'e', importance: 6 }],
      timelinePosition: 1.00106,
      summary: '本章摘要',
      timelineEvents: []
    }
    ;(callAIWithLog as any).mockResolvedValueOnce(JSON.stringify(ai))

    const state = await runMemoryStage(mockApp, {
      storyId: 's1', chapterId: 'c1', content: 'x', outline: '', chapterNumber: 1,
      characterNames: ['张三'],
      characterKeys: ['zhangsan']
    })

    expect(state.status).toBe('success')
    expect(state.result?.mainEvents).toHaveLength(1)
    expect(state.result?.scenes).toHaveLength(1)
    expect(state.result?.timelinePosition).toBe(1.00106)
  })

  it('returns success with empty result', async () => {
    ;(callAIWithLog as any).mockResolvedValueOnce('{}')

    const state = await runMemoryStage(mockApp, {
      storyId: 's1', chapterId: 'c1', content: 'x', outline: '', chapterNumber: 1,
      characterNames: [], characterKeys: []
    })

    expect(state.status).toBe('success')
    expect(state.result?.mainEvents ?? []).toEqual([])
  })

  it('returns failed on persistent parse error', async () => {
    ;(callAIWithLog as any).mockResolvedValueOnce('bad')
    ;(callAIWithLog as any).mockResolvedValueOnce('bad2')

    const state = await runMemoryStage(mockApp, {
      storyId: 's1', chapterId: 'c1', content: 'x', outline: '', chapterNumber: 1,
      characterNames: [], characterKeys: []
    })

    expect(state.status).toBe('failed')
  })
})
