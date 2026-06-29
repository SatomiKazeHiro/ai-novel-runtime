// V2 AI 调用封装 — 阶段 4 实现

export interface V2AiCallOptions {
  systemMessage: string
  userMessage: string
  temperature?: number
  maxTokens?: number
}

export interface V2AiCallResult {
  content: string
  promptTokens: number
  completionTokens: number
  totalTokens: number
  durationMs: number
}

export async function aiCall(_opts: V2AiCallOptions): Promise<V2AiCallResult> {
  throw new Error('Not implemented: aiCall — 阶段 4 实现')
}
