import type { FastifyInstance } from 'fastify'

export async function v2CharacterRoutes(app: FastifyInstance) {
  // GET /api/v2/characters?storyId=xxx
  app.get('/characters', async (request) => {
    const { storyId } = request.query as { storyId?: string }
    if (!storyId) {
      return { success: false, error: '缺少 storyId 参数' }
    }
    const characters = await app.prisma.v2Character.findMany({
      where: { storyId },
      include: {
        snapshots: { orderBy: { chapterNumber: 'desc' } }
      },
      orderBy: { createdAt: 'asc' }
    })
    return { success: true, data: characters }
  })

  // GET /api/v2/characters/:charId
  app.get('/characters/:charId', async (request) => {
    const { charId } = request.params as { charId: string }
    const character = await app.prisma.v2Character.findUnique({
      where: { id: charId },
      include: {
        snapshots: { orderBy: { chapterNumber: 'desc' } }
      }
    })
    if (!character) {
      return { success: false, error: '角色不存在' }
    }
    return { success: true, data: character }
  })

  // POST /api/v2/characters
  app.post('/characters', async (request) => {
    const body = request.body as any
    if (!body.storyId || !body.slug || !body.name) {
      return { success: false, error: '缺少必填字段 storyId/slug/name' }
    }
    const existing = await app.prisma.v2Character.findUnique({
      where: { storyId_slug: { storyId: body.storyId, slug: body.slug } }
    })
    if (existing) {
      return { success: false, error: `标识 "${body.slug}" 已存在` }
    }
    const character = await app.prisma.v2Character.create({
      data: {
        storyId: body.storyId,
        slug: body.slug,
        name: body.name,
        isProtagonist: body.isProtagonist ?? false,
        identity: JSON.stringify(body.identity || []),
        appearance: JSON.stringify(body.appearance || []),
        temperament: JSON.stringify(body.temperament || []),
        personality: JSON.stringify(body.personality || []),
        speechStyle: JSON.stringify(body.speechStyle || [])
      }
    })
    return { success: true, data: character }
  })

  // PUT /api/v2/characters/:charId
  app.put('/characters/:charId', async (request) => {
    const { charId } = request.params as { charId: string }
    const body = request.body as any
    const data: any = {}
    if (body.name !== undefined) data.name = body.name
    if (body.isProtagonist !== undefined) data.isProtagonist = body.isProtagonist
    if (body.identity !== undefined) data.identity = JSON.stringify(body.identity)
    if (body.appearance !== undefined) data.appearance = JSON.stringify(body.appearance)
    if (body.temperament !== undefined) data.temperament = JSON.stringify(body.temperament)
    if (body.personality !== undefined) data.personality = JSON.stringify(body.personality)
    if (body.speechStyle !== undefined) data.speechStyle = JSON.stringify(body.speechStyle)

    try {
      const character = await app.prisma.v2Character.update({
        where: { id: charId },
        data
      })
      return { success: true, data: character }
    } catch {
      return { success: false, error: '角色不存在' }
    }
  })

  // DELETE /api/v2/characters/:charId
  app.delete('/characters/:charId', async (request) => {
    const { charId } = request.params as { charId: string }
    try {
      await app.prisma.v2Character.delete({ where: { id: charId } })
      return { success: true }
    } catch {
      return { success: false, error: '角色不存在' }
    }
  })
}
