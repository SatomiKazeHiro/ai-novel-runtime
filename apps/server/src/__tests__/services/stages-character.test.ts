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

import { runCharacterStage } from '../../services/stages/character-stage.js'
import { callAIWithLog } from '../../services/ai-call-logger.js'

const mockApp: any = { prisma: {}, log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }

describe('character-stage', () => {
  it('returns success with parsed result on valid AI response', async () => {
    const result = {
      characterStates: [
        { characterId: 'c1', name: '张三', key: 'zhangsan', status: '{}', relationships: '{}', isNew: false }
      ]
    }
    ;(callAIWithLog as any).mockResolvedValueOnce(JSON.stringify(result))

    const state = await runCharacterStage(mockApp, {
      storyId: 's1',
      chapterId: 'c1',
      content: '张三...',
      outline: 'outline',
      chapterNumber: 1,
      matchedCharacters: [{ id: 'c1', name: '张三', key: 'zhangsan', label: '张三', importance: 8 }]
    })

    expect(state.status).toBe('success')
    expect(state.result?.characterStates).toHaveLength(1)
    expect(state.errorMessage).toBeUndefined()
  })

  it('returns success with empty result when AI returns empty object', async () => {
    ;(callAIWithLog as any).mockResolvedValueOnce('{}')

    const state = await runCharacterStage(mockApp, {
      storyId: 's1', chapterId: 'c1', content: 'x', outline: '', chapterNumber: 1,
      matchedCharacters: []
    })

    expect(state.status).toBe('success')
    expect(state.result?.characterStates ?? []).toEqual([])
  })

  it('returns failed status when AI parse fails twice', async () => {
    ;(callAIWithLog as any).mockResolvedValueOnce('not-json')
    ;(callAIWithLog as any).mockResolvedValueOnce('still-not-json')

    const state = await runCharacterStage(mockApp, {
      storyId: 's1', chapterId: 'c1', content: 'x', outline: '', chapterNumber: 1,
      matchedCharacters: []
    })

    expect(state.status).toBe('failed')
    expect(state.errorMessage).toContain('重试')
  })

  it('retries once and returns success on second valid response', async () => {
    ;(callAIWithLog as any).mockResolvedValueOnce('not-json')
    ;(callAIWithLog as any).mockResolvedValueOnce(JSON.stringify({ characterStates: [] }))

    const state = await runCharacterStage(mockApp, {
      storyId: 's1', chapterId: 'c1', content: 'x', outline: '', chapterNumber: 1,
      matchedCharacters: []
    })

    expect(state.status).toBe('success')
    expect(callAIWithLog).toHaveBeenCalledTimes(2)
  })

  it('returns failed when AI returns null', async () => {
    ;(callAIWithLog as any).mockResolvedValueOnce(null)

    const state = await runCharacterStage(mockApp, {
      storyId: 's1', chapterId: 'c1', content: 'x', outline: '', chapterNumber: 1,
      matchedCharacters: []
    })

    expect(state.status).toBe('failed')
  })
})
