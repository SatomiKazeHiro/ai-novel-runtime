import type { FastifyInstance } from 'fastify'

export async function v2PromptLogRoutes(app: FastifyInstance) {
  app.get('/prompt-logs', async (_request, reply) => {
    return { success: true, data: null, message: 'V2 开发中' }
  })
}
