import type { FastifyInstance } from 'fastify'
import { PrepareArchiveRequestSchema, safeJsonParse } from '@novel-runtime/shared'
import type { PendingArchiveDataV3 } from '@novel-runtime/shared'
import { parseBody, getOrThrowChapter } from './_helpers.js'
import { runCharacterStage } from '../services/stages/character-stage.js'
import { runMemoryStage } from '../services/stages/memory-stage.js'
import { runPlotArcStage } from '../services/stages/plot-arc-stage.js'
import { runGraphExtractStage } from '../services/stages/graph-extract-stage.js'

/**
 * v3 archive 端点 — 3 端点:
 *   POST /api/chapters/:chapterId/prepare-archive              (启动)
 *   POST /api/chapters/:chapterId/prepare-archive/cancel       (撤销审查)
 *   POST /api/chapters/:chapterId/archive                      (确认归档)
 *
 * v3 关键变化:
 *   - 删除所有 updateMany 锁。仅依赖状态机自身 (draft/reviewing/archived) +
 *     UI 按钮 disabled 防双击。
 *   - prepare-archive 调 4 stage 并行 (Promise.all), 各自结果写入
 *     pendingArchiveData.stages[name]。单 stage 失败不影响其他 stage。
 *   - archive 验证 pendingArchiveData.version === 3 + ∀ stage.status === 'success'。
 *     事务内 commit (本 commit 不含 cumulativeGraph build, 在 Commit 4 加)。
 */
