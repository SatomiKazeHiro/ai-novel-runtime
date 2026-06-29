import type { FastifyInstance } from 'fastify'

export async function v2ChapterAnalysisRoutes(app: FastifyInstance) {
  app.get('/chapters/:chapterId/analysis-status', async (_request, reply) => {
    return { success: true, data: null, message: 'V2 开发中' }
  })
}
