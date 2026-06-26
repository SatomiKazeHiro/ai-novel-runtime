import type { FastifyInstance } from 'fastify'

export async function timelineRoutes(app: FastifyInstance) {
  // GET /api/stories/:id/timeline
  app.get('/api/stories/:storyId/timeline', async (request, reply) => {
    const { storyId } = request.params as any
    const events = await app.prisma.timelineEvent.findMany({
      where: { storyId },
      orderBy: { position: 'asc' }
    })
    return { success: true, data: events }
  })

  // POST /api/stories/:id/timeline
  app.post('/api/stories/:storyId/timeline', async (request, reply) => {
    const { storyId } = request.params as any
    const body = request.body as any
    const event = await app.prisma.timelineEvent.create({
      data: {
        storyId,
        fromChapterNumber: body.fromChapterNumber,
        position: body.position,
        events: JSON.stringify(body.events || [])
      }
    })
    return { success: true, data: event }
  })

  // PUT /api/timeline/:eventId
  app.put('/api/timeline/:eventId', async (request, reply) => {
    const { eventId } = request.params as any
    const body = request.body as any
    const data: any = {}
    if (body.position !== undefined) data.position = body.position
    if (body.events !== undefined) data.events = JSON.stringify(body.events)
    const event = await app.prisma.timelineEvent.update({
      where: { id: eventId },
      data
    })
    return { success: true, data: event }
  })

  // DELETE /api/timeline/:eventId
  app.delete('/api/timeline/:eventId', async (request, reply) => {
    const { eventId } = request.params as any
    await app.prisma.timelineEvent.delete({ where: { id: eventId } })
    return { success: true }
  })
}
