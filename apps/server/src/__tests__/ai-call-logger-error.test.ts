import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock the provider-resolver so we can inject a controlled provider
// without touching the real aiProviderConfig chain.
const mockResolveProvider = vi.fn()
vi.mock('../services/ai-provider-init.js', () => ({
  resolveProvider: (...args: any[]) => mockResolveProvider(...args)
}))

import { callAIWithLog } from '../services/ai-call-logger.js'

const COMPILER = {
  systemMessage: 'sys',
  userMessage: 'usr',
  meta: { systemTokens: 1, userTokens: 1, totalTokens: 2 }
}

function buildApp(prismaOverrides: any = {}) {
  const promptLogCreate = vi.fn().mockResolvedValue({})
  const app: any = {
    prisma: {
      promptLog: { create: promptLogCreate },
      ...prismaOverrides
    },
    log: { info: vi.fn(), error: vi.fn(), warn: vi.fn() }
  }
  return { app, promptLogCreate }
}

describe('callAIWithLog — error path preserves diagnostics in PromptLog', () => {
  // 用户场景：DeepSeek 偶尔返回 200 OK + 空 body（CDN/proxy 截断），
  // provider.response.json() 抛 "Unexpected end of JSON input"。修复
  // 前 PromptLog.responseContent='' + errorMessage=err.message，用户
  // 必须去翻 server.log 才能看到原始错误。修复后 PromptLog 自带错误细节。

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('writes err.message into responseContent (not empty string) when provider throws', async () => {
    const errorMessage = 'deepseek API returned non-JSON response (status=200, content-type=text/html): Unexpected end of JSON input. Body (first 200 chars): <html>cloudflare error</html>'
    const mockProvider = {
      generateWithRuntime: vi.fn().mockRejectedValue(new Error(errorMessage)),
      lastUsage: null
    }
    mockResolveProvider.mockResolvedValue({
      provider: mockProvider,
      config: { id: 'ai1', name: 'deepseek', model: 'deepseek-chat', temperature: 0.7, maxTokens: 4096 }
    })

    const { app, promptLogCreate } = buildApp()
    await expect(callAIWithLog(app, {
      storyId: 's1',
      chapterId: 'c1',
      callType: 'graph_organize',
      compiled: COMPILER,
      temperature: 0.2,
      maxTokens: 8192
    })).rejects.toThrow(errorMessage)

    expect(promptLogCreate).toHaveBeenCalledTimes(1)
    const data = promptLogCreate.mock.calls[0][0].data
    expect(data.status).toBe('error')
    // 关键修复点：错误路径下 responseContent 必须包含 err.message，
    // 不是空串。否则用户在 Prisma Studio 看 PromptLog 看不到任何细节。
    expect(data.responseContent).not.toBe('')
    expect(data.responseContent).toContain('Unexpected end of JSON input')
    expect(data.responseContent).toContain('[PROVIDER ERROR]')
    expect(data.errorMessage).toBe(errorMessage)
  })

  it('truncates very long error messages to keep responseContent bounded', async () => {
    // provider 可能抛出包含大量 body 切片的错误（最多几千字符）。
    // responseContent 是 String 字段没长度限制，但太大会影响 PromptLog
    // 列表渲染。截断到 2000 字符是合理上限。
    const longBody = 'X'.repeat(5000)
    const errorMessage = `provider error body: ${longBody}`
    const mockProvider = {
      generateWithRuntime: vi.fn().mockRejectedValue(new Error(errorMessage)),
      lastUsage: null
    }
    mockResolveProvider.mockResolvedValue({
      provider: mockProvider,
      config: { id: 'ai1', name: 'deepseek', model: 'deepseek-chat', temperature: 0.7, maxTokens: 4096 }
    })

    const { app, promptLogCreate } = buildApp()
    await expect(callAIWithLog(app, {
      storyId: 's1',
      callType: 'combined_extract',
      compiled: COMPILER
    })).rejects.toThrow()

    const data = promptLogCreate.mock.calls[0][0].data
    expect(data.responseContent.length).toBeLessThanOrEqual(2100) // 2000 + '[PROVIDER ERROR] ' prefix
  })

  it('still sets status=error and errorMessage fields correctly (regression)', async () => {
    // 回归测试：错误路径的其他字段（status, errorMessage, promptTokens=0 等）
    // 必须保持不变，不能因为 responseContent 改动被破坏。
    const errorMessage = 'deepseek API returned non-JSON response: bad JSON'
    const mockProvider = {
      generateWithRuntime: vi.fn().mockRejectedValue(new Error(errorMessage)),
      lastUsage: null
    }
    mockResolveProvider.mockResolvedValue({
      provider: mockProvider,
      config: { id: 'ai1', name: 'deepseek', model: 'deepseek-chat', temperature: 0.7, maxTokens: 4096 }
    })

    const { app, promptLogCreate } = buildApp()
    await expect(callAIWithLog(app, {
      storyId: 's1',
      callType: 'memory_extract',
      compiled: COMPILER
    })).rejects.toThrow()

    const data = promptLogCreate.mock.calls[0][0].data
    expect(data.status).toBe('error')
    expect(data.errorMessage).toBe(errorMessage)
    expect(data.promptTokens).toBe(0)
    expect(data.completionTokens).toBe(0)
    expect(data.totalTokens).toBe(0)
    expect(data.callType).toBe('memory_extract')
  })

  it('on success path, responseContent is the AI response (regression)', async () => {
    // 回归测试：成功路径 responseContent 必须是 AI 返回的 content，
    // 不能被错误路径的 [PROVIDER ERROR] 前缀逻辑污染。
    const mockProvider = {
      generateWithRuntime: vi.fn().mockResolvedValue('{"answer":42}'),
      lastUsage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 }
    }
    mockResolveProvider.mockResolvedValue({
      provider: mockProvider,
      config: { id: 'ai1', name: 'deepseek', model: 'deepseek-chat', temperature: 0.7, maxTokens: 4096 }
    })

    const { app, promptLogCreate } = buildApp()
    const result = await callAIWithLog(app, {
      storyId: 's1',
      callType: 'graph_extract',
      compiled: COMPILER
    })

    expect(result).toBe('{"answer":42}')
    const data = promptLogCreate.mock.calls[0][0].data
    expect(data.status).toBe('success')
    expect(data.responseContent).toBe('{"answer":42}')
    expect(data.responseContent).not.toContain('[PROVIDER ERROR]')
  })
})
