import type { FastifyInstance } from 'fastify'

export async function v2LoreRoutes(app: FastifyInstance) {
  app.get('/lore', async (_request, reply) => {
    return { success: true, data: null, message: 'V2 开发中' }
  })

  app.post('/lore', async (_request, reply) => {
    return { success: true, data: null, message: 'V2 开发中' }
  })

  app.put('/lore/:loreId', async (_request, reply) => {
    return { success: true, data: null, message: 'V2 开发中' }
  })

  app.delete('/lore/:loreId', async (_request, reply) => {
    return { success: true, data: null, message: 'V2 开发中' }
  })
}
