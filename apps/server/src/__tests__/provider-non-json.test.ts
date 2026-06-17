import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { OpenAICompatibleProvider } from '@novel-runtime/ai-provider'

// Provider 错误信息测试：fetch 返回 200 OK 但 body 不是合法 JSON 时
// （CDN 截断 / 空 body / HTML 错误页），response.json() 会抛
// "Unexpected end of JSON input" 这类原始错。修复后 provider 应该
// throw 包含 status + content-type + body 切片的诊断错误，让用户在
// PromptLog / server.log 能立刻区分是 DeepSeek 端问题还是网络/CDN 问题。

describe('OpenAICompatibleProvider — non-JSON response diagnostics', () => {
  let originalFetch: typeof fetch

  beforeEach(() => {
    originalFetch = globalThis.fetch
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
    vi.restoreAllMocks()
  })

  function mockFetch(status: number, contentType: string | null, body: string) {
    globalThis.fetch = vi.fn(async () => new Response(body, {
      status,
      headers: contentType ? { 'content-type': contentType } : {}
    })) as any
  }

  it('throws diagnostic error when 200 response body is empty (DeepSeek CDN truncation)', async () => {
    mockFetch(200, 'application/json', '')

    const provider = new OpenAICompatibleProvider({
      name: 'deepseek',
      apiKey: 'sk-test',
      model: 'deepseek-chat',
      maxTokens: 4096
    })

    await expect(provider.generateWithRuntime(
      { systemMessage: 'sys', userMessage: 'usr', meta: { systemTokens: 1, userTokens: 1, totalTokens: 2 } },
      {}
    )).rejects.toThrow(/status=200.*content-type.*Unexpected end of JSON input.*Body/)
  })

  it('throws diagnostic error when 200 response body is HTML (Cloudflare error page)', async () => {
    mockFetch(200, 'text/html', '<html>cloudflare error</html>')

    const provider = new OpenAICompatibleProvider({
      name: 'deepseek',
      apiKey: 'sk-test',
      model: 'deepseek-chat'
    })

    let caught: Error | null = null
    try {
      await provider.generateWithRuntime(
        { systemMessage: 'sys', userMessage: 'usr', meta: { systemTokens: 1, userTokens: 1, totalTokens: 2 } },
        {}
      )
    } catch (err: any) {
      caught = err
    }

    expect(caught).not.toBeNull()
    // 错误 message 必须包含 status、content-type、原始错误、body 切片
    expect(caught!.message).toContain('status=200')
    expect(caught!.message).toContain('content-type=text/html')
    expect(caught!.message).toContain('Unexpected token')
    expect(caught!.message).toContain('<html>cloudflare')
  })

  it('throws diagnostic error when 200 response body is malformed JSON', async () => {
    mockFetch(200, 'application/json', '{"choices":[{"message":{"content":')

    const provider = new OpenAICompatibleProvider({
      name: 'deepseek',
      apiKey: 'sk-test',
      model: 'deepseek-chat'
    })

    await expect(provider.generateWithRuntime(
      { systemMessage: 'sys', userMessage: 'usr', meta: { systemTokens: 1, userTokens: 1, totalTokens: 2 } },
      {}
    )).rejects.toThrow(/non-JSON response.*status=200.*Body.*\{/)
  })

  it('truncates body slice to keep error message bounded', async () => {
    // 避免超大响应 body 把错误 message 撑爆。截断到 500 字符是合理上限。
    const hugeBody = 'X'.repeat(2000)
    mockFetch(200, 'text/plain', hugeBody)

    const provider = new OpenAICompatibleProvider({
      name: 'deepseek',
      apiKey: 'sk-test',
      model: 'deepseek-chat'
    })

    let caught: Error | null = null
    try {
      await provider.generateWithRuntime(
        { systemMessage: 'sys', userMessage: 'usr', meta: { systemTokens: 1, userTokens: 1, totalTokens: 2 } },
        {}
      )
    } catch (err: any) {
      caught = err
    }

    expect(caught).not.toBeNull()
    // 错误 message 中 body 切片不应超过 ~500 字符（加 "Body (first N chars): " 前缀和
    // "non-JSON response..." 总长也不应过大）
    expect(caught!.message.length).toBeLessThan(2000)
    expect(caught!.message).toContain('Body (first 500 chars)')
  })

  it('preserves existing happy path — valid JSON response still works', async () => {
    // 回归测试：修复不能破坏正常 JSON 响应的处理。
    mockFetch(200, 'application/json', JSON.stringify({
      choices: [{ message: { content: 'AI response here' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 }
    }))

    const provider = new OpenAICompatibleProvider({
      name: 'deepseek',
      apiKey: 'sk-test',
      model: 'deepseek-chat'
    })

    const content = await provider.generateWithRuntime(
      { systemMessage: 'sys', userMessage: 'usr', meta: { systemTokens: 1, userTokens: 1, totalTokens: 2 } },
      {}
    )
    expect(content).toBe('AI response here')
  })

  it('preserves existing non-200 path — errorText still in error message', async () => {
    // 回归测试：5xx 响应的现有错误格式（带 status 和 errorText）不能被破坏。
    mockFetch(503, 'text/plain', 'Service Unavailable')

    const provider = new OpenAICompatibleProvider({
      name: 'deepseek',
      apiKey: 'sk-test',
      model: 'deepseek-chat'
    })

    await expect(provider.generateWithRuntime(
      { systemMessage: 'sys', userMessage: 'usr', meta: { systemTokens: 1, userTokens: 1, totalTokens: 2 } },
      {}
    )).rejects.toThrow(/deepseek API error \(503\): Service Unavailable/)
  })
})
