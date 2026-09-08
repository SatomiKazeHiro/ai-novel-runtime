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

  it('falls back to reasoning_content when content is empty (DeepSeek V4-Flash thinking mode)', async () => {
    // DeepSeek V4-Flash 等 reasoning 模型把 JSON 输出放进 reasoning_content
    // 字段, content 留空。provider 必须读 reasoning_content 兜底, 否则
    // chapters-archive memory-optimizer / memory-stage 会一直抛
    // "API returned empty content" 把 stage 标 failed, 章节永远无法归档。
    // 用户场景: 87be28a9 ch2 prepare-archive, memory-optimizer 触发该 bug。
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

    const content = await provider.generateWithRuntime(
      { systemMessage: 'sys', userMessage: 'usr', meta: { systemTokens: 1, userTokens: 1, totalTokens: 2 } },
      {}
    )
    expect(content).toBe('{"memories":[{"content":"测试记忆","originUid":"NEW","importance":5,"type":"event"}]}')
  })

  it('prefers content over reasoning_content when both are present', async () => {
    // 兜底逻辑必须优先用 content (普通模型), reasoning_content 只在 content
    // 为空时才用。不能反过来。
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

  it('still throws empty-content error when both content and reasoning_content are empty', async () => {
    // 回归测试: 两个字段都为空时, 仍然要抛诊断错误 (上游真正故障)。
    // 不能因为加了 fallback 就吞掉所有 empty-content 情况。
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

  it('does NOT fall back to reasoning_content when too long (likely thinking trace, not answer)', async () => {
    // DeepSeek V4-Flash thinking 模式常见: reasoning_content 写满 8KB+ 的
    // 思考过程散文, 末尾没有 JSON 答案 (maxTokens=4096 不够"思考+答案")。
    // 之前的兜底逻辑会整段回退 15KB 思考文本, 让 memory-optimizer 的
    // `JSON.parse(cleanJsonBlock(...))` 抛错, 错误诊断被污染 (看起来像
    // "AI 返回了非法 JSON", 实际是 "AI 没给答案, 给了一大段思考")。
    //
    // 修复后: reasoning_content 长度 > 4KB 视为 "纯思考过程", 直接抛
    // empty content 错, 错误信息明确告诉用户 "likely pure thinking trace"。
    const longThinkingTrace = 'I need to think carefully about this task. '.repeat(200) // ~9000 chars
    mockFetch(200, 'application/json', JSON.stringify({
      choices: [{
        message: { content: '', reasoning_content: longThinkingTrace },
        finish_reason: 'stop'
      }],
      model: 'deepseek-v4-flash'
    }))

    const provider = new OpenAICompatibleProvider({
      name: 'deepseek', apiKey: 'sk-test', model: 'deepseek-v4-flash'
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
    // 错误信息必须明确说 "reasoning_content too long" 让用户能区分
    // 真正的 empty content vs thinking 模式未给答案。
    expect(caught!.message).toMatch(/reasoning_content too long/)
    expect(caught!.message).toContain('likely pure thinking trace')
    // 错误应包含实际 reasoning 长度, 帮助用户判断是否触发了长度阈值
    expect(caught!.message).toMatch(/chars/)
  })

  it('falls back to short reasoning_content (< 4KB) as direct answer', async () => {
    // 短 reasoning_content (< 4KB) 仍按原行为兜底: 短小内容更可能是直接
    // 答案 (某些 reasoning 模型把简短答案放进 reasoning_content)。
    mockFetch(200, 'application/json', JSON.stringify({
      choices: [{
        message: {
          content: '',
          reasoning_content: '短思考: 答案 = "direct answer"'
        },
        finish_reason: 'stop'
      }],
      model: 'deepseek-v4-flash'
    }))

    const provider = new OpenAICompatibleProvider({
      name: 'deepseek', apiKey: 'sk-test', model: 'deepseek-v4-flash'
    })

    const content = await provider.generateWithRuntime(
      { systemMessage: 'sys', userMessage: 'usr', meta: { systemTokens: 1, userTokens: 1, totalTokens: 2 } },
      {}
    )
    expect(content).toBe('短思考: 答案 = "direct answer"')
  })
})
