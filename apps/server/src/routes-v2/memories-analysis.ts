import type { FastifyInstance } from 'fastify'

export async function v2MemoryAnalysisRoutes(app: FastifyInstance) {
  app.post('/chapters/:chapterId/analyze/memories', async (_request, reply) => {
    return { success: true, data: null, message: 'V2 开发中' }
  })
}
