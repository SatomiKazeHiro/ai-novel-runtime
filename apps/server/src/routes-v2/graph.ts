import type { FastifyInstance } from 'fastify'

export async function v2GraphRoutes(app: FastifyInstance) {
  app.get('/graph', async (_request, reply) => {
    return { success: true, data: { nodes: [], edges: [] } }
  })
}
