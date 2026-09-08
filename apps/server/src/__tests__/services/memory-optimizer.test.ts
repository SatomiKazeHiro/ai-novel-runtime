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

import { optimizeMemories } from '../../services/memory-optimizer.js'
import { callAIWithLog } from '../../services/ai-call-logger.js'

const mockApp: any = (overrides: any = {}) => ({
  prisma: {
    memory: { findMany: vi.fn().mockResolvedValue([]) },
    character: { findMany: vi.fn().mockResolvedValue([]) },
    ...overrides
  },
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
})

const baseRaw = {
  mainEvents: [{ description: '事件', importance: 5 }],
  sideEvents: [],
  emotions: [],
  foreshadowing: [],
  relationshipChanges: [],
  scenes: [],
  summary: '摘要'
}

// 反馈规则 `feedback_no_silent_errors`:
// 当 callAIWithLog 返回 null 或空字符串时, optimizeMemories 不允许
// 静默 return []。必须抛错让 chapters-archive prepare-archive 端点的
// catch 把 memory stage 标记 failed, 用户能在 UI 上看到 "解析失败",
// 而不是以为归档通过了但实际 global 记忆缺失。

describe('optimizeMemories — empty AI response', () => {
  it('throws when callAIWithLog returns null', async () => {
    ;(callAIWithLog as any).mockResolvedValueOnce(null)

    await expect(
      optimizeMemories(mockApp(), 's1', 'c1', baseRaw)
    ).rejects.toThrow(/AI 返回空内容/)
  })

  it('throws when callAIWithLog returns empty string', async () => {
    ;(callAIWithLog as any).mockResolvedValueOnce('')

    await expect(
      optimizeMemories(mockApp(), 's1', 'c1', baseRaw)
    ).rejects.toThrow(/AI 返回空内容/)
  })

  it('returns memories normally when AI returns valid JSON', async () => {
    const ai = {
      memories: [
        { content: '记忆 A', originUid: 'NEW', importance: 5, type: 'event' }
      ]
    }
    ;(callAIWithLog as any).mockResolvedValueOnce(JSON.stringify(ai))

    const result = await optimizeMemories(mockApp(), 's1', 'c1', baseRaw)
    expect(result).toHaveLength(1)
    expect(result[0].content).toBe('记忆 A')
    // 注意: optimizeMemories 不替换 NEW, 那是 prepare-archive 路径的职责
  })

  it('keeps NEW originUid as-is (prepare-archive path replaces later)', async () => {
    const ai = {
      memories: [
        { content: '记忆 B', originUid: 'NEW', importance: 4, type: 'state' }
      ]
    }
    ;(callAIWithLog as any).mockResolvedValueOnce(JSON.stringify(ai))

    const result = await optimizeMemories(mockApp(), 's1', 'c1', baseRaw)
    expect(result[0].originUid).toBe('NEW')
  })

  it('returns [] early when no raw memories and no existing global', async () => {
    // 没有 raw 且没有 global 时, 正常路径直接 return [] (没有 AI 调用)
    vi.mocked(callAIWithLog).mockClear()
    const emptyRaw = {
      mainEvents: [], sideEvents: [], emotions: [], foreshadowing: [],
      relationshipChanges: [], scenes: [], summary: ''
    }
    const result = await optimizeMemories(mockApp(), 's1', 'c1', emptyRaw)
    expect(result).toEqual([])
    // 不应该调 callAIWithLog
    expect(callAIWithLog).not.toHaveBeenCalled()
  })
})