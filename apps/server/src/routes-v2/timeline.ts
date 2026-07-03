import type { FastifyInstance } from 'fastify'

export async function v2TimelineRoutes(app: FastifyInstance) {
  // GET /api/v2/timeline?storyId=xxx
  app.get('/timeline', async (request) => {
    const { storyId } = request.query as { storyId?: string }
    if (!storyId) return { success: false, error: '缺少 storyId 参数' }

    const anchors = await app.prisma.v2TimelineAnchor.findMany({
      where: { storyId },
      include: {
        events: {
          orderBy: { narrativeOrder: 'asc' }
        }
      },
      orderBy: { createdAt: 'asc' }
    })

    return { success: true, data: anchors }
  })
}
