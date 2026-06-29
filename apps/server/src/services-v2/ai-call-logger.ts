// V2 AI 调用日志记录 — 阶段 4 实现

export interface V2AiCallLogParams {
  storyId: string
  chapterId?: string
  callType: string
  providerName: string
  model: string
  systemMessage: string
  userMessage: string
  responseContent: string
  promptTokens: number
  completionTokens: number
  totalTokens: number
  durationMs: number
  status: 'success' | 'error'
  errorMessage?: string
}

export async function logAiCall(_params: V2AiCallLogParams): Promise<void> {
  throw new Error('Not implemented: logAiCall — 阶段 4 实现')
}
