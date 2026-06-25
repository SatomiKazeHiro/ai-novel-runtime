import type { FastifyInstance } from 'fastify'
import { UPLOADS_ROOT } from '../config/paths.js'
import { deleteCover } from '../lib/cover-storage.js'

export async function coverRoutes(app: FastifyInstance) {
  app.delete('/api/stories/:storyId/cover', async (request, reply) => {
    const { storyId } = request.params as { storyId: string }
    const story = await app.prisma.story.findUnique({
      where: { id: storyId },
      select: { id: true, coverUrl: true }
    })
    if (!story) {
      return reply.status(404).send({ success: false, error: 'Story not found' })
    }
    await deleteCover(UPLOADS_ROOT, story.coverUrl)
    await app.prisma.story.update({
      where: { id: storyId },
      data: { coverUrl: null }
    })
    return { success: true }
  })
}