import type { FastifyInstance } from 'fastify'

export async function v2PlotArcRoutes(app: FastifyInstance) {
  // GET /api/v2/plot-arcs?storyId=xxx&status=xxx
  app.get('/plot-arcs', async (request) => {
    const { storyId, status } = request.query as {
      storyId?: string; status?: string
    }
    if (!storyId) {
      return { success: false, error: '缺少 storyId 参数' }
    }
    const where: any = { storyId }
    if (status) where.status = status

    const items = await app.prisma.v2PlotArc.findMany({
      where,
      orderBy: { firstChapterNumber: 'asc' }
    })
    return { success: true, data: items }
  })

  // GET /api/v2/plot-arcs/:arcId
  app.get('/plot-arcs/:arcId', async (request) => {
    const { arcId } = request.params as { arcId: string }
    const arc = await app.prisma.v2PlotArc.findUnique({
      where: { id: arcId }
    })
    if (!arc) {
      return { success: false, error: '弧线不存在' }
    }
    return { success: true, data: arc }
  })
}
