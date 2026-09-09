import type { FastifyInstance } from 'fastify'

export async function plotArcRoutes(app: FastifyInstance) {
  // GET /api/stories/:storyId/plot-arcs — 弧线管理页：查所有弧线 + 推进点
  app.get('/api/stories/:storyId/plot-arcs', async (request) => {
    const { storyId } = request.params as any
    const arcs = await app.prisma.plotArc.findMany({
      where: { storyId },
      include: { progressPoints: { orderBy: { chapterNumber: 'asc' } } },
      orderBy: [{ status: 'asc' }, { firstChapterNumber: 'asc' }]
    })
    return { success: true, data: arcs }
  })

  // PUT /api/plot-arcs/:arcId/close — 用户手动关闭（区别于 AI 相似关闭）
  app.put('/api/plot-arcs/:arcId/close', async (request) => {
    const { arcId } = request.params as any
    const arc = await app.prisma.plotArc.findUnique({ where: { id: arcId } })
    if (!arc) return { success: false, error: '弧线不存在' }
    await app.prisma.plotArc.update({
      where: { id: arcId },
      data: { status: 'closed', closedBy: 'user', closedTargetArcId: null }
    })
    return { success: true }
  })
}
