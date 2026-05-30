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

export class OpenAIProvider implements AIProvider {
  private config: AIProviderConfig
  constructor(config: AIProviderConfig) { this.config = config }

  async generate(prompt: string, options?: any): Promise<string> {
    throw new Error('OpenAIProvider not yet implemented')
  }

  async generateWithRuntime(compiled: CompiledPrompt, options?: any): Promise<string> {
    throw new Error('OpenAIProvider not yet implemented')
  }

  async *streamGenerate(prompt: string, options?: any): AsyncIterable<string> {
    throw new Error('OpenAIProvider streaming not yet implemented')
  }

  async embedding(text: string): Promise<number[]> {
    throw new Error('OpenAIProvider embedding not yet implemented')
  }
}

export class DeepSeekProvider implements AIProvider {
  private config: AIProviderConfig
  lastUsage: TokenUsage | null = null
  constructor(config: AIProviderConfig) { this.config = config }

  async generate(prompt: string, options?: any): Promise<string> {
    const apiKey = this.config.apiKey
    const baseUrl = (this.config.baseUrl || 'https://api.deepseek.com').replace(/\/$/, '')
    const model = this.config.model || 'deepseek-chat'
    const temperature = options?.temperature ?? this.config.temperature ?? 0.7
    const maxTokens = options?.maxTokens ?? this.config.maxTokens ?? 4096
    const systemContent = options?.system ?? '你是一位专精长篇小说创作的资深作者，擅长构建完整的世界观、人物关系与情节张力。'

    if (!apiKey) {
      throw new Error('DeepSeek API key is not configured')
    }

    console.log('[DeepSeekProvider] Calling API', model, 'temperature:', temperature)

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 30000) // 30s timeout

    let response: Response
    try {
      response = await fetch(`${baseUrl}/v1/chat/completions`, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: systemContent },
            { role: 'user', content: prompt }
          ],
          temperature,
          max_tokens: maxTokens,
          stream: false
        })
      })
    } finally {
      clearTimeout(timeout)
    }

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`DeepSeek API error (${response.status}): ${errorText}`)
    }

    const data = await response.json() as any
    const content = data.choices?.[0]?.message?.content

    if (!content) {
      throw new Error('DeepSeek API returned empty content')
    }

    this.lastUsage = data.usage ? {
      promptTokens: data.usage.prompt_tokens || 0,
      completionTokens: data.usage.completion_tokens || 0,
      totalTokens: data.usage.total_tokens || 0
    } : null

    return content
  }

  async generateWithRuntime(compiled: CompiledPrompt, options?: any): Promise<string> {
    const apiKey = this.config.apiKey
    const baseUrl = (this.config.baseUrl || 'https://api.deepseek.com').replace(/\/$/, '')
    const model = this.config.model || 'deepseek-chat'
    const temperature = options?.temperature ?? this.config.temperature ?? 0.7
    const maxTokens = options?.maxTokens ?? this.config.maxTokens ?? 4096

    if (!apiKey) {
      throw new Error('DeepSeek API key is not configured')
    }

    console.log('[DeepSeekProvider] generateWithRuntime called', model, 'temperature:', temperature)

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 30000) // 30s timeout

    let response: Response
    try {
      response = await fetch(`${baseUrl}/v1/chat/completions`, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: compiled.systemMessage },
            { role: 'user', content: compiled.userMessage }
          ],
          temperature,
          max_tokens: maxTokens,
          stream: false
        })
      })
    } finally {
      clearTimeout(timeout)
    }

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`DeepSeek API error (${response.status}): ${errorText}`)
    }

    const data = await response.json() as any
    const content = data.choices?.[0]?.message?.content

    if (!content) {
      throw new Error('DeepSeek API returned empty content')
    }

    this.lastUsage = data.usage ? {
      promptTokens: data.usage.prompt_tokens || 0,
      completionTokens: data.usage.completion_tokens || 0,
      totalTokens: data.usage.total_tokens || 0
    } : null

    return content
  }

  async *streamGenerate(prompt: string, options?: any): AsyncIterable<string> {
    yield '[DeepSeek streaming not yet implemented]'
  }
}

export function createProvider(config: AIProviderConfig): AIProvider {
  if (config.name === 'openai') return new OpenAIProvider(config)
  if (config.name === 'deepseek') return new DeepSeekProvider(config)
  return new OpenAIProvider(config)
}
