import type { FastifyInstance } from 'fastify'

export async function healthRoutes(app: FastifyInstance) {
  app.get('/', async () => {
    return { success: true, message: 'ok', timestamp: new Date().toISOString() }
  })
}
