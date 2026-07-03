import type { FastifyInstance } from 'fastify'

export async function v2PromptLogRoutes(app: FastifyInstance) {
  // GET /api/v2/prompt-logs?storyId=xxx&callType=xxx&page=1&pageSize=20
  app.get('/prompt-logs', async (request) => {
    const query = request.query as any
    const storyId = query.storyId as string | undefined
    if (!storyId) return { success: false, error: '缺少 storyId 参数' }

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

  // GET /api/v2/prompt-logs/:logId
  app.get('/prompt-logs/:logId', async (request) => {
    const { logId } = request.params as { logId: string }
    const log = await app.prisma.promptLog.findUnique({ where: { id: logId } })
    if (!log) return { success: false, error: '日志不存在' }
    return { success: true, data: log }
  })
}
