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

    // layer / category 枚举白名单校验（非法 → 400，避免 Prisma 枚举直接抛 500）
    const VALID_LAYERS = ['global', 'chapter', 'scene', 'temporary']
    const VALID_CATEGORIES = ['relationship_change', 'foreshadowing', 'emotional_change', 'event_memory', 'state']
    if (!body.layer || !VALID_LAYERS.includes(body.layer)) {
      return reply.status(400).send({ success: false, error: `非法的 layer: ${body.layer}` })
    }
    if (body.category && !VALID_CATEGORIES.includes(body.category)) {
      return reply.status(400).send({ success: false, error: `非法的 category: ${body.category}` })
    }

    const memory = await app.prisma.memory.create({
      data: {
        storyId,
        chapterId: body.chapterId,
        fromChapterNumber: body.fromChapterNumber,
        layer: body.layer,
        category: body.category || undefined,
        content: body.content,
        tags: JSON.stringify(body.tags || []),
        importance: body.importance || 5,
        participants: body.participants || null
      }
    })
    return { success: true, data: memory }
  })
}
