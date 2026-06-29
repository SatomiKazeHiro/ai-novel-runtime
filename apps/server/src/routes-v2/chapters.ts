import type { FastifyInstance } from 'fastify'

export async function v2ChapterRoutes(app: FastifyInstance) {
  app.get('/chapters', async (_request, reply) => {
    return { success: true, data: null, message: 'V2 开发中' }
  })

  app.post('/chapters', async (_request, reply) => {
    return { success: true, data: null, message: 'V2 开发中' }
  })

  app.get('/chapters/:chapterId', async (_request, reply) => {
    return { success: true, data: null, message: 'V2 开发中' }
  })

  app.put('/chapters/:chapterId', async (_request, reply) => {
    return { success: true, data: null, message: 'V2 开发中' }
  })

  app.delete('/chapters/:chapterId', async (_request, reply) => {
    return { success: true, data: null, message: 'V2 开发中' }
  })
}
