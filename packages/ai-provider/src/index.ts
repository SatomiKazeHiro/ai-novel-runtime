import { CompiledPrompt } from './runtime-compiler.js'

export { CompiledPrompt, RuntimePromptCompiler, SharedRuntimeBase, WorkerTask, estimateTokens } from './runtime-compiler.js'

export interface TokenUsage {
  promptTokens: number
  completionTokens: number
  totalTokens: number
}

export interface AIProvider {
  generate(prompt: string, options?: any): Promise<string>
  generateWithRuntime?(compiled: CompiledPrompt, options?: any): Promise<string>
  streamGenerate(prompt: string, options?: any): AsyncIterable<string>
  embedding?(text: string): Promise<number[]>
  testConnection(): Promise<{ success: boolean; message: string }>
  readonly lastUsage?: TokenUsage | null
}

export interface AIProviderConfig {
  name: string
  apiKey?: string
  baseUrl?: string
  model: string
  maxTokens?: number
  temperature?: number
}

const DEFAULT_BASE_URLS: Record<string, string> = {
  deepseek: 'https://api.deepseek.com',
  openai: 'https://api.openai.com',
  openrouter: 'https://openrouter.ai/api',
  moonshot: 'https://api.moonshot.cn',
  siliconflow: 'https://api.siliconflow.cn'
}

// 支持 OpenAI 兼容格式的 Provider 白名单
const OPENAI_COMPATIBLE_PROVIDERS = [
  'deepseek',
  'openai',
  'openrouter',
  'moonshot',
  'siliconflow'
]

export class OpenAICompatibleProvider implements AIProvider {
  private config: AIProviderConfig
  lastUsage: TokenUsage | null = null

  constructor(config: AIProviderConfig) {
    this.config = config
  }

  private getBaseUrl(): string {
    const customUrl = this.config.baseUrl?.replace(/\/$/, '')
    if (customUrl) return customUrl
    const defaultUrl = DEFAULT_BASE_URLS[this.config.name]
    if (defaultUrl) return defaultUrl
    throw new Error(`Unknown provider "${this.config.name}": no default baseUrl and none provided`)
  }

