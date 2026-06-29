import type { FastifyInstance } from 'fastify'

export async function v2WorkerTaskRoutes(app: FastifyInstance) {
  app.get('/worker-tasks', async (_request, reply) => {
    return { success: true, data: null, message: 'V2 开发中' }
  })
}
