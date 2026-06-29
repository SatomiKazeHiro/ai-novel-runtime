import type { FastifyInstance } from 'fastify'

export async function v2MemoryRoutes(app: FastifyInstance) {
  app.get('/memories', async (_request, reply) => {
    return { success: true, data: null, message: 'V2 开发中' }
  })

  app.post('/memories/temporary', async (_request, reply) => {
    return { success: true, data: null, message: 'V2 开发中' }
  })

  app.put('/memories/temporary/:memId', async (_request, reply) => {
    return { success: true, data: null, message: 'V2 开发中' }
  })

  app.delete('/memories/temporary/:memId', async (_request, reply) => {
    return { success: true, data: null, message: 'V2 开发中' }
  })
}
