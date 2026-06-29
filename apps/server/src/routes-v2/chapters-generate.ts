import type { FastifyInstance } from 'fastify'

export async function v2ChapterGenerateRoutes(app: FastifyInstance) {
  app.get('/chapters/:chapterId/generate-stream', async (_request, reply) => {
    return { success: true, data: null, message: 'V2 开发中' }
  })
}
