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
  it('returns success with parsed memory result (memory-only output shape)', async () => {
    // v3 memory-only mode: AI 返回 { memories: {...} }, 不带 characterStatusChanges / timeline
    const ai = {
      memories: {
        mainEvents: [{ description: 'd', importance: 7 }],
        sideEvents: [],
        emotions: ['紧张'],
        foreshadowing: ['伏笔1'],
        relationshipChanges: ['关系变化1'],
        scenes: [{ location: 'l', event: 'e', importance: 6 }],
        summary: '本章摘要'
      }
    }
    ;(callAIWithLog as any).mockResolvedValueOnce(JSON.stringify(ai))

    const state = await runMemoryStage(mockApp, {
      storyId: 's1', chapterId: 'c1', content: 'x', outline: '', chapterNumber: 1,
      protagonistNames: ['张三'],
      characterNames: ['张三'],
      existingNodeKeys: ['character:zhangsan'],
      previousSnapshotNodes: []
    })

    expect(state.status).toBe('success')
    expect(state.result?.mainEvents).toHaveLength(1)
    expect(state.result?.scenes).toHaveLength(1)
    expect(state.result?.summary).toBe('本章摘要')
  })

  it('returns success with empty result', async () => {
    ;(callAIWithLog as any).mockResolvedValueOnce('{}')

    const state = await runMemoryStage(mockApp, {
      storyId: 's1', chapterId: 'c1', content: 'x', outline: '', chapterNumber: 1,
      protagonistNames: [], characterNames: [],
      existingNodeKeys: [], previousSnapshotNodes: []
    })

    expect(state.status).toBe('success')
    expect(state.result?.mainEvents ?? []).toEqual([])
    expect(state.result?.summary).toBe('')
  })

  it('returns failed on persistent parse error', async () => {
    ;(callAIWithLog as any).mockResolvedValueOnce('bad')
    ;(callAIWithLog as any).mockResolvedValueOnce('bad2')

    const state = await runMemoryStage(mockApp, {
      storyId: 's1', chapterId: 'c1', content: 'x', outline: '', chapterNumber: 1,
      protagonistNames: [], characterNames: [],
      existingNodeKeys: [], previousSnapshotNodes: []
    })

    expect(state.status).toBe('failed')
  })

  it('ignores timeline / characterStatusChanges fields if AI leaks them (defensive)', async () => {
    // 即使 AI 在 memory-only 模式下意外输出这些字段, stage 只消费 v3 范围字段
    const ai = {
      memories: {
        mainEvents: [], sideEvents: [], emotions: [], foreshadowing: [], relationshipChanges: [],
        scenes: [],
        characterStatusChanges: { 张三: { rank: '初级' } },
        timelinePosition: 1.00106,
        timelineEvents: [{ position: 1.00106, description: 'x' }],
        summary: 't'
      }
    }
    ;(callAIWithLog as any).mockResolvedValueOnce(JSON.stringify(ai))

    const state = await runMemoryStage(mockApp, {
      storyId: 's1', chapterId: 'c1', content: 'x', outline: '', chapterNumber: 1,
      protagonistNames: [], characterNames: [],
      existingNodeKeys: [], previousSnapshotNodes: []
    })

    expect(state.status).toBe('success')
    // result 不应暴露被 v3 删除的字段
    const result: any = state.result
    expect(result?.characterStatusChanges).toBeUndefined()
    expect(result?.timelinePosition).toBeUndefined()
    expect(result?.timelineEvents).toBeUndefined()
  })
})
