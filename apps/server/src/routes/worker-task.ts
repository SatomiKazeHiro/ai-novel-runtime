import type { FastifyInstance } from 'fastify'

export async function workerTaskRoutes(app: FastifyInstance) {
  // GET /api/worker-tasks — 列出所有
  app.get('/api/worker-tasks', async (request, reply) => {
    const { storyId, workerType } = request.query as any
    const where: any = {}
    if (storyId) where.storyId = storyId
    if (workerType) where.workerType = workerType
    const tasks = await app.prisma.workerTask.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: { story: { select: { id: true, title: true } } }
    })
    return { success: true, data: tasks }
  })

  // GET /api/worker-tasks/by-type/:workerType — 按类型列出（system + custom）
  app.get('/api/worker-tasks/by-type/:workerType', async (request, reply) => {
    const { workerType } = request.params as any
    const tasks = await app.prisma.workerTask.findMany({
      where: {
        workerType,
        OR: [
          { type: 'system' },
          { type: 'custom', storyId: null }
        ]
      },
      orderBy: [
        { type: 'asc' },
        { createdAt: 'desc' }
      ]
    })
    return { success: true, data: tasks }
  })

  // GET /api/worker-tasks/:id
  app.get('/api/worker-tasks/:id', async (request, reply) => {
    const { id } = request.params as any
    const task = await app.prisma.workerTask.findUnique({ where: { id } })
    if (!task) return reply.status(404).send({ success: false, error: 'Task not found' })
    return { success: true, data: task }
  })

  // POST /api/worker-tasks
  app.post('/api/worker-tasks', async (request, reply) => {
    const body = request.body as any
    const task = await app.prisma.workerTask.create({
      data: {
        storyId: body.storyId || null,
        type: body.type || 'custom',
        name: body.name || '',
        workerType: body.workerType,
        taskPrompt: body.taskPrompt,
        enabled: body.enabled !== undefined ? body.enabled : true
      },
      include: { story: { select: { id: true, title: true } } }
    })
    return { success: true, data: task }
  })

  // PUT /api/worker-tasks/:id
  app.put('/api/worker-tasks/:id', async (request, reply) => {
    const { id } = request.params as any
    const body = request.body as any
    const data: any = {}
    if (body.name !== undefined) data.name = body.name
    if (body.workerType !== undefined) data.workerType = body.workerType
    if (body.taskPrompt !== undefined) data.taskPrompt = body.taskPrompt
    if (body.enabled !== undefined) data.enabled = body.enabled
    const task = await app.prisma.workerTask.update({
      where: { id },
      data,
      include: { story: { select: { id: true, title: true } } }
    })
    return { success: true, data: task }
  })

  // DELETE /api/worker-tasks/:id
  app.delete('/api/worker-tasks/:id', async (request, reply) => {
    const { id } = request.params as any
    await app.prisma.workerTask.delete({ where: { id } })
    return { success: true }
  })

  // GET /api/worker-tasks/stories/:storyId/bindings — 获取小说的 WorkerTask 绑定
  app.get('/api/worker-tasks/stories/:storyId/bindings', async (request, reply) => {
    const { storyId } = request.params as any
    const bindings = await app.prisma.storyWorkerBinding.findMany({
      where: { storyId },
      include: { workerTask: true }
    })
    return { success: true, data: bindings }
  })

  // PUT /api/worker-tasks/stories/:storyId/bindings — 更新/创建绑定
  app.put('/api/worker-tasks/stories/:storyId/bindings', async (request, reply) => {
    const { storyId } = request.params as any
    const body = request.body as any
    const workerType = body.workerType
    const workerTaskId = body.workerTaskId

    if (!workerType || !workerTaskId) {
      return reply.status(400).send({ success: false, error: 'workerType and workerTaskId are required' })
    }

    const binding = await app.prisma.storyWorkerBinding.upsert({
      where: {
        storyId_workerType: {
          storyId,
          workerType
        }
      },
      create: {
        storyId,
        workerType,
        workerTaskId
      },
      update: {
        workerTaskId
      },
      include: { workerTask: true }
    })

    return { success: true, data: binding }
  })
}