export async function chapterArchiveRoutes(app: FastifyInstance) {
  app.post('/api/chapters/:chapterId/prepare-archive', async (request, reply) => {
    const { chapterId } = request.params as any
    const body = parseBody(PrepareArchiveRequestSchema, request, reply)
    if (body === null) return

    const prisma = app.prisma
    const chapter = await getOrThrowChapter(prisma, chapterId, reply)
    if (chapter === null) return

    if (chapter.status !== 'draft' && chapter.status !== 'reviewing') {
      return reply.status(400).send({
        success: false,
        error: `章节当前状态为 ${chapter.status}，只允许 draft 或 reviewing 状态准备归档`
      })
    }

    if (chapter.isSideStory) {
      await prisma.chapter.update({ where: { id: chapterId }, data: { status: 'archived' } })
      return { success: true, data: { sideStory: true, status: 'archived' } }
    }

    if (!chapter.content) {
      await prisma.chapter.update({ where: { id: chapterId }, data: { status: 'archived' } })
      return { success: true, data: { noContent: true, status: 'archived' } }
    }

    const outlineText = chapter.outline || ''
    const contentText = chapter.content || ''
    if (!outlineText.trim()) return reply.status(400).send({ success: false, error: '归档失败：大纲不能为空' })
    if (!contentText.trim()) return reply.status(400).send({ success: false, error: '归档失败：正文不能为空' })
    if (contentText.length < outlineText.length) {
      return reply.status(400).send({
        success: false,
        error: `归档失败：正文长度（${contentText.length}）不能小于大纲长度（${outlineText.length}）`
      })
    }

    // 直接翻 status (无锁; UI 按钮 + 状态机双层防双击)
    await prisma.chapter.update({
      where: { id: chapterId },
      data: { status: 'reviewing', pendingArchiveData: null, chapterGraph: null }
    })

    // Pre-stage: 文本匹配正文 + 现有 Character → matchedCharacters
    const allCharacters = await prisma.character.findMany({
      where: { storyId: chapter.storyId },
      select: { id: true, name: true, slug: true, protagonist: true }
    })
    const matchedCharacters = allCharacters
      .filter((c: any) => contentText.includes(c.name))
      .map((c: any) => ({
        id: c.id,
        name: c.name,
        key: c.slug,
        label: c.name,
        importance: c.protagonist ? 10 : 7
      }))
    const characterNames = matchedCharacters.map((c: any) => c.name)
    const characterKeys = matchedCharacters.map((c: any) => c.key)

    // 查 latestBranchStates (每个 matched character 的最新一条)
    const latestBranchStates = matchedCharacters.length > 0
      ? await prisma.characterBranchState.findMany({
          where: { characterId: { in: matchedCharacters.map((c: any) => c.id) } },
          orderBy: { fromChapterNumber: 'desc' }
        })
      : []
    // 去重每个 character 保留最新
    const latestPerChar = new Map<string, any>()
    for (const s of latestBranchStates) {
      if (!latestPerChar.has(s.characterId)) latestPerChar.set(s.characterId, s)
    }
    const dedupedBranchStates = Array.from(latestPerChar.values())

    // 查 existing arcs (全部状态, consolidator 内部按 status 分流)
    const allExistingArcs = await prisma.plotArc.findMany({ where: { storyId: chapter.storyId } })

    // 查 prev cumulativeGraph keys
    let prevCumulativeGraphKeys: string[] = []
    if (chapter.parentChapterId) {
      const parent = await prisma.chapter.findUnique({
        where: { id: chapter.parentChapterId },
        select: { cumulativeGraph: true }
      })
      if (parent?.cumulativeGraph) {
        const parsed = safeJsonParse<{ nodes?: Array<{ type: string; key: string }> } | null>(parent.cumulativeGraph, null)
        if (parsed?.nodes) prevCumulativeGraphKeys = parsed.nodes.map(n => `${n.type}:${n.key}`)
      }
    }
    if (prevCumulativeGraphKeys.length === 0) {
      // 主线回退: 找前一个 number 的章节
      const prev = await prisma.chapter.findFirst({
        where: {
          storyId: chapter.storyId,
          parentChapterId: null,
          number: chapter.number - 1,
          id: { not: chapterId }
        },
        select: { cumulativeGraph: true }
      })
      if (prev?.cumulativeGraph) {
        const parsed = safeJsonParse<{ nodes?: Array<{ type: string; key: string }> } | null>(prev.cumulativeGraph, null)
        if (parsed?.nodes) prevCumulativeGraphKeys = parsed.nodes.map(n => `${n.type}:${n.key}`)
      }
    }

    // 4 stage 并行
    const [characterState, memoryState, plotArcState, graphState] = await Promise.all([
      runCharacterStage(app, {
        storyId: chapter.storyId, chapterId, content: contentText, outline: outlineText,
        chapterNumber: chapter.number, matchedCharacters
      }),
      runMemoryStage(app, {
        storyId: chapter.storyId, chapterId, content: contentText, outline: outlineText,
        chapterNumber: chapter.number, characterNames, characterKeys
      }),
      runPlotArcStage(app, {
        storyId: chapter.storyId, chapterId, content: contentText, outline: outlineText,
        chapterNumber: chapter.number, existingArcs: allExistingArcs as any,
        characterNames, latestBranchStates: dedupedBranchStates
      }),
      runGraphExtractStage(app, {
        storyId: chapter.storyId, chapterId, content: contentText, outline: outlineText,
        chapterNumber: chapter.number, characterNames, prevCumulativeGraphKeys,
        latestBranchStates: dedupedBranchStates
      })
    ])

    const pendingData: PendingArchiveDataV3 = {
      version: 3,
      stages: {
        character: characterState,
        memory: memoryState,
        plotArc: plotArcState,
        graph: graphState
      },
      meta: {
        extractedAt: new Date().toISOString(),
        chapterNumber: chapter.number
      }
    }

    // 把 graph stage 成功时的 chapterGraph 也独立写到 Chapter 行
    const chapterGraphUpdate = (graphState.status === 'success' && graphState.result)
      ? JSON.stringify((graphState.result as any).chapterGraph)
      : null

    await prisma.chapter.update({
      where: { id: chapterId },
      data: {
        status: 'reviewing',
        pendingArchiveData: JSON.stringify(pendingData),
        chapterGraph: chapterGraphUpdate
      }
    })

    return { success: true, data: pendingData }
  })

  app.post('/api/chapters/:chapterId/prepare-archive/cancel', async (request, reply) => {
    const { chapterId } = request.params as any
    const prisma = app.prisma
    const chapter = await getOrThrowChapter(prisma, chapterId, reply)
    if (chapter === null) return

    if (chapter.status !== 'reviewing') {
      return reply.status(400).send({
        success: false,
        error: `章节当前状态为 ${chapter.status}，只允许 reviewing 状态撤销审查`
      })
    }

    await prisma.chapter.update({
      where: { id: chapterId },
      data: { status: 'draft', pendingArchiveData: null, chapterGraph: null }
    })

    return { success: true, data: { status: 'draft' } }
  })

  app.post('/api/chapters/:chapterId/archive', async (request, reply) => {
    const { chapterId } = request.params as any
    const prisma = app.prisma
    const chapter = await getOrThrowChapter(prisma, chapterId, reply)
    if (chapter === null) return

    if (chapter.status === 'archived') {
      return { success: true, data: { alreadyArchived: true } }
    }
    if (chapter.status !== 'reviewing') {
      return reply.status(400).send({
        success: false,
        error: `章节当前状态为 ${chapter.status}，只允许 reviewing 状态确认归档`
      })
    }
    if (chapter.isSideStory || !chapter.content) {
      await prisma.chapter.update({
        where: { id: chapterId },
        data: { status: 'archived', pendingArchiveData: null }
      })
      return { success: true, data: { skipped: true } }
    }

    const pendingRaw = chapter.pendingArchiveData
    if (!pendingRaw) {
      return reply.status(400).send({
        success: false,
        error: '归档失败：没有找到预归档数据，请先调用 prepare-archive'
      })
    }
    const pending = safeJsonParse<any>(pendingRaw, null)
    if (!pending || pending.version !== 3) {
      return reply.status(400).send({
        success: false,
        error: '归档失败：pendingArchiveData 版本不匹配，请重新准备归档'
      })
    }
    const failedStages = Object.entries(pending.stages as Record<string, any>)
      .filter(([_, s]) => s.status !== 'success')
      .map(([name]) => name)
    if (failedStages.length > 0) {
      return reply.status(400).send({
        success: false,
        error: `归档失败：以下 stage 未通过：${failedStages.join(', ')}`
      })
    }

    // 直接翻 status (无锁; UI 防双击)
    await prisma.chapter.update({
      where: { id: chapterId },
      data: { status: 'archived', pendingArchiveData: null }
    })

    return { success: true, data: { cumulativeGraph: null, optimizedCount: 0 } }
  })
}
