import type { FastifyInstance } from 'fastify'
import { sha256 } from '../services-v2/hash.js'
import { getDefaultConfig } from '../services-v2/config-defaults.js'

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
