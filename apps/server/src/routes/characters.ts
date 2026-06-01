import type { FastifyInstance } from 'fastify'

export async function characterRoutes(app: FastifyInstance) {
  // GET /api/stories/:id/characters
  app.get('/api/stories/:storyId/characters', async (request, reply) => {
    const { storyId } = request.params as any
    const characters = await app.prisma.character.findMany({
      where: { storyId },
      include: { branchStates: { orderBy: { fromChapterNumber: 'desc' } } },
      orderBy: { createdAt: 'asc' }
    })
    return { success: true, data: characters }
  })

  // POST /api/stories/:id/characters
  app.post('/api/stories/:storyId/characters', async (request, reply) => {
    const { storyId } = request.params as any
    const body = request.body as any
    const character = await app.prisma.character.create({
      data: {
        storyId,
        slug: body.slug,
        name: body.name,
        protagonist: body.protagonist ?? false,
        personality: JSON.stringify(body.personality || []),
        speechStyle: JSON.stringify(body.speechStyle || []),
        identity: JSON.stringify(body.identity || []),
        appearance: JSON.stringify(body.appearance || []),
        temperament: JSON.stringify(body.temperament || [])
      }
    })

    // 如果提供了初始状态，创建 CharacterBranchState（fromChapterNumber 为 null 表示初始状态）
    if (body.status !== undefined || body.relationships !== undefined) {
      await app.prisma.characterBranchState.create({
        data: {
          characterId: character.id,
          fromChapterNumber: null,
          status: JSON.stringify(body.status || {}),
          relationships: JSON.stringify(body.relationships || {})
        }
      })
    }

    return { success: true, data: character }
  })

  // PUT /api/characters/:charId
  app.put('/api/characters/:charId', async (request, reply) => {
    const { charId } = request.params as any
    const body = request.body as any
    const data: any = { name: body.name }
    if (body.protagonist !== undefined) data.protagonist = body.protagonist
    if (body.personality !== undefined) data.personality = JSON.stringify(body.personality)
    if (body.speechStyle !== undefined) data.speechStyle = JSON.stringify(body.speechStyle)
    if (body.identity !== undefined) data.identity = JSON.stringify(body.identity)
    if (body.appearance !== undefined) data.appearance = JSON.stringify(body.appearance)
    if (body.temperament !== undefined) data.temperament = JSON.stringify(body.temperament)

    const character = await app.prisma.character.update({
      where: { id: charId },
      data
    })

    // 如果提供了状态/关系，插入新的历史记录（而不是更新旧记录）
    if (body.status !== undefined || body.relationships !== undefined) {
      await app.prisma.characterBranchState.create({
        data: {
          characterId: charId,
          fromChapterNumber: body.fromChapterNumber ?? null,
          status: JSON.stringify(body.status || {}),
          relationships: JSON.stringify(body.relationships || {})
        }
      })
    }

    return { success: true, data: character }
  })

  // DELETE /api/characters/:charId
  app.delete('/api/characters/:charId', async (request, reply) => {
    const { charId } = request.params as any
    await app.prisma.character.delete({ where: { id: charId } })
    return { success: true }
  })
}
