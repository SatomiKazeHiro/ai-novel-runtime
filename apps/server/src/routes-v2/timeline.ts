import type { FastifyInstance } from 'fastify'

export async function v2TimelineRoutes(app: FastifyInstance) {
  app.get('/timeline', async (_request, reply) => {
    return { success: true, data: [] }
  })
}
