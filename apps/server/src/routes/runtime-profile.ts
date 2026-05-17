import type { FastifyInstance } from 'fastify'

export async function runtimeProfileRoutes(app: FastifyInstance) {
  // GET /api/runtime-profiles — 列出所有（含全局默认）
  app.get('/api/runtime-profiles', async (request, reply) => {
    const { storyId } = request.query as any
    const where: any = {}
    if (storyId) where.storyId = storyId
    const profiles = await app.prisma.runtimeProfile.findMany({ where, orderBy: { createdAt: 'desc' } })
    return { success: true, data: profiles }
  })

  // GET /api/runtime-profiles/:id
  app.get('/api/runtime-profiles/:id', async (request, reply) => {
    const { id } = request.params as any
    const profile = await app.prisma.runtimeProfile.findUnique({ where: { id } })
    if (!profile) return reply.status(404).send({ success: false, error: 'Profile not found' })
    return { success: true, data: profile }
  })

  // POST /api/runtime-profiles
  app.post('/api/runtime-profiles', async (request, reply) => {
    const body = request.body as any
    const profile = await app.prisma.runtimeProfile.create({
      data: {
        storyId: body.storyId || null,
        name: body.name,
        identity: body.identity,
        settings: JSON.stringify(body.settings || {}),
        behavior: body.behavior,
        jailbreak: body.jailbreak || null,
        isDefault: body.isDefault || false
      }
    })
    return { success: true, data: profile }
  })

  // PUT /api/runtime-profiles/:id
  app.put('/api/runtime-profiles/:id', async (request, reply) => {
    const { id } = request.params as any
    const body = request.body as any
    const data: any = {}
    if (body.name !== undefined) data.name = body.name
    if (body.identity !== undefined) data.identity = body.identity
    if (body.settings !== undefined) data.settings = JSON.stringify(body.settings)
    if (body.behavior !== undefined) data.behavior = body.behavior
    if (body.jailbreak !== undefined) data.jailbreak = body.jailbreak
    if (body.isDefault !== undefined) data.isDefault = body.isDefault
    const profile = await app.prisma.runtimeProfile.update({ where: { id }, data })
    return { success: true, data: profile }
  })

  // DELETE /api/runtime-profiles/:id
  app.delete('/api/runtime-profiles/:id', async (request, reply) => {
    const { id } = request.params as any
    await app.prisma.runtimeProfile.delete({ where: { id } })
    return { success: true }
  })
}
