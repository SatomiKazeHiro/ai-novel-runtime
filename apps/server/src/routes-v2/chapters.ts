import type { FastifyInstance } from 'fastify'
import { sha256 } from '../services-v2/hash.js'

/**
 * 章节 CRUD 路由（纯骨架，~140 行）：
 * - GET /api/v2/chapters?storyId=xxx — 列表
 * - POST /api/v2/chapters — 创建
 * - GET /api/v2/chapters/:chapterId — 详情
 * - PUT /api/v2/chapters/:chapterId — 更新 title/content/outline/config
 * - DELETE /api/v2/chapters/:chapterId — 含级联事务清理
 *
 * 兄弟文件（Q12 拆分后）：
 * - chapters-archive.ts — archive / preArchive / savePending
 * - chapters-analysis.ts — 5 路并行 AI analyze
 * - chapters-config.ts — config / memory-search / preview
 * - chapters-drafts.ts — 候选 list / delete
 * - chapters-generate.ts — SSE 流式生成
 */
export async function v2ChapterRoutes(app: FastifyInstance) {
  // GET /api/v2/chapters?storyId=xxx
  app.get('/chapters', async (request) => {
    const { storyId } = request.query as { storyId?: string }
    if (!storyId) {
      return { success: false, error: '缺少 storyId 参数' }
    }
    const chapters = await app.prisma.v2Chapter.findMany({
      where: { storyId },
      orderBy: { number: 'asc' }
    })
    // 计算 canDelete：非归档始终可删，归档仅末尾可删
    const maxNumber = chapters.length > 0
      ? Math.max(...chapters.map(c => c.number))
      : 0
    const data = chapters.map(c => ({
      ...c,
      canDelete: c.status !== 'archived' || c.number === maxNumber
    }))
    return { success: true, data }
  })

  // POST /api/v2/chapters
  app.post('/chapters', async (request) => {
    const body = request.body as any
    if (!body.storyId || !body.title) {
      return { success: false, error: '缺少必填字段 storyId/title' }
    }
    let number: number
    if (body.number !== undefined) {
      number = body.number
    } else {
      const last = await app.prisma.v2Chapter.findFirst({
        where: { storyId: body.storyId },
        orderBy: { number: 'desc' }
      })
      number = last ? Math.floor(last.number) + 1 : 1
    }
    // check duplicate number
    const existing = await app.prisma.v2Chapter.findUnique({
      where: { storyId_number: { storyId: body.storyId, number } }
    })
    if (existing) {
      return { success: false, error: `第 ${number} 章已存在` }
    }
    const chapter = await app.prisma.v2Chapter.create({
      data: {
        storyId: body.storyId,
        number,
        title: body.title,
        content: body.content || '',
        contentHash: body.content ? sha256(body.content) : '',
        status: 'draft',
        config: '{}'
      }
    })
    return { success: true, data: chapter }
  })

  // GET /api/v2/chapters/:chapterId
  app.get('/chapters/:chapterId', async (request) => {
    const { chapterId } = request.params as { chapterId: string }
    const chapter = await app.prisma.v2Chapter.findUnique({
      where: { id: chapterId },
      include: { drafts: { orderBy: { createdAt: 'desc' } } }
    })
    if (!chapter) {
      return { success: false, error: '章节不存在' }
    }
    return { success: true, data: chapter }
  })

  // PUT /api/v2/chapters/:chapterId
  app.put('/chapters/:chapterId', async (request) => {
    const { chapterId } = request.params as { chapterId: string }
    const body = request.body as any

    const existing = await app.prisma.v2Chapter.findUnique({ where: { id: chapterId } })
    if (!existing) {
      return { success: false, error: '章节不存在' }
    }
    if (existing.status === 'archived') {
      return { success: false, error: '已归档章节不可修改' }
    }

    const data: any = {}
    const editableFields = ['draft', 'generating', 'analyzing'].includes(existing.status)
      ? ['title', 'content', 'config', 'outline']
      : []

    if (body.title !== undefined && editableFields.includes('title')) {
      data.title = body.title
    }
    if (body.outline !== undefined && editableFields.includes('outline')) {
      data.outline = body.outline
    }
    if (body.content !== undefined) {
      data.content = body.content
      data.contentHash = body.content ? sha256(body.content) : ''
    }
    if (body.config !== undefined && editableFields.includes('config')) {
      data.config = typeof body.config === 'string' ? body.config : JSON.stringify(body.config)
    }

    const chapter = await app.prisma.v2Chapter.update({
      where: { id: chapterId },
      data
    })
    return { success: true, data: chapter }
  })

  // DELETE /api/v2/chapters/:chapterId
  app.delete('/chapters/:chapterId', async (request, reply) => {
    const { chapterId } = request.params as { chapterId: string }
    const existing = await app.prisma.v2Chapter.findUnique({ where: { id: chapterId } })
    if (!existing) {
      return reply.code(404).send({ success: false, error: '章节不存在' })
    }
    if (existing.status === 'archived') {
      const lastChapter = await app.prisma.v2Chapter.findFirst({
        where: { storyId: existing.storyId },
        orderBy: { number: 'desc' }
      })
      if (lastChapter && lastChapter.id !== chapterId) {
        return { success: false, error: '只能从末尾删除已归档章节' }
      }
    }

    // 判断是否是故事唯一章节（删除后需清理 story-level 派生数据）
    const totalChapters = await app.prisma.v2Chapter.count({
      where: { storyId: existing.storyId }
    })
    const isLastChapter = totalChapters === 1

    // 原子事务：级联清理 + 章节删除 + 末章 story-level 清理
    // 任何一步失败 → 全部回滚，章节不会被孤立
    try {
      await app.prisma.$transaction(async (tx) => {
        if (existing.status === 'archived') {
          const { count: memCount } = await tx.v2Memory.deleteMany({
            where: { storyId: existing.storyId, originChapterNumber: existing.number }
          })
          const { count: teCount } = await tx.v2TimelineEvent.deleteMany({
            where: { storyId: existing.storyId, chapterNumber: existing.number }
          })
          const { count: padCount } = await tx.v2PlotArcDraft.deleteMany({
            where: { chapterId: existing.id }
          })
          // V2CharacterSnapshot 没有 storyId，通过本故事的角色 ID 过滤
          const storyCharacters = await tx.v2Character.findMany({
            where: { storyId: existing.storyId },
            select: { id: true }
          })
          const { count: csCount } = await tx.v2CharacterSnapshot.deleteMany({
            where: { characterId: { in: storyCharacters.map(c => c.id) }, chapterNumber: existing.number }
          })
          app.log.info(
            `[V2 Delete] Cascade cleanup for chapter ${existing.number}: ` +
            `memory=${memCount}, timeline=${teCount}, plotArcDraft=${padCount}, characterSnapshot=${csCount}`
          )
        }
        await tx.v2Chapter.delete({ where: { id: chapterId } })
        if (isLastChapter) {
          const { count: arcCount } = await tx.v2PlotArc.deleteMany({
            where: { storyId: existing.storyId }
          })
          const { count: logCount } = await tx.v2MemoryMergeLog.deleteMany({
            where: { storyId: existing.storyId }
          })
          app.log.info(
            `[V2 Delete] Last chapter removed. Cleaned plotArc=${arcCount}, memoryMergeLog=${logCount}`
          )
        }
      })
      return { success: true }
    } catch (err: any) {
      if (err?.code === 'P2025') {
        return reply.code(404).send({ success: false, error: '章节不存在（已被删除）' })
      }
      if (err?.code === 'P2003') {
        return reply.code(409).send({ success: false, error: '该章节存在未被级联清理的关联数据，无法删除' })
      }
      app.log.error(`[V2 Delete] Chapter ${chapterId} cascade failed: ${err.message}`)
      return reply.code(500).send({
        success: false,
        error: `删除失败，已回滚（派生数据未清理）: ${err.message}`
      })
    }
  })
}
