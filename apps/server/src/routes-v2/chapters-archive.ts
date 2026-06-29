import type { FastifyInstance } from 'fastify'

export async function v2ChapterArchiveRoutes(app: FastifyInstance) {
  app.post('/chapters/:chapterId/archive', async (_request, reply) => {
    return { success: true, data: null, message: 'V2 开发中' }
  })
}
