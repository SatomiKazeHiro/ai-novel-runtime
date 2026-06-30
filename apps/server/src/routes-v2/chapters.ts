import type { FastifyInstance } from 'fastify'
import { sha256 } from '../services-v2/hash.js'
import { getDefaultConfig } from '../services-v2/config-defaults.js'
import { assemblePrompt } from '../services-v2/prompt-assembler.js'
import { resolveProvider } from '../services/ai-provider-init.js'

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
    return { success: true, data: chapters }
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
      ? ['title', 'content', 'config']
      : []

    if (body.title !== undefined && editableFields.includes('title')) {
      data.title = body.title
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

  // POST /api/v2/chapters/:chapterId/config — 生成并保存默认配置
  app.post('/chapters/:chapterId/config', async (request) => {
    const { chapterId } = request.params as { chapterId: string }
    const existing = await app.prisma.v2Chapter.findUnique({ where: { id: chapterId } })
    if (!existing) {
      return { success: false, error: '章节不存在' }
    }
    if (existing.status === 'archived') {
      return { success: false, error: '已归档章节不可修改配置' }
    }
    const config = await getDefaultConfig(app.prisma, existing.storyId)
    await app.prisma.v2Chapter.update({
      where: { id: chapterId },
      data: { config: JSON.stringify(config) }
    })
    return { success: true, data: config }
  })

  // GET /api/v2/chapters/:chapterId/drafts — 候选文章列表
  app.get('/chapters/:chapterId/drafts', async (request) => {
    const { chapterId } = request.params as { chapterId: string }
    const drafts = await app.prisma.v2Draft.findMany({
      where: { chapterId },
      orderBy: { createdAt: 'desc' }
    })
    return { success: true, data: drafts }
  })

  // DELETE /api/v2/drafts/:draftId — 删除候选文章
  app.delete('/drafts/:draftId', async (request) => {
    const { draftId } = request.params as { draftId: string }
    const draft = await app.prisma.v2Draft.findUnique({
      where: { id: draftId },
      include: { chapter: { select: { status: true } } }
    })
    if (!draft) {
      return { success: false, error: '候选文章不存在' }
    }
    if (draft.chapter.status === 'archived') {
      return { success: false, error: '已归档章节的候选文章不可删除' }
    }
    await app.prisma.v2Draft.delete({ where: { id: draftId } })
    return { success: true }
  })

  // POST /api/v2/chapters/:chapterId/generate — SSE 流式生成候选文章
  app.post('/chapters/:chapterId/generate', async (request, reply) => {
    const { chapterId } = request.params as { chapterId: string }

    const existing = await app.prisma.v2Chapter.findUnique({ where: { id: chapterId } })
    if (!existing) {
      return reply.status(404).send({ success: false, error: '章节不存在' })
    }
    if (existing.status === 'archived') {
      return reply.status(400).send({ success: false, error: '已归档章节不可生成' })
    }

    // 限制同时生成中的候选数 ≤ 3
    const generatingCount = await app.prisma.v2Draft.count({
      where: { chapterId, status: 'generating' }
    })
    if (generatingCount >= 3) {
      return reply.status(400).send({ success: false, error: '已有 3 个候选正在生成中，请等待或删除后再试' })
    }

    // 组装 prompt
    let config: any = {}
    try { config = JSON.parse(existing.config || '{}') } catch { /* keep empty */ }
    if (!config.characterIds) config.characterIds = []
    if (!config.memoryTypeIds) config.memoryTypeIds = []
    if (!config.plotArcIds) config.plotArcIds = []
    if (!config.loreIds) config.loreIds = []

    const { systemMessage, userMessage } = await assemblePrompt(app.prisma, existing.storyId, config)

    // 创建 draft
    const draft = await app.prisma.v2Draft.create({
      data: { chapterId, content: '', status: 'generating' }
    })

    // 设置 SSE 响应头
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no'
    })

    const send = (event: string, data: any) => {
      reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
    }

    send('draft-start', { draftId: draft.id })

    try {
      const resolved = await resolveProvider(app.prisma, existing.storyId, chapterId)
      if (!resolved?.provider?.streamGenerate) {
        send('draft-error', { draftId: draft.id, error: '无可用 AI Provider' })
        reply.raw.end()
        return
      }

      let fullContent = ''
      for await (const delta of resolved.provider.streamGenerate(userMessage, { system: systemMessage })) {
        fullContent += delta
        send('draft-chunk', { draftId: draft.id, delta })
      }

      await app.prisma.v2Draft.update({
        where: { id: draft.id },
        data: { content: fullContent, status: 'completed' }
      })
      send('draft-done', { draftId: draft.id })
    } catch (err: any) {
      await app.prisma.v2Draft.update({
        where: { id: draft.id },
        data: { status: 'failed' }
      }).catch(() => { /* 更新失败不覆盖原始错误 */ })
      send('draft-error', { draftId: draft.id, error: err.message })
    }

    reply.raw.end()
  })

  // DELETE /api/v2/chapters/:chapterId
  app.delete('/chapters/:chapterId', async (request) => {
    const { chapterId } = request.params as { chapterId: string }
    const existing = await app.prisma.v2Chapter.findUnique({ where: { id: chapterId } })
    if (!existing) {
      return { success: false, error: '章节不存在' }
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
    await app.prisma.v2Chapter.delete({ where: { id: chapterId } })
    return { success: true }
  })
}
