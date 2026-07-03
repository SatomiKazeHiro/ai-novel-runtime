// V2 AI 调用日志记录

export interface V2AiCallLogParams {
  storyId: string
  chapterId?: string
  callType: string
  aiProviderConfigId: string
  providerName: string
  model: string
  systemMessage: string
  userMessage: string
  responseContent: string
  promptTokens: number
  completionTokens: number
  totalTokens: number
  estimatedTokens: number
  temperature?: number
  maxTokens?: number
  durationMs: number
  status: 'success' | 'error'
  errorMessage?: string
}

export async function logAiCall(prisma: any, params: V2AiCallLogParams): Promise<string> {
  const log = await prisma.promptLog.create({
    data: {
      storyId: params.storyId,
      chapterId: params.chapterId || null,
      callType: params.callType,
      aiProviderConfigId: params.aiProviderConfigId,
      providerName: params.providerName,
      model: params.model,
      systemMessage: params.systemMessage,
      userMessage: params.userMessage,
      responseContent: params.responseContent,
      promptTokens: params.promptTokens,
      completionTokens: params.completionTokens,
      totalTokens: params.totalTokens,
      estimatedTokens: params.estimatedTokens,
      temperature: params.temperature ?? null,
      maxTokens: params.maxTokens ?? null,
      durationMs: params.durationMs,
      status: params.status,
      errorMessage: params.errorMessage || null
    }
  })
  return log.id
}
