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
}
