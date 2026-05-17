import type { FastifyInstance } from 'fastify'

export async function storyRoutes(app: FastifyInstance) {
  // GET /stories
  app.get('/', async (request, reply) => {
    const stories = await app.prisma.story.findMany({
      orderBy: { updatedAt: 'desc' },
      include: {
        _count: { select: { chapters: true, characters: true } },
        runtimeProfile: { select: { id: true, name: true } }
      }
    })
    return { success: true, data: stories }
  })

  // POST /stories
  app.post('/', async (request, reply) => {
    const body = request.body as any
    const story = await app.prisma.story.create({
      data: {
        title: body.title,
        description: body.description || '',
        runtimeProfileId: body.runtimeProfileId || null
      },
      include: {
        _count: { select: { chapters: true, characters: true } },
        runtimeProfile: { select: { id: true, name: true } }
      }
    })
    return { success: true, data: story }
  })

  // GET /stories/:id
  app.get('/:id', async (request, reply) => {
    const { id } = request.params as any
    const story = await app.prisma.story.findUnique({
      where: { id },
      include: {
        chapters: { orderBy: { number: 'asc' } },
        characters: true,
        loreItems: true,
        timelineEvents: { orderBy: { day: 'asc' } }
      }
    })
    if (!story) return reply.status(404).send({ success: false, error: 'Story not found' })
    return { success: true, data: story }
  })

  // PUT /stories/:id
  app.put('/:id', async (request, reply) => {
    const { id } = request.params as any
    const body = request.body as any
    const story = await app.prisma.story.update({
      where: { id },
      data: {
        title: body.title,
        description: body.description,
        status: body.status,
        runtimeProfileId: body.runtimeProfileId !== undefined ? body.runtimeProfileId : undefined
      },
      include: {
        _count: { select: { chapters: true, characters: true } },
        runtimeProfile: { select: { id: true, name: true } }
      }
    })
    return { success: true, data: story }
  })

  // GET /stories/:id/plot-arcs
  app.get('/:id/plot-arcs', async (request, reply) => {
    const { id } = request.params as any
    const arcs = await app.prisma.plotArc.findMany({
      where: { storyId: id },
      orderBy: [
        { type: 'asc' },
        { progress: 'desc' }
      ]
    })
    return { success: true, data: arcs }
  })

  // DELETE /stories/:id
  app.delete('/:id', async (request, reply) => {
    const { id } = request.params as any
    await app.prisma.story.delete({ where: { id } })
    return { success: true }
  })
}
