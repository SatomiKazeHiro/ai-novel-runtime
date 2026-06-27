import type { FastifyInstance } from 'fastify'
import { prepareArchiveData, type PendingArchiveData } from '../services/combined-extractor.js'
import { optimizeMemories } from '../services/memory-optimizer.js'
import { commitPlotArcWrites } from '../services/plot-extractor.js'
import { saveGraphSnapshotAndDelta, type GraphSnapshot } from '../services/graph-snapshot.js'
import { commitMemoryWrites } from '../services/memory-extractor.js'
import { PrepareArchiveRequestSchema, safeJsonParse } from '@novel-runtime/shared'
import { parseBody, getOrThrowChapter } from './_helpers.js'

/**
 * Archive 流：Phase 1-2 (prepare-archive) + Phase 3-4 (archive confirm)。
 * 详见 routes/chapters.ts 注释或 docs/Process.md「Archive Pipeline」。
 */
export async function chapterArchiveRoutes(app: FastifyInstance) {
  // POST /api/chapters/:chapterId/prepare-archive
  app.post('/api/chapters/:chapterId/prepare-archive', async (request, reply) => {
    const { chapterId } = request.params as any
    const body = parseBody(PrepareArchiveRequestSchema, request, reply)
    if (body === null) return

    const prisma = app.prisma

    const chapter = await getOrThrowChapter(prisma, chapterId, reply)
    if (chapter === null) return

    // 允许 selected 和 reviewing 两种状态进入 prepare-archive：
    // - selected：正常首次准备
    // - reviewing：上一次提取失败导致 pendingArchiveData=null/损坏，需要重试
    //   （不重新丢章节、不让用户走"取消审查=删除"恢复路径）
    if (chapter.status !== 'selected' && chapter.status !== 'reviewing') {
      return reply.status(400).send({
        success: false,
        error: `章节当前状态为 ${chapter.status}，只允许 selected 或 reviewing 状态准备归档`
      })
    }
    const preLockStatus = chapter.status

    // 番外不触发提取，直接归档
    if (chapter.isSideStory) {
      await prisma.chapter.update({ where: { id: chapterId }, data: { status: 'archived' } })
      return { success: true, data: { sideStory: true, status: 'archived' } }
    }

    // 主线无正文：直接归档
    if (!chapter.content) {
      await prisma.chapter.update({ where: { id: chapterId }, data: { status: 'archived' } })
      return { success: true, data: { noContent: true, status: 'archived' } }
    }

    const outlineText = chapter.outline || ''
    const contentText = chapter.content || ''
    if (!outlineText.trim()) {
      return reply.status(400).send({ success: false, error: '归档失败：大纲不能为空' })
    }
    if (!contentText.trim()) {
      return reply.status(400).send({ success: false, error: '归档失败：正文不能为空' })
    }
    if (contentText.length < outlineText.length) {
      return reply.status(400).send({
        success: false,
        error: `归档失败：正文长度（${contentText.length}）不能小于大纲长度（${outlineText.length}）`
      })
    }

    // 状态机独占锁：原子性 updateMany（防止双击 prepare-archive 触发 2× AI 调用）
    // 必须先于 prepareArchiveData 获取。允许 status 是 selected（首次）或
    // reviewing（重试）—— 后者从 reviewing 进入会把 status 翻成 reviewing
    // （自身），并清掉旧的 pendingArchiveData 让新 payload 接管。
    const lockResult = await prisma.chapter.updateMany({
      where: { id: chapterId, status: { in: ['selected', 'reviewing'] } },
      data: { status: 'reviewing', pendingArchiveData: null }
    })
    if (lockResult.count === 0) {
      return reply.status(409).send({
        success: false,
        error: '章节正在准备归档中或状态不允许，请刷新后重试'
      })
    }

    let pending: PendingArchiveData | null = null
    try {
      pending = await prepareArchiveData(
        app,
        chapterId,
        chapter.storyId,
        contentText,
        chapter.outline,
        chapter.number,
        chapter.parentChapterId
      )
    } catch (err: any) {
      // Rollback: 回到 preLockStatus 而不是硬编码 'selected'。
      // 如果用户从 selected 进入 → 失败 → 回 selected（保持原行为）；
      // 如果从 reviewing 重试 → 失败 → 回 reviewing（保留 retry 入口）。
      await prisma.chapter.update({
        where: { id: chapterId },
        data: { status: preLockStatus }
      }).catch(() => { /* swallow rollback failure */ })
      app.log.error(`[Prepare-Archive] Failed for chapter ${chapterId}: ${err.message}`)
      return reply.status(500).send({
        success: false,
        error: `准备归档失败：AI 提取出错（${err.message}）。请检查 AI 配置后重试。`
      })
    }

    if (!pending) {
      return reply.status(500).send({
        success: false,
        error: '准备归档失败：AI 提取返回为空，请检查 AI 配置后重试'
      })
    }

    await prisma.chapter.update({
      where: { id: chapterId },
      data: {
        status: 'reviewing',
        pendingArchiveData: JSON.stringify(pending)
      }
    })

    return { success: true, data: pending }
  })

  // POST /api/chapters/:chapterId/archive
  app.post('/api/chapters/:chapterId/archive', async (request, reply) => {
    const { chapterId } = request.params as any
    const prisma = app.prisma

    const chapter = await getOrThrowChapter(prisma, chapterId, reply)
    if (chapter === null) return

    if (chapter.status === 'archived') {
      app.log.info(`[Archive] Chapter ${chapterId} already archived, skipping`)
      return { success: true, data: { alreadyArchived: true } }
    }

    // 只允许 reviewing 状态确认归档
    if (chapter.status !== 'reviewing') {
      return reply.status(400).send({
        success: false,
        error: `章节当前状态为 ${chapter.status}，只允许 reviewing 状态确认归档`
      })
    }

    // 番外或无正文：prepare-archive 阶段已处理，这里兜底
    if (chapter.isSideStory || !chapter.content) {
      await prisma.chapter.update({
        where: { id: chapterId },
        data: { status: 'archived', pendingArchiveData: null }
      })
      return { success: true, data: { skipped: true } }
    }

    const pending = safeJsonParse(chapter.pendingArchiveData, null) as PendingArchiveData | null

    if (!pending) {
      return reply.status(400).send({
        success: false,
        error: '归档失败：没有找到预归档数据，请先调用 prepare-archive'
      })
    }

    // 状态机独占锁：原子性 updateMany（防止双击 archive 产生重复
    // Memory/Timeline/PlotArc/Graph 写入）。锁在事务外，事务本身仍保持原子性。
    // 锁把 status 翻到 'archived'，后续事务内的 status='archived' 写入为 no-op。
    const lockResult = await prisma.chapter.updateMany({
      where: { id: chapterId, status: 'reviewing' },
      data: { status: 'archived' }
    })
    if (lockResult.count === 0) {
      return reply.status(409).send({
        success: false,
        error: '章节正在归档中或状态不允许，请刷新后重试'
      })
    }

    // 事务写入
    let graphSaved: { snapshot: GraphSnapshot; delta: GraphSnapshot } | null = null
    try {
      graphSaved = await prisma.$transaction(async (tx) => {
        // 1. 写入记忆、角色状态、时间线
        await commitMemoryWrites(tx, chapterId, chapter.storyId, pending.memories)

        // 2. 更新章节摘要 + timelinePosition (本章开篇时间锚点)
        //    把两个相关字段放在同一次 UPDATE: 都是 chapter 本章级元数据,
        //    都在 prepare-archive 阶段确定, 一起原子落库。
        //    timelinePosition 可能为 null — 显式置 NULL (Prisma unset 不会写 NULL, 要赋值 null)。
        const chapterMetaUpdate: { summary?: string; timelinePosition: number | null } = {
          timelinePosition: pending.memories.timelinePosition
        }
        if (pending.memories.summary) {
          chapterMetaUpdate.summary = pending.memories.summary
        }
        await tx.chapter.update({
          where: { id: chapterId },
          data: chapterMetaUpdate
        })

        // 3. 写入剧情弧线 (含 lastTouchedChapter 刷新 + stale 检测)
        await commitPlotArcWrites(tx, chapter.number, pending.plotArcs)

        // 4. 写入图谱快照
        const saved = await saveGraphSnapshotAndDelta(tx, chapterId, chapter.storyId, pending.graph)
        if (!saved) {
          throw new Error('知识图谱保存失败')
        }

        // 5. 正式归档
        await tx.chapter.update({
          where: { id: chapterId },
          data: { status: 'archived', pendingArchiveData: null }
        })

        return saved
      })

      app.log.info(`[Archive] Transaction committed for chapter ${chapterId}`)
    } catch (err: any) {
      app.log.error(`[Archive] Transaction failed: ${err.message}`)
      return reply.status(500).send({
        success: false,
        error: `归档失败：数据保存出错（${err.message}）。章节状态未变更，请检查 AI 配置后重试。`
      })
    }

    // 阶段 4：记忆优化（失败不阻塞归档）
    let optimizedCount = 0
    try {
      optimizedCount = await optimizeMemories(app, chapter.storyId, chapterId, chapter.number)
      app.log.info(`[Archive] Memory optimized: ${optimizedCount} global memories`)
    } catch (err: any) {
      app.log.error(`[Archive] Memory optimization failed (non-blocking): ${err.message}`)
    }

    return {
      success: true,
      data: { optimizedCount, graph: graphSaved }
    }
  })
}
