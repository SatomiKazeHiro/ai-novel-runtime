import type { FastifyInstance } from 'fastify'

export async function characterRoutes(app: FastifyInstance) {
  // GET /api/stories/:id/characters
  app.get('/api/stories/:storyId/characters', async (request, reply) => {
    const { storyId } = request.params as any
    const characters = await app.prisma.character.findMany({
      where: { storyId },
      orderBy: { createdAt: 'asc' }
    })
    return { success: true, data: characters }
  })

  // POST /api/stories/:id/characters
  app.post('/api/stories/:storyId/characters', async (request, reply) => {
    const { storyId } = request.params as any
    const body = request.body as any
    const character = await app.prisma.character.create({
      data: {
        storyId,
        slug: body.slug,
        name: body.name,
        personality: JSON.stringify(body.personality || []),
        speechStyle: JSON.stringify(body.speechStyle || []),
        relationships: JSON.stringify(body.relationships || {}),
        status: JSON.stringify(body.status || {})
      }
    })
    return { success: true, data: character }
  })

  // PUT /api/characters/:charId
  app.put('/api/characters/:charId', async (request, reply) => {
    const { charId } = request.params as any
    const body = request.body as any
    const data: any = { name: body.name }
    if (body.personality !== undefined) data.personality = JSON.stringify(body.personality)
    if (body.speechStyle !== undefined) data.speechStyle = JSON.stringify(body.speechStyle)
    if (body.relationships !== undefined) data.relationships = JSON.stringify(body.relationships)
    if (body.status !== undefined) data.status = JSON.stringify(body.status)
    const character = await app.prisma.character.update({
      where: { id: charId },
      data
    })
    return { success: true, data: character }
  })

  // DELETE /api/characters/:charId
  app.delete('/api/characters/:charId', async (request, reply) => {
    const { charId } = request.params as any
    await app.prisma.character.delete({ where: { id: charId } })
    return { success: true }
  })
}
