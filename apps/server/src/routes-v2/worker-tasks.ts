import type { FastifyInstance } from 'fastify'

export async function v2WorkerTaskRoutes(app: FastifyInstance) {
  // GET /api/v2/worker-tasks — 列出所有 WorkerTask
  app.get('/worker-tasks', async (request) => {
    const { workerType } = request.query as { workerType?: string }
    const where: any = {}
    if (workerType) where.workerType = workerType
    const tasks = await app.prisma.workerTask.findMany({
      where,
      orderBy: { createdAt: 'desc' }
    })
    return { success: true, data: tasks }
  })

  // GET /api/v2/worker-tasks/:storyId/bindings — 获取小说绑定
  app.get('/worker-tasks/:storyId/bindings', async (request) => {
    const { storyId } = request.params as { storyId: string }
    const bindings = await app.prisma.storyWorkerBinding.findMany({
      where: { storyId },
      include: { workerTask: true }
    })
    return { success: true, data: bindings }
  })

  // PUT /api/v2/worker-tasks/:storyId/bindings — 更新绑定
  app.put('/worker-tasks/:storyId/bindings', async (request) => {
    const { storyId } = request.params as { storyId: string }
    const body = request.body as any
    if (!body.workerType || !body.workerTaskId) {
      return { success: false, error: 'workerType 和 workerTaskId 为必填项' }
    }
    const binding = await app.prisma.storyWorkerBinding.upsert({
      where: { storyId_workerType: { storyId, workerType: body.workerType } },
      create: { storyId, workerType: body.workerType, workerTaskId: body.workerTaskId },
      update: { workerTaskId: body.workerTaskId },
      include: { workerTask: true }
    })
    return { success: true, data: binding }
  })
}
