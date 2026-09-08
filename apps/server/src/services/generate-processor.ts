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
      chapterTitle, chapterOutline
    } = job.data
    app.log.info(`[Generate] Processing ${draftIds.length} drafts for chapter ${chapterId}`)

    const prisma = app.prisma
    let successCount = 0
    let failCount = 0

    for (let i = 0; i < draftIds.length; i++) {
      const draftId = draftIds[i]
      const temperature = temperatures[i]

      // 写 draft 前查 status, 跳过用户已决定 / 已处理过的 draft。
      // 否则用户在 worker 跑到一半时 select, select route 把所有 draft 置 rejected、
      // 把选中的置 selected, 但 worker 后续仍会调 update({status:completed}),
      // 把已被 select 标记的 draft "复活", 破坏"被选中的应该是唯一 active 草稿"的语义。
      //
      // status 集合说明:
      //   pending    — worker 还没跑过 (历史字段, route 已不再用, 保留兼容)
      //   generating — route 创建 draft 时的初始状态, "已入队等 worker 跑"
      //   completed  — worker 已成功处理
      //   failed     — worker 处理失败
      //   rejected   — 用户选了别的 draft, 此 draft 被淘汰
      //
      // v2: 不再有 'selected' —— 采纳哪个 draft 只看 Chapter.content 是否匹配,
      // worker 不需要也不能翻 'selected' 状态。
      //
      // 关键: route 用 `status: 'generating'` 创建 draft (§routes/chapters-generate.ts:278),
      // 所以 worker 不能用 `status !== 'pending'` 来过滤, 否则永远跳过自己刚派出去的任务。
      // 应当处理 pending + generating, 跳过其他三种 (用户决定 + 已完成)。
      const SKIP_STATUSES = ['rejected', 'completed', 'failed']
      const current = await prisma.draft.findUnique({
        where: { id: draftId },
        select: { status: true }
      })
      if (!current || SKIP_STATUSES.includes(current.status)) {
        app.log.info(`[Generate] Skipping draft ${draftId} (status=${current?.status ?? 'missing'}, user-decided or terminal)`)
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

        // 乐观锁：仅当 draft 仍处于 pending/generating 时才写 completed。
        // 若 AI 调用期间被 select 置 rejected（用户已采用其他候选），count=0 → 放弃写回，不复活。
        const updated = await prisma.draft.updateMany({
          where: { id: draftId, status: { in: ['pending', 'generating'] } },
          data: {
            content,
            status: 'completed',
            compiledPrompt: JSON.stringify(compiled)
          }
        })
        if (updated.count === 0) {
          app.log.info(`[Generate] Draft ${draftId} was rejected during generation, skip completed write`)
          continue
        }
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

    // v2: worker 不再写 chapter.status, 候选生成与章节状态正交
    app.log.info(`[Generate] Done for chapter ${chapterId}: ${successCount} success, ${failCount} failed`)

    return { successCount, failCount, total: draftIds.length }
  }
}
