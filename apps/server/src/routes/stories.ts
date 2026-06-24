import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { UPLOADS_ROOT } from '../config/paths.js'
import { saveCover, deleteCover, deleteCoversByStoryId } from '../lib/cover-storage.js'

const MIME_TO_EXT: Record<string, 'jpg' | 'png' | 'webp'> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp'
}

const createStorySchema = z.object({
  title: z.string().min(1, '标题不能为空'),
  description: z.string().optional(),
  runtimeProfileId: z.string().nullable().optional(),
  aiProviderConfigId: z.string().nullable().optional()
})

const updateStorySchema = z.object({
  title: z.string().min(1, '标题不能为空').optional(),
  description: z.string().optional(),
  status: z.enum(['active', 'archived', 'deleted']).optional(),
  runtimeProfileId: z.string().nullable().optional(),
  aiProviderConfigId: z.string().nullable().optional()
})

export async function storyRoutes(app: FastifyInstance) {
  // GET /stories
  app.get('/', async (request, reply) => {
    const stories = await app.prisma.story.findMany({
      orderBy: { updatedAt: 'desc' },
      include: {
        _count: { select: { chapters: true, characters: true } },
        runtimeProfile: { select: { id: true, name: true } },
        defaultAiProvider: { select: { id: true, name: true, model: true } }
      }
    })
    return { success: true, data: stories }
  })

  // POST /stories
  app.post('/', async (request, reply) => {
    const parseResult = createStorySchema.safeParse(request.body)
    if (!parseResult.success) {
      return reply.status(400).send({ success: false, error: parseResult.error.errors.map(e => e.message).join('; ') })
    }
    const body = parseResult.data
    const story = await app.prisma.story.create({
      data: {
        title: body.title,
        description: body.description || '',
        runtimeProfileId: body.runtimeProfileId || null,
        aiProviderConfigId: body.aiProviderConfigId || null
      },
      include: {
        _count: { select: { chapters: true, characters: true } },
        runtimeProfile: { select: { id: true, name: true } },
        defaultAiProvider: { select: { id: true, name: true, model: true } }
      }
    })

    // 自动为小说绑定系统默认的 WorkerTask
    const systemTasks = await app.prisma.workerTask.findMany({
      where: { type: 'system', enabled: true }
    })
    for (const task of systemTasks) {
      await app.prisma.storyWorkerBinding.create({
        data: {
          storyId: story.id,
          workerType: task.workerType,
          workerTaskId: task.id
        }
      })
    }

    return { success: true, data: story }
  })

  // GET /stories/:id
  app.get('/:id', async (request, reply) => {
    const { id } = request.params as any
    const story = await app.prisma.story.findUnique({
      where: { id },
      include: {
        chapters: { orderBy: { number: 'asc' } },
        characters: true,
        loreItems: true,
        timelineEvents: { orderBy: { day: 'asc' } }
      }
    })
    if (!story) return reply.status(404).send({ success: false, error: 'Story not found' })
    return { success: true, data: story }
  })

  // PUT /stories/:id
  app.put('/:id', async (request, reply) => {
    const { id } = request.params as any

    // 解析 body: multipart 或 JSON
    const body: Record<string, any> = {}
    let coverFile: { mimetype: string; content: Buffer } | undefined
    let removeCover = false

    if (typeof (request as any).isMultipart === 'function' && (request as any).isMultipart()) {
      const parts = (request as any).parts()
      for await (const part of parts) {
        if (part.type === 'file') {
          if (part.fieldname !== 'cover') continue
          coverFile = {
            mimetype: part.mimetype,
            content: await part.toBuffer()
          }
        } else if (part.type === 'field') {
          if (part.fieldname === 'removeCover') {
            removeCover = part.value === 'true'
          } else {
            body[part.fieldname] = part.value
          }
        }
      }
    } else {
      Object.assign(body, request.body || {})
    }

    const parseResult = updateStorySchema.safeParse(body)
    if (!parseResult.success) {
      return reply.status(400).send({ success: false, error: parseResult.error.errors.map((e: any) => e.message).join('; ') })
    }
    const data: Record<string, any> = { ...parseResult.data }

    // 拉一次当前 coverUrl, 用于旧文件清理和 removeCover 单独使用
    const previous = await app.prisma.story.findUnique({
      where: { id },
      select: { coverUrl: true }
    })
    const previousCoverUrl = previous?.coverUrl ?? null

    if (coverFile) {
      const ext = MIME_TO_EXT[coverFile.mimetype]
      if (!ext) {
        return reply.status(415).send({ success: false, error: `不支持的图片格式: ${coverFile.mimetype}` })
      }
      const newUrl = await saveCover(UPLOADS_ROOT, id, Date.now(), ext, coverFile.content)
      data.coverUrl = newUrl
      // 新文件成功保存后再清旧文件,顺序保证: 如果 saveCover 抛错则不会删旧
      if (removeCover || previousCoverUrl) {
        await deleteCover(UPLOADS_ROOT, previousCoverUrl)
      }
    } else if (removeCover) {
      await deleteCover(UPLOADS_ROOT, previousCoverUrl)
      data.coverUrl = null
    }

    try {
      const story = await app.prisma.story.update({
        where: { id },
        data,
        include: {
          _count: { select: { chapters: true, characters: true } },
          runtimeProfile: { select: { id: true, name: true } }
        }
      })
      return { success: true, data: story }
    } catch (err: any) {
      // DB 写失败: 如果刚刚 saveCover 写入过新文件, 立即 unlink 避免孤儿
      if (data.coverUrl && data.coverUrl !== previousCoverUrl) {
        await deleteCover(UPLOADS_ROOT, data.coverUrl).catch(() => undefined)
      }
      return reply.status(500).send({ success: false, error: err.message || 'Internal Server Error' })
    }
  })

  // GET /stories/:id/plot-arcs
  app.get('/:id/plot-arcs', async (request, reply) => {
    const { id } = request.params as any
    const arcs = await app.prisma.plotArc.findMany({
      where: { storyId: id },
      orderBy: [
        { type: 'asc' },
        { progress: 'desc' }
      ]
    })
    return { success: true, data: arcs }
  })

  // DELETE /stories/:id
  app.delete('/:id', async (request, reply) => {
    const { id } = request.params as { id: string }
    await app.prisma.story.delete({ where: { id } })
    try {
      await deleteCoversByStoryId(UPLOADS_ROOT, id)
    } catch (err) {
      app.log.warn({ err, storyId: id }, 'cascade cover cleanup failed')
    }
    return { success: true }
  })
}
