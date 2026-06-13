import { PromptPipeline } from '@novel-runtime/prompt-runtime'
import { MemoryManager } from '@novel-runtime/memory-engine'
import { RuntimePromptCompiler } from '@novel-runtime/ai-provider'
import { formatCharacterSnapshot, generateFallbackContent, DEFAULT_PIPELINE_BUDGET, scaleBudget } from '@novel-runtime/shared'
import { loadRuntimeBase } from './runtime-loader.js'
import { callAIWithLog } from './ai-call-logger.js'
import { getActivePlotArcs } from './plot-extractor.js'
import type { FastifyInstance } from 'fastify'

const memoryManager = new MemoryManager()

export function createGenerateProcessor(app: FastifyInstance) {
  return async (job: any) => {
    const { draftIds, chapterId, storyId, compiled, temperatures, maxTokens, chapterTitle, chapterOutline } = job.data
    app.log.info(`[Generate] Processing ${draftIds.length} drafts for chapter ${chapterId}`)

    const prisma = app.prisma
    let successCount = 0
    let failCount = 0

    for (let i = 0; i < draftIds.length; i++) {
      const draftId = draftIds[i]
      const temperature = temperatures[i]

      try {
        app.log.info(`[Generate] Calling AI for draft ${draftId}, temp=${temperature}`)
        const result = await callAIWithLog(app, {
          storyId,
          chapterId,
          callType: 'generate',
          compiled,
          temperature,
          maxTokens
        })

        const fallbackChapter = { title: chapterTitle, outline: chapterOutline }
        const content = result ?? generateFallbackContent(fallbackChapter, i, '未配置 API Key')

        await prisma.draft.update({
          where: { id: draftId },
          data: {
            content,
            status: 'completed',
            compiledPrompt: JSON.stringify(compiled)
          }
        })
        successCount++
        app.log.info(`[Generate] Draft ${draftId} completed, ${content.length} chars`)
      } catch (err: any) {
        app.log.error(`[Generate] Draft ${draftId} failed: ${err.message}`)
        await prisma.draft.update({
          where: { id: draftId },
          data: {
            status: 'failed',
            errorMessage: err.message
          }
        })
        failCount++
      }
    }

    // 只要有成功完成的，就更新章节状态为 generated
    if (successCount > 0) {
      await prisma.chapter.update({
        where: { id: chapterId },
        data: { status: 'generated' }
      })
    }

    app.log.info(`[Generate] Done for chapter ${chapterId}: ${successCount} success, ${failCount} failed`)

    return { successCount, failCount, total: draftIds.length }
  }
}
