import type { FastifyInstance } from 'fastify'
import {
  safeJsonParse,
  CreateChapterRequestSchema,
  UpdateChapterRequestSchema,
  DevelopRequestSchema
} from '@novel-runtime/shared'
import { parseBody, getOrThrowChapter, getLastChapter } from './_helpers.js'

/**
 * CRUD 流:list / one / create / update / delete / develop(side story)。
 * 内部 helper:allocateSideStoryNumber(仅 develop 用,保留在文件内闭包)。
 */
export async function chapterCrudRoutes(app: FastifyInstance) {
  // 内部 helper:仅 develop 用,文件内闭包
  async function allocateSideStoryNumber(prisma: any, storyId: string, baseNumber: number): Promise<number> {
    const existing = await prisma.chapter.findMany({
      where: { storyId },
      select: { number: true }
    })
    const existingNumbers = existing.map((c: any) => c.number)
    let seq = 1
    while (true) {
      const candidate = Math.round((baseNumber + seq * 0.01) * 100) / 100
      if (!existingNumbers.some((n: number) => Math.abs(n - candidate) < 0.0001)) {
        return candidate
      }
      seq++
      if (seq > 99) return -1
    }
  }

  // GET /api/stories/:storyId/chapters
  app.get('/api/stories/:storyId/chapters', async (request, reply) => {
    const { storyId } = request.params as any
    const chapters = await app.prisma.chapter.findMany({
      where: { storyId },
      orderBy: { number: 'asc' }
    })
    return { success: true, data: chapters }
  })

  // POST /api/stories/:storyId/chapters
  app.post('/api/stories/:storyId/chapters', async (request, reply) => {
    const { storyId } = request.params as any
    const body = parseBody(CreateChapterRequestSchema, request, reply)
    if (body === null) return

    const existingCount = await app.prisma.chapter.count({ where: { storyId } })
    if (existingCount > 0) {
      return reply.status(400).send({ success: false, error: '已有章节，无法新建根章节' })
    }

    // 无章节时强制非番外
    const isSideStory = false
    const lastChapter = await app.prisma.chapter.findFirst({
      where: { storyId, isSideStory: false },
      orderBy: { number: 'desc' }
    })
    const number = (lastChapter?.number || 0) + 1

    const chapter = await app.prisma.chapter.create({
      data: {
        storyId,
        number,
        isSideStory,
        title: body.title,
        outline: body.outline || '',
        status: 'draft'
      }
    })
    return { success: true, data: chapter }
  })

  // GET /api/chapters/:chapterId
  // 保留 include: { drafts: true } —— getOrThrowChapter 不支持 include,需保留内联。
  app.get('/api/chapters/:chapterId', async (request, reply) => {
    const { chapterId } = request.params as any
    const chapter = await app.prisma.chapter.findUnique({
      where: { id: chapterId },
      include: { drafts: true }
    })
    if (!chapter) return reply.status(404).send({ success: false, error: 'Chapter not found' })
    return { success: true, data: chapter }
  })

  // PUT /api/chapters/:chapterId
  app.put('/api/chapters/:chapterId', async (request, reply) => {
    const { chapterId } = request.params as any
    const body = parseBody(UpdateChapterRequestSchema, request, reply)
    if (body === null) return

    const chapter = await getOrThrowChapter(app.prisma, chapterId, reply)
    if (chapter === null) return

    // archived 章节只读，不允许任何修改
    if (chapter.status === 'archived') {
      return reply.status(400).send({ success: false, error: '已归档章节不可修改' })
    }

    // 禁止直接通过 PUT 修改 status，状态转换必须通过专门接口
    if (body.status !== undefined) {
      return reply.status(400).send({ success: false, error: '不允许直接修改 status 字段' })
    }

    const data: any = {}
    if (body.title !== undefined) data.title = body.title
    if (body.outline !== undefined) data.outline = body.outline
    if (body.content !== undefined) data.content = body.content
    if (body.sceneLocation !== undefined) data.sceneLocation = body.sceneLocation
    if (body.sceneMood !== undefined) data.sceneMood = body.sceneMood
    if (body.sceneGoal !== undefined) data.sceneGoal = body.sceneGoal
    if (body.aiProviderConfigId !== undefined) data.aiProviderConfigId = body.aiProviderConfigId || null
    if (body.pendingArchiveData !== undefined) data.pendingArchiveData = body.pendingArchiveData

    // reviewing 状态只允许调整 content 和 pendingArchiveData
    if (chapter.status === 'reviewing') {
      const allowedKeys = ['content', 'pendingArchiveData']
      const receivedKeys = Object.keys(data)
      const invalidKeys = receivedKeys.filter(k => !allowedKeys.includes(k))
      if (invalidKeys.length > 0) {
        return reply.status(400).send({
          success: false,
          error: `reviewing 状态不允许修改以下字段：${invalidKeys.join(', ')}`
        })
      }
    }

    const updated = await app.prisma.chapter.update({ where: { id: chapterId }, data })
    return { success: true, data: updated }
  })

  // DELETE /api/chapters/:chapterId
  // 保留 findUnique 内联 —— 需要 include: { childChapters: true } 做归档分支判定。
  app.delete('/api/chapters/:chapterId', async (request, reply) => {
    const { chapterId } = request.params as any
    const prisma = app.prisma

    const chapter = await prisma.chapter.findUnique({
      where: { id: chapterId },
      include: { childChapters: true }
    })
    if (!chapter) return reply.status(404).send({ success: false, error: 'Chapter not found' })

    // 已归档且有子章节的不可删除
    if (chapter.status === 'archived' && chapter.childChapters.length > 0) {
      return reply.status(400).send({ success: false, error: '已归档且有子章节的章节不可删除' })
    }

    // 只能删除末尾章节（number 最大的），除非是非归档的草稿/生成中/已选中章节
    if (chapter.status === 'archived') {
      const lastChapter = await getLastChapter(prisma, chapter.storyId)
      if (lastChapter && lastChapter.id !== chapterId) {
        return reply.status(400).send({ success: false, error: '只能按顺序从末尾删除已归档章节' })
      }
      // 如果是末尾章节，检查是否有番外需要先删除
      const sideStories = await prisma.chapter.findMany({
        where: { storyId: chapter.storyId, isSideStory: true },
        orderBy: { number: 'desc' }
      })
      // 如果存在 number > chapter.number 的番外？不，番外是挂在父章节下的
      // 实际上番外的 parentChapterId 指向任意章节，番外的 number 可能是小数
      // 删除末尾章节时，番外可能 number 比它大也可能比它小
      // 这里简化：如果该章节有 childChapters（已在上面拦截），或者存在 number 更大的番外
      const maxSideStory = sideStories[0]
      if (maxSideStory && maxSideStory.number > chapter.number) {
        return reply.status(400).send({ success: false, error: '存在尚未删除的番外，请先删除番外' })
      }
    }

    // 级联清理：删除同 fromChapterNumber 的派生数据
    if (chapter.status === 'archived' && chapter.number > 0) {
      try {
        const { count: memCount } = await prisma.memory.deleteMany({
          where: { storyId: chapter.storyId, fromChapterNumber: chapter.number }
        })
        const { count: teCount } = await prisma.timelineEvent.deleteMany({
          where: { storyId: chapter.storyId, fromChapterNumber: chapter.number }
        })
        const { count: bsCount } = await prisma.characterBranchState.deleteMany({
          where: { fromChapterNumber: chapter.number }
        })
        app.log.info(`[Delete] Cascade cleanup for chapter ${chapter.number}: memory=${memCount}, timeline=${teCount}, branchState=${bsCount}`)
      } catch (err: any) {
        app.log.error(`[Delete] Cascade cleanup failed: ${err.message}`)
      }
    }

    // 删除后重建图谱：用剩余最新章节的 snapshot 回退
    const { rebuildGraphFromSnapshot } = await import('../services/graph-snapshot.js')
    const prevChapter = await prisma.chapter.findFirst({
      where: { storyId: chapter.storyId, status: 'archived' },
      orderBy: { number: 'desc' }
    })
    if (prevChapter?.graphSnapshot) {
      try {
        const snapshot = safeJsonParse(prevChapter.graphSnapshot, null)
        if (snapshot) await rebuildGraphFromSnapshot(prisma, chapter.storyId, snapshot)
        app.log.info(`[Delete] Rebuilt graph from chapter ${prevChapter.number} snapshot`)
      } catch (err: any) {
        app.log.error(`[Delete] Graph rebuild failed: ${err.message}`)
      }
    } else {
      await prisma.graphEdge.deleteMany({ where: { storyId: chapter.storyId } })
      await prisma.graphNode.deleteMany({ where: { storyId: chapter.storyId } })
      app.log.info(`[Delete] Cleared all graph data for story ${chapter.storyId}`)
    }

    await prisma.chapter.delete({ where: { id: chapterId } })

    // 如果这是最后一个章节，清理故事级别的派生数据
    const remainingChapters = await prisma.chapter.count({
      where: { storyId: chapter.storyId }
    })
    if (remainingChapters === 0) {
      try {
        const { count: arcCount } = await prisma.plotArc.deleteMany({
          where: { storyId: chapter.storyId }
        })
        const { count: logCount } = await prisma.promptLog.deleteMany({
          where: { storyId: chapter.storyId }
        })
        // GraphNode/GraphEdge 已经在上面 else 分支清理，但如果走的是 rebuild 路径没清理，这里兜底
        const { count: edgeCount } = await prisma.graphEdge.deleteMany({
          where: { storyId: chapter.storyId }
        })
        const { count: nodeCount } = await prisma.graphNode.deleteMany({
          where: { storyId: chapter.storyId }
        })
        app.log.info(`[Delete] Last chapter removed. Cleaned plotArc=${arcCount}, promptLog=${logCount}, graphNode=${nodeCount}, graphEdge=${edgeCount}`)
      } catch (err: any) {
        app.log.error(`[Delete] Final cleanup failed: ${err.message}`)
      }
    }

    return { success: true }
  })

  // POST /api/chapters/:chapterId/develop
  // 保留 findUnique 内联 —— 需要 include: { story: true } 取 runtimeProfileId fallback。
  app.post('/api/chapters/:chapterId/develop', async (request, reply) => {
    const { chapterId } = request.params as any
    const body = parseBody(DevelopRequestSchema, request, reply)
    if (body === null) return

    const prisma = app.prisma

    const parentChapter = await prisma.chapter.findUnique({
      where: { id: chapterId },
      include: { story: true }
    })
    if (!parentChapter) return reply.status(404).send({ success: false, error: 'Chapter not found' })

    // 校验：只能从已归档的章节发展
    if (parentChapter.status !== 'archived') {
      return reply.status(400).send({ success: false, error: '只能从已归档的章节发展' })
    }

    const isSideStory = body.isSideStory === true

    // 已有子章节的只能发展番外
    const hasChildren = await prisma.chapter.count({ where: { parentChapterId: chapterId } })
    if (hasChildren > 0 && !isSideStory) {
      return reply.status(400).send({ success: false, error: '该章节已有后续章节，只能发展番外章节' })
    }

    // 主线只能从最新章节发展
    if (!isSideStory) {
      const lastChapter = await getLastChapter(prisma, parentChapter.storyId)
      if (lastChapter && lastChapter.id !== chapterId) {
        return reply.status(400).send({ success: false, error: '主线章节只能从最新章节继续发展' })
      }
    }

    // 计算新章节的序号
    let number: number
    if (isSideStory && body.number !== undefined) {
      // DevelopRequestSchema 已 narrow body.number 为 number,无需 parseFloat
      number = body.number
    } else if (isSideStory) {
      const allocated = await allocateSideStoryNumber(prisma, parentChapter.storyId, parentChapter.number)
      if (allocated < 0) {
        return reply.status(400).send({
          success: false,
          error: `该章节的番外数量已达上限（99个），建议归档整理或合并分支后再试`
        })
      }
      number = allocated
    } else {
      const lastSibling = await prisma.chapter.findFirst({
        where: { storyId: parentChapter.storyId, parentChapterId: chapterId },
        orderBy: { number: 'desc' }
      })
      number = lastSibling ? lastSibling.number + 1 : (parentChapter.number + 1)
    }

    const newChapter = await prisma.chapter.create({
      data: {
        storyId: parentChapter.storyId,
        parentChapterId: chapterId,
        number,
        isSideStory,
        title: body.title || (isSideStory ? `番外·${number}` : `第${Math.floor(number)}章`),
        outline: body.outline || '',
        status: 'draft',
        runtimeProfileId: body.runtimeProfileId || parentChapter.runtimeProfileId || parentChapter.story?.runtimeProfileId || null
      }
    })

    app.log.info(`[Develop] Chapter ${chapterId} → new chapter ${newChapter.id} (number=${number})`)
    return { success: true, data: newChapter }
  })
}