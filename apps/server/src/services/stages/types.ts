import type { FastifyInstance } from 'fastify'
import { cleanJsonBlock } from '@novel-runtime/shared'

export interface StageState<T = unknown> {
  status: 'pending' | 'running' | 'success' | 'failed'
  result?: T
  errorMessage?: string
  completedAt?: string
}

export type StageName = 'character' | 'memory' | 'plotArc' | 'graph'

export interface StageContext {
  storyId: string
  chapterId: string
  chapterNumber: number
  content: string
  outline: string
}

interface StageRetryOptions {
  storyId: string
  chapterId: string
  callType: string
  compiled: any
  maxTokens?: number
}

function errorSummary(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export async function callAIWithStageRetry(
  app: FastifyInstance,
  opts: StageRetryOptions
): Promise<string> {
  const { callAIWithLog } = await import('../ai-call-logger.js')

  const firstResponse = await callAIWithLog(app, {
    ...opts,
    temperature: 0.3
  })

  if (!firstResponse) {
    throw new Error('AI 返回为空')
  }

  try {
    JSON.parse(cleanJsonBlock(firstResponse))
    return firstResponse
  } catch (firstError) {
    try {
      const retryResponse = await callAIWithLog(app, {
        ...opts,
        callType: `${opts.callType}_retry`,
        temperature: 0.1
      })

      if (!retryResponse) {
        throw new Error('AI 返回为空')
      }

      JSON.parse(cleanJsonBlock(retryResponse))
      return retryResponse
    } catch (retryError) {
      throw new Error(
        `AI 响应解析失败：首次错误：${errorSummary(firstError)}；重试错误：${errorSummary(retryError)}`
      )
    }
  }
}
