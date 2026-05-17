import type { FastifyInstance } from 'fastify'

export async function draftRoutes(app: FastifyInstance) {
  // GET /api/chapters/:chapterId/drafts
  app.get('/api/chapters/:chapterId/drafts', async (request, reply) => {
    const { chapterId } = request.params as any
    const drafts = await app.prisma.draft.findMany({
      where: { chapterId },
      orderBy: { createdAt: 'desc' }
    })
    return { success: true, data: drafts }
  })

  // GET /api/drafts/:draftId
  app.get('/api/drafts/:draftId', async (request, reply) => {
    const { draftId } = request.params as any
    const draft = await app.prisma.draft.findUnique({ where: { id: draftId } })
    if (!draft) return reply.status(404).send({ success: false, error: 'Draft not found' })
    return { success: true, data: draft }
  })


}
