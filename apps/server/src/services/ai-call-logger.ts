import type { FastifyInstance } from 'fastify'
import type { CompiledPrompt } from '@novel-runtime/ai-provider'
import { resolveProvider } from './ai-provider-init.js'

export interface AICallOptions {
  storyId: string
  chapterId?: string
  callType: string
  compiled: CompiledPrompt
  temperature?: number
  maxTokens?: number
}

/**
 * 调用 AI Provider 并自动记录 PromptLog
 * - 成功：返回 content，写入 success 日志（异步，不阻塞）
 * - 失败：抛出错误，写入 error 日志（异步，不阻塞）
 * - 无 Provider：返回 null
 */
export async function callAIWithLog(
  app: FastifyInstance,
  options: AICallOptions
): Promise<string | null> {
  const prisma = app.prisma
  const { storyId, chapterId, callType, compiled, temperature, maxTokens } = options

  const resolved = await resolveProvider(prisma, storyId, chapterId)
  if (!resolved?.provider?.generateWithRuntime) {
    app.log.warn(`[AICallLogger] No provider resolved for ${callType}, skipping`)
    return null
  }

  const { provider, config: aiConfig } = resolved

  const startTime = Date.now()

  try {
    const content = await provider.generateWithRuntime(compiled, {
      temperature,
      maxTokens
    })

    const durationMs = Date.now() - startTime
    const usage = (provider as any).lastUsage

    // 异步写入日志，不阻塞返回
    prisma.promptLog.create({
      data: {
        storyId,
        chapterId: chapterId || null,
        callType,
        aiProviderConfigId: aiConfig.id,
        providerName: aiConfig.name,
        model: aiConfig.model,
        systemMessage: compiled.systemMessage,
        userMessage: compiled.userMessage,
        responseContent: content,
        promptTokens: usage?.promptTokens || 0,
        completionTokens: usage?.completionTokens || 0,
        totalTokens: usage?.totalTokens || 0,
        estimatedTokens: compiled.meta.totalTokens,
        temperature: temperature ?? aiConfig.temperature,
        maxTokens: maxTokens ?? aiConfig.maxTokens,
        durationMs,
        status: 'success'
      }
    }).catch((err: any) => {
      app.log.error(`[AICallLogger] Failed to write success log: ${err.message}`)
    })

    return content
  } catch (err: any) {
    const durationMs = Date.now() - startTime

    prisma.promptLog.create({
      data: {
        storyId,
        chapterId: chapterId || null,
        callType,
        aiProviderConfigId: aiConfig.id,
        providerName: aiConfig.name,
        model: aiConfig.model,
        systemMessage: compiled.systemMessage,
        userMessage: compiled.userMessage,
        responseContent: '',
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
        estimatedTokens: compiled.meta.totalTokens,
        temperature: temperature ?? aiConfig.temperature,
        maxTokens: maxTokens ?? aiConfig.maxTokens,
        durationMs,
        status: 'error',
        errorMessage: err.message
      }
    }).catch((logErr: any) => {
      app.log.error(`[AICallLogger] Failed to write error log: ${logErr.message}`)
    })

    throw err
  }
}
