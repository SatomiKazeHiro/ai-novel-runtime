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

      // 写 draft 前查 status, 跳过已被 select / rejected / 已处理过的 draft。
      // 否则用户在 worker 跑到一半时 select, select route 把所有 draft 置 rejected、
      // 把选中的置 selected, 但 worker 后续仍会调 update({status:completed}),
      // 把已被 select 标记的 draft "复活", 破坏"被选中的应该是唯一 active 草稿"的语义。
      //
      // status 集合说明:
      //   pending    — worker 还没跑过 (初始状态)
      //   generating — (历史字段, 实际 worker 直接写 completed/failed, 不会用 generating)
      //   completed  — worker 已成功处理
      //   failed     — worker 处理失败
      //   selected   — 用户已选此 draft
      //   rejected   — 用户选了别的 draft, 此 draft 被淘汰
      // 跳过 pending 之外的所有状态 — pending 才是真正需要 worker 处理的。
      const current = await prisma.draft.findUnique({
        where: { id: draftId },
        select: { status: true }
      })
      if (!current || current.status !== 'pending') {
        app.log.info(`[Generate] Skipping draft ${draftId} (status=${current?.status ?? 'missing'}, user may have selected another draft already)`)
        continue
      }

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

    // 恢复 chapter.status: 看 chapter 当前状态, 不无脑覆盖。
    //   抢锁前 = draft  → 本次任务把 chapter 推到 'generated' (前提是 chapter 还在 generating)
    //   抢锁前 = generated/selected → 仅当 chapter 还在 generating 时不写 (selected 是用户主动选的, 不要覆盖)
    // 用户在 worker 跑到一半时 select, select route 已把 chapter.status 翻成 'selected',
    // 这里 updateMany where status='generating' count=0, 不动 chapter.status — select 结果保留。
    // 兜底:preLockStatus 缺失 (老 queue 残留 job) 按 'draft' 处理, 行为同旧版本。
    const effectivePreLock = preLockStatus ?? 'draft'
    const targetStatus = effectivePreLock === 'draft' ? 'generated' : effectivePreLock
    const statusRestore = await prisma.chapter.updateMany({
      where: { id: chapterId, status: 'generating' },
      data: { status: targetStatus }
    })
    const restored = statusRestore.count > 0

    app.log.info(`[Generate] Done for chapter ${chapterId}: ${successCount} success, ${failCount} failed, restored=${restored} target=${targetStatus}`)

    return { successCount, failCount, total: draftIds.length }
  }
}
