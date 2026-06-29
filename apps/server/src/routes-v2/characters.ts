import type { FastifyInstance } from 'fastify'

export async function v2CharacterRoutes(app: FastifyInstance) {
  app.get('/characters', async (_request, reply) => {
    return { success: true, data: null, message: 'V2 开发中' }
  })

  app.get('/characters/:charId', async (_request, reply) => {
    return { success: true, data: null, message: 'V2 开发中' }
  })

  app.post('/characters', async (_request, reply) => {
    return { success: true, data: null, message: 'V2 开发中' }
  })

  app.put('/characters/:charId', async (_request, reply) => {
    return { success: true, data: null, message: 'V2 开发中' }
  })

  app.delete('/characters/:charId', async (_request, reply) => {
    return { success: true, data: null, message: 'V2 开发中' }
  })
}
