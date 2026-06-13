import type { FastifyInstance } from 'fastify'
import { z } from 'zod'

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
    const parseResult = updateStorySchema.safeParse(request.body)
    if (!parseResult.success) {
      return reply.status(400).send({ success: false, error: parseResult.error.errors.map(e => e.message).join('; ') })
    }
    const body = parseResult.data
    const story = await app.prisma.story.update({
      where: { id },
      data: {
        title: body.title,
        description: body.description,
        status: body.status,
        runtimeProfileId: body.runtimeProfileId !== undefined ? body.runtimeProfileId : undefined,
        aiProviderConfigId: body.aiProviderConfigId !== undefined ? body.aiProviderConfigId : undefined
      },
      include: {
        _count: { select: { chapters: true, characters: true } },
        runtimeProfile: { select: { id: true, name: true } }
      }
    })
    return { success: true, data: story }
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
    const { id } = request.params as any
    await app.prisma.story.delete({ where: { id } })
    return { success: true }
  })
}
