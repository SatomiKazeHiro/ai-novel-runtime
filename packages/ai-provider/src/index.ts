import { CompiledPrompt } from './runtime-compiler.js'

export { CompiledPrompt, RuntimePromptCompiler, SharedRuntimeBase, WorkerTask } from './runtime-compiler.js'

export interface AIProvider {
  generate(prompt: string, options?: any): Promise<string>
  generateWithRuntime?(compiled: CompiledPrompt, options?: any): Promise<string>
  streamGenerate(prompt: string, options?: any): AsyncIterable<string>
  embedding?(text: string): Promise<number[]>
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
    console.log('[OpenAIProvider] generate called', this.config.model)
    return `[Generated content placeholder for: ${prompt.slice(0, 50)}...]`
  }

  async generateWithRuntime(compiled: CompiledPrompt, options?: any): Promise<string> {
    console.log('[OpenAIProvider] generateWithRuntime called', this.config.model)
    return `[Generated content placeholder for: ${compiled.userMessage.slice(0, 50)}...]`
  }

  async *streamGenerate(prompt: string, options?: any): AsyncIterable<string> {
    yield '[Streaming placeholder]'
  }

  async embedding(text: string): Promise<number[]> {
    return new Array(1536).fill(0).map(() => Math.random() - 0.5)
  }
}

export class DeepSeekProvider implements AIProvider {
  private config: AIProviderConfig
  constructor(config: AIProviderConfig) { this.config = config }

  async generate(prompt: string, options?: any): Promise<string> {
    const apiKey = this.config.apiKey
    const baseUrl = (this.config.baseUrl || 'https://api.deepseek.com').replace(/\/$/, '')
    const model = this.config.model || 'deepseek-chat'
    const temperature = options?.temperature ?? this.config.temperature ?? 0.7
    const maxTokens = options?.maxTokens ?? this.config.maxTokens ?? 4096
    const systemContent = options?.system ?? '你是一位专精玄幻修仙小说的资深作者，擅长构建完整修炼体系、门派势力格局与长生大道。'

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
