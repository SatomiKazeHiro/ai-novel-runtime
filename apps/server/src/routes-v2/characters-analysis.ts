import type { FastifyInstance } from 'fastify'

export async function v2CharacterAnalysisRoutes(app: FastifyInstance) {
  app.post('/chapters/:chapterId/analyze/characters', async (_request, reply) => {
    return { success: true, data: null, message: 'V2 开发中' }
  })
}
