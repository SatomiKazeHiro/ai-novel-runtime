import type { FastifyInstance } from 'fastify'

export async function characterRoutes(app: FastifyInstance) {
  // GET /api/stories/:id/characters
  app.get('/api/stories/:storyId/characters', async (request, reply) => {
    const { storyId } = request.params as any
    const characters = await app.prisma.character.findMany({
      where: { storyId },
      include: { branchStates: true },
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
        personality: JSON.stringify(body.personality || []),
        speechStyle: JSON.stringify(body.speechStyle || []),
        identity: JSON.stringify(body.identity || []),
        appearance: JSON.stringify(body.appearance || []),
        temperament: JSON.stringify(body.temperament || [])
      }
    })

    // 如果提供了版本分支状态，同时创建 CharacterBranchState
    const vbId = body.versionBranchId ?? ''
    if (body.status !== undefined || body.relationships !== undefined) {
      await app.prisma.characterBranchState.create({
        data: {
          characterId: character.id,
          versionBranchId: vbId,
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
    if (body.personality !== undefined) data.personality = JSON.stringify(body.personality)
    if (body.speechStyle !== undefined) data.speechStyle = JSON.stringify(body.speechStyle)
    if (body.identity !== undefined) data.identity = JSON.stringify(body.identity)
    if (body.appearance !== undefined) data.appearance = JSON.stringify(body.appearance)
    if (body.temperament !== undefined) data.temperament = JSON.stringify(body.temperament)

    const character = await app.prisma.character.update({
      where: { id: charId },
      data
    })

    // 如果提供了版本分支状态，更新或创建 CharacterBranchState
    const vbId = body.versionBranchId ?? ''
    if (body.status !== undefined || body.relationships !== undefined) {
      const existing = await app.prisma.characterBranchState.findUnique({
        where: { characterId_versionBranchId: { characterId: charId, versionBranchId: vbId } }
      })
      const bsData: any = {}
      if (body.status !== undefined) bsData.status = JSON.stringify(body.status)
      if (body.relationships !== undefined) bsData.relationships = JSON.stringify(body.relationships)

      if (existing) {
        await app.prisma.characterBranchState.update({
          where: { id: existing.id },
          data: bsData
        })
      } else {
        await app.prisma.characterBranchState.create({
          data: {
            characterId: charId,
            versionBranchId: vbId,
            status: JSON.stringify(body.status || {}),
            relationships: JSON.stringify(body.relationships || {}),
            ...bsData
          }
        })
      }
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
