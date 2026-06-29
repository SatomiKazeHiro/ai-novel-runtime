import type { FastifyInstance } from 'fastify'

export async function v2PlotArcAnalysisRoutes(app: FastifyInstance) {
  app.post('/chapters/:chapterId/analyze/plot-arcs', async (_request, reply) => {
    return { success: true, data: null, message: 'V2 开发中' }
  })
}
