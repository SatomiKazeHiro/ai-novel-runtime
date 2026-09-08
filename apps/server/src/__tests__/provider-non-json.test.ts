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

  it('throws empty-body diagnostic when 200 response body is empty string', async () => {
    // 上游返回 200 + 空字符串 body（典型 OpenRouter upstream bug / CDN 异常）。
    // 必须跟"非空 body 但不是 JSON" 区分开，否则用户看到 "Unexpected end of
    // JSON input. Body: \n         " 这种切片会困惑（明明是空白为什么还贴 body？）。
    // 新错误信息直接告诉用户是空 body + 建议 retry / 换模型。
    mockFetch(200, 'application/json', '')

    const provider = new OpenAICompatibleProvider({
      name: 'openrouter',
      apiKey: 'sk-test',
      model: 'deepseek/deepseek-v3.2'
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
    expect(caught!.message).toContain('empty response body')
    expect(caught!.message).toContain('status=200')
    expect(caught!.message).toContain('content-type=application/json')
    // 必须明确建议用户操作，不能只抛诊断信息
    expect(caught!.message).toMatch(/retry|different model|upstream/i)
    // 不应包含非空 body 错误的 "Body (first 500 chars):" 前缀
    expect(caught!.message).not.toContain('Body (first 500 chars):')
  })

  it('throws empty-body diagnostic when 200 response body is whitespace-only (OpenRouter upstream bug)', async () => {
    // 用户真实场景：openrouter/deepseek-v3.2 偶发返回 200 + 全空白 body
    // （仅含 \n 和空格）。这跟"body 完全为空" 在语义上一样（trim 后长度 0），
    // 都属于 upstream 返回了不可用响应。
    mockFetch(200, 'application/json', '\n         \n\n         \n\n         \n\n         ')

    const provider = new OpenAICompatibleProvider({
      name: 'openrouter',
      apiKey: 'sk-test',
      model: 'deepseek/deepseek-v3.2'
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
    expect(caught!.message).toContain('empty response body')
    // 应包含原始 body 长度，让用户知道"真的是空白不是误判"
    expect(caught!.message).toMatch(/bodyLength=\d+/)
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

  it('prefers content over reasoning_content when both are present', async () => {
    // reasoning_content 不再 fallback (4KB 阈值清理), content 优先; 但
    // reasoning_content 仍可能被上游填, extractContent 只读 content 字段,
    // 不应该被 reasoning_content 污染。
    mockFetch(200, 'application/json', JSON.stringify({
      choices: [{
        message: {
          content: '正常 content 输出',
          reasoning_content: '{"should":"not","be":"used"}'
        },
        finish_reason: 'stop'
      }]
    }))

    const provider = new OpenAICompatibleProvider({
      name: 'deepseek', apiKey: 'sk-test', model: 'deepseek-chat'
    })

    const content = await provider.generateWithRuntime(
      { systemMessage: 'sys', userMessage: 'usr', meta: { systemTokens: 1, userTokens: 1, totalTokens: 2 } },
      {}
    )
    expect(content).toBe('正常 content 输出')
  })

  it('throws empty content when content is empty even if reasoning_content has data (no fallback)', async () => {
    // 4KB 阈值清理后: reasoning_content 不再 fallback, content 为空就抛
    // "empty content" 错。thinking 三态配置已在请求端尽量阻止上游产生
    // reasoning_content; 这里不再做兜底, 让上层拿到明确错误 (而不是
    // 把"纯思考过程"误当作答案回退)。
    mockFetch(200, 'application/json', JSON.stringify({
      choices: [{
        message: {
          content: '',
          reasoning_content: '{"memories":[{"content":"测试记忆","originUid":"NEW","importance":5,"type":"event"}]}'
        },
        finish_reason: 'stop'
      }],
      model: 'deepseek-v4-flash'
    }))

    const provider = new OpenAICompatibleProvider({
      name: 'deepseek', apiKey: 'sk-test', model: 'deepseek-v4-flash'
    })

    await expect(provider.generateWithRuntime(
      { systemMessage: 'sys', userMessage: 'usr', meta: { systemTokens: 1, userTokens: 1, totalTokens: 2 } },
      {}
    )).rejects.toThrow(/empty content.*finish_reason=stop/)
  })

  it('still throws empty-content error when both content and reasoning_content are empty', async () => {
    // 回归测试: 两个字段都为空时, 仍然要抛诊断错误 (上游真正故障)。
    mockFetch(200, 'application/json', JSON.stringify({
      choices: [{
        message: { content: '', reasoning_content: '' },
        finish_reason: 'stop'
      }]
    }))

    const provider = new OpenAICompatibleProvider({
      name: 'deepseek', apiKey: 'sk-test', model: 'deepseek-v4-flash'
    })

    await expect(provider.generateWithRuntime(
      { systemMessage: 'sys', userMessage: 'usr', meta: { systemTokens: 1, userTokens: 1, totalTokens: 2 } },
      {}
    )).rejects.toThrow(/empty content.*finish_reason=stop/)
  })
})
