import type { FastifyInstance } from 'fastify'

export async function memoryRoutes(app: FastifyInstance) {
  // GET /api/stories/:storyId/memory
  app.get('/api/stories/:storyId/memory', async (request, reply) => {
    const { storyId } = request.params as any
    const { layer } = request.query as any
    const where: any = { storyId }
    if (layer) where.layer = layer
    const items = await app.prisma.memory.findMany({
      where,
      include: { chapter: { select: { number: true, title: true } } },
      orderBy: { createdAt: 'desc' }
    })
    const data = items.map((m: any) => ({
      ...m,
      chapterNumber: m.chapter?.number,
      chapterTitle: m.chapter?.title
    }))
    return { success: true, data }
  })

  // POST /api/stories/:storyId/memory
  app.post('/api/stories/:storyId/memory', async (request, reply) => {
    const { storyId } = request.params as any
    const body = request.body as any
    const memory = await app.prisma.memory.create({
      data: {
        storyId,
        chapterId: body.chapterId,
        fromChapterNumber: body.fromChapterNumber,
        layer: body.layer,
        content: body.content,
        tags: JSON.stringify(body.tags || []),
        importance: body.importance || 5
      }
    })
    return { success: true, data: memory }
  })
}
