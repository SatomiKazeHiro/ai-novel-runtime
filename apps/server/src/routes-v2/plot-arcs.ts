import type { FastifyInstance } from 'fastify'

export async function v2PlotArcRoutes(app: FastifyInstance) {
  app.get('/plot-arcs', async (_request, reply) => {
    return { success: true, data: null, message: 'V2 开发中' }
  })

  app.get('/plot-arcs/:arcId', async (_request, reply) => {
    return { success: true, data: null, message: 'V2 开发中' }
  })
}
