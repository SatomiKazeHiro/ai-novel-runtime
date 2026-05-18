import type { FastifyInstance } from 'fastify'

export async function promptLogRoutes(app: FastifyInstance) {
  // GET /api/stories/:storyId/prompt-logs
  app.get('/api/stories/:storyId/prompt-logs', async (request, reply) => {
    const { storyId } = request.params as any
    const query = request.query as any
    const callType = query.callType as string | undefined
    const page = Math.max(1, parseInt(query.page || '1', 10))
    const pageSize = Math.min(100, Math.max(1, parseInt(query.pageSize || '20', 10)))

    const where: any = { storyId }
    if (callType) where.callType = callType

    const [items, total] = await Promise.all([
      app.prisma.promptLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize
      }),
      app.prisma.promptLog.count({ where })
    ])

    return { success: true, data: { items, total, page, pageSize } }
  })

  // GET /api/prompt-logs/:promptLogId
  app.get('/api/prompt-logs/:promptLogId', async (request, reply) => {
    const { promptLogId } = request.params as any
    const log = await app.prisma.promptLog.findUnique({ where: { id: promptLogId } })
    if (!log) return reply.status(404).send({ success: false, error: 'Prompt log not found' })
    return { success: true, data: log }
  })
}
