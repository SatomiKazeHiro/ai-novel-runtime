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
    const {
      draftIds, chapterId, storyId, compiled, temperatures, maxTokens,
      chapterTitle, chapterOutline, preLockStatus
    } = job.data
    //                                  ↑ 新增:抢锁前章节状态,决定 status 恢复目标
    app.log.info(`[Generate] Processing ${draftIds.length} drafts for chapter ${chapterId} (preLockStatus=${preLockStatus ?? 'draft'})`)

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

    // 恢复 chapter.status:用抢锁前的状态决定,而不是写死 'generated'
    //   draft     → generated  (首次生成完成)
    //   generated → generated  (再生成完成,本身就在)
    //   selected  → selected   (再生成完成,状态保留,Chapter.content 不动)
    // 修复旧 bug:全失败时也恢复(旧代码卡在 'generating'),避免章节卡死
    // 兜底:preLockStatus 缺失(老 queue 残留 job)按 'draft' 处理,行为同旧版本
    const effectivePreLock = preLockStatus ?? 'draft'
    const restoreStatus = effectivePreLock === 'draft' ? 'generated' : effectivePreLock
    await prisma.chapter.update({
      where: { id: chapterId },
      data: { status: restoreStatus }
    })

    app.log.info(`[Generate] Done for chapter ${chapterId}: ${successCount} success, ${failCount} failed, restored to ${restoreStatus}`)

    return { successCount, failCount, total: draftIds.length }
  }
}