  private getAuthHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${this.config.apiKey}`
    }
    // OpenRouter 建议的额外 headers（可选）
    if (this.config.name === 'openrouter') {
      headers['HTTP-Referer'] = 'https://ai-novel-runtime.local'
      headers['X-Title'] = 'AI Novel Runtime'
    }
    return headers
  }

  private async callCompletions(body: any): Promise<any> {
    const apiKey = this.config.apiKey
    const baseUrl = this.getBaseUrl()

    if (!apiKey) {
      throw new Error(`${this.config.name} API key is not configured`)
    }

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 30000)

    let response: Response
    try {
      response = await fetch(`${baseUrl}/v1/chat/completions`, {
        method: 'POST',
        signal: controller.signal,
        headers: this.getAuthHeaders(),
        body: JSON.stringify(body)
      })
    } finally {
      clearTimeout(timeout)
    }

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`${this.config.name} API error (${response.status}): ${errorText}`)
    }

    // DeepSeek / 各类 OpenAI 兼容服务偶尔会返回 200 OK 但 body 不是合法
    // JSON（CDN 截断、HTML 错误页、流式响应设置错误等）。response.json()
    // 默认抛 "Unexpected end of JSON input" 这类原始错，没带 status/body
    // 信息，排查困难。这里 catch 并抛出包含 status + content-type + body
    // 切片的诊断错误，让用户能立刻区分是上游服务问题还是网络/CDN 问题。
    //
    // 还要单独区分"上游返回了空 body"（OpenRouter 偶发的 upstream bug：
    // 200 + 全空白 body，duration 正常但内容空）和"上游返回了非 JSON 但
    // 非空 body"（CDN 截断 / HTML 错误页）。前者根因在 upstream，需要
    // retry 或换模型；后者根因在 CDN/proxy，需要看错误页内容。
    //
    // 先用 clone().text() 把 body 拷一份备用 —— 因为 response.json() 失败
    // 后原 response 的 body 可能处于 locked 状态，clone().text() 才会拿到内容。
    let rawBody = ''
    try {
      rawBody = await response.clone().text()
    } catch {
      rawBody = ''
    }
    let data: any
    try {
      data = JSON.parse(rawBody)
    } catch (jsonErr: any) {
      const contentType = response.headers.get('content-type') || 'unknown'
      // 情况 A：上游返回 200 但 body 全是空白（trim 后长度 0）。
      // 典型 OpenRouter upstream bug / CDN 异常 / 模型 timeout。
      // 错误信息必须明确告诉用户"是空 body，不是我们解析失败"，
      // 并给出可执行建议（retry / 换模型 / 查 upstream 状态页）。
      if (rawBody.trim().length === 0) {
        throw new Error(
          `${this.config.name} API returned empty response body (status=${response.status}, content-type=${contentType}, bodyLength=${rawBody.length}). ` +
          `This usually indicates an upstream service bug (OpenRouter routing / CDN issue / model timeout). ` +
          `Try: 1) retry the request, 2) use a different model, 3) check upstream status page.`
        )
      }
      // 情况 B：非空 body 但不是合法 JSON（CDN 截断 / HTML 错误页 / SSE 误用）。
      // 保留 body 切片方便用户识别具体错误页内容。
      const bodySlice = rawBody.slice(0, 500)
      throw new Error(
        `${this.config.name} API returned non-JSON response (status=${response.status}, content-type=${contentType}): ${jsonErr.message}. Body (first 500 chars): ${bodySlice}`
      )
    }

    // 某些平台（如 OpenRouter）可能在 HTTP 200 的响应体里返回 error 对象
    if (data.error) {
      const errMsg = typeof data.error === 'string' ? data.error : (data.error.message || JSON.stringify(data.error))
      throw new Error(`${this.config.name} API error: ${errMsg}`)
    }

    return data
  }

  async generate(prompt: string, options?: any): Promise<string> {
    const model = this.config.model
    const temperature = options?.temperature ?? this.config.temperature ?? 0.7
    const maxTokens = options?.maxTokens ?? this.config.maxTokens ?? 4096
    const systemContent = options?.system ?? '你是一位专精长篇小说创作的资深作者，擅长构建完整的世界观、人物关系与情节张力。'

    console.log(`[${this.config.name}] Calling API`, model, 'temperature:', temperature)

    const data = await this.callCompletions({
      model,
      messages: [
        { role: 'system', content: systemContent },
        { role: 'user', content: prompt }
      ],
      temperature,
      max_tokens: maxTokens,
      stream: false
    })

    const choice = data.choices?.[0]
    const content = choice?.message?.content
    if (!content) {
      const reason = choice?.finish_reason ? `(finish_reason=${choice.finish_reason})` : '(no choice)'
      const modelInfo = data.model ? ` model=${data.model}` : ''
      throw new Error(`${this.config.name} API returned empty content ${reason}${modelInfo}. Raw: ${JSON.stringify(data).slice(0, 400)}`)
    }

    this.lastUsage = data.usage ? {
      promptTokens: data.usage.prompt_tokens || 0,
      completionTokens: data.usage.completion_tokens || 0,
      totalTokens: data.usage.total_tokens || 0
    } : null

    return content
  }

  async generateWithRuntime(compiled: CompiledPrompt, options?: any): Promise<string> {
    const model = this.config.model
    const temperature = options?.temperature ?? this.config.temperature ?? 0.7
    const maxTokens = options?.maxTokens ?? this.config.maxTokens ?? 4096

    console.log(`[${this.config.name}] generateWithRuntime called`, model, 'temperature:', temperature)

    const data = await this.callCompletions({
      model,
      messages: [
        { role: 'system', content: compiled.systemMessage },
        { role: 'user', content: compiled.userMessage }
      ],
      temperature,
      max_tokens: maxTokens,
      stream: false
    })

    const choice = data.choices?.[0]
    const content = choice?.message?.content
    if (!content) {
      const reason = choice?.finish_reason ? `(finish_reason=${choice.finish_reason})` : '(no choice)'
      const modelInfo = data.model ? ` model=${data.model}` : ''
      throw new Error(`${this.config.name} API returned empty content ${reason}${modelInfo}. Raw: ${JSON.stringify(data).slice(0, 400)}`)
    }

    this.lastUsage = data.usage ? {
      promptTokens: data.usage.prompt_tokens || 0,
      completionTokens: data.usage.completion_tokens || 0,
      totalTokens: data.usage.total_tokens || 0
    } : null

    return content
  }

  async *streamGenerate(prompt: string, options?: any): AsyncIterable<string> {
    yield `[${this.config.name}] streaming not yet implemented`
  }

  async embedding(text: string): Promise<number[]> {
    throw new Error(`${this.config.name} embedding not yet implemented`)
  }

  /**
   * 测试连通性：调用 /v1/models 检测 API Key 和 Base URL 是否可用
   */
  async testConnection(): Promise<{ success: boolean; message: string }> {
    try {
      const baseUrl = this.getBaseUrl()
      const apiKey = this.config.apiKey
      if (!apiKey) {
        return { success: false, message: 'API Key 未配置' }
      }

      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 15000)

      let response: Response
      try {
        response = await fetch(`${baseUrl}/v1/models`, {
          method: 'GET',
          signal: controller.signal,
          headers: this.getAuthHeaders()
        })
      } finally {
        clearTimeout(timeout)
      }

      if (!response.ok) {
        const errorText = await response.text()
        return { success: false, message: `API 返回错误 (${response.status}): ${errorText.slice(0, 200)}` }
      }

      const data = await response.json() as any
      const models = data.data || []
      const targetModel = this.config.model
      const hasModel = models.some((m: any) => m.id === targetModel)

      return {
        success: true,
        message: `连接成功，可用模型 ${models.length} 个${hasModel ? `，目标模型 "${targetModel}" 可用` : `，目标模型 "${targetModel}" 未在列表中（请检查模型名称）`}`
      }
    } catch (err: any) {
      if (err.name === 'AbortError') {
        return { success: false, message: '连接超时（15秒），请检查网络或 Base URL' }
      }
      return { success: false, message: err.message }
    }
  }
}

export function createProvider(config: AIProviderConfig): AIProvider {
  if (OPENAI_COMPATIBLE_PROVIDERS.includes(config.name)) {
    return new OpenAICompatibleProvider(config)
  }
  throw new Error(`Unknown provider "${config.name}". Supported: ${OPENAI_COMPATIBLE_PROVIDERS.join(', ')}`)
}
