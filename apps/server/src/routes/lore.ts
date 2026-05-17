import type { FastifyInstance } from 'fastify'

export async function loreRoutes(app: FastifyInstance) {
  // GET /api/stories/:id/lore
  app.get('/api/stories/:storyId/lore', async (request, reply) => {
    const { storyId } = request.params as any
    const { category } = request.query as any
    const where: any = { storyId }
    if (category) where.category = category
    const items = await app.prisma.loreItem.findMany({
      where,
      orderBy: { createdAt: 'asc' }
    })
    return { success: true, data: items }
  })

  // POST /api/stories/:id/lore
  app.post('/api/stories/:storyId/lore', async (request, reply) => {
    const { storyId } = request.params as any
    const body = request.body as any
    const item = await app.prisma.loreItem.create({
      data: {
        storyId,
        category: body.category,
        slug: body.slug,
        name: body.name,
        content: body.content,
        metadata: JSON.stringify(body.metadata || {})
      }
    })
    return { success: true, data: item }
  })

  // PUT /api/lore/:itemId
  app.put('/api/lore/:itemId', async (request, reply) => {
    const { itemId } = request.params as any
    const body = request.body as any
    const data: any = { name: body.name, content: body.content }
    if (body.metadata !== undefined) data.metadata = JSON.stringify(body.metadata)
    const item = await app.prisma.loreItem.update({
      where: { id: itemId },
      data
    })
    return { success: true, data: item }
  })

  // DELETE /api/lore/:itemId
  app.delete('/api/lore/:itemId', async (request, reply) => {
    const { itemId } = request.params as any
    await app.prisma.loreItem.delete({ where: { id: itemId } })
    return { success: true }
  })
}
