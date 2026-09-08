import type { FastifyInstance } from 'fastify'
import { fetchCharacterDisplay } from '../services/character-display.js'

export async function characterRoutes(app: FastifyInstance) {
  // GET /api/stories/:storyId/characters/display — v4 三字段独立查快照
  app.get('/api/stories/:storyId/characters/display', async (request, reply) => {
    const { storyId } = request.params as any
    const chapterParam = (request.query as any).chapter
    const viewChapterNumber = chapterParam && chapterParam !== 'null'
      ? Number(chapterParam)
      : null
    if (viewChapterNumber !== null && Number.isNaN(viewChapterNumber)) {
      return reply.status(400).send({ success: false, error: 'invalid chapter number' })
    }
    const data = await fetchCharacterDisplay(app.prisma, storyId, viewChapterNumber)
    return { success: true, data }
  })

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
    // v4 角色管理重构: base 关系/状态直接写入 Character 表,不再创建初始 branchState
    // (base 已是初始值,初始 branchState fromChapterNumber=null 冗余,会让 fallback 走偏)
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
        temperament: JSON.stringify(body.temperament || []),
        relationships: body.relationships !== undefined ? JSON.stringify(body.relationships) : null,
        status: body.status !== undefined ? JSON.stringify(body.status) : null
      }
    })

    return { success: true, data: character }
  })

  // PUT /api/characters/:charId
  app.put('/api/characters/:charId', async (request, reply) => {
    const { charId } = request.params as any
    const body = request.body as any
    if (body.status !== undefined || body.relationships !== undefined) {
      const snapshot = await app.prisma.characterBranchState.findFirst({ where: { characterId: charId } })
      if (snapshot) {
        return reply.status(400).send({ success: false, error: 'Character base relationships/status cannot be changed after snapshots exist' })
      }
    }

    const data: any = { name: body.name }
    if (body.protagonist !== undefined) data.protagonist = body.protagonist
    if (body.personality !== undefined) data.personality = JSON.stringify(body.personality)
    if (body.speechStyle !== undefined) data.speechStyle = JSON.stringify(body.speechStyle)
    if (body.identity !== undefined) data.identity = JSON.stringify(body.identity)
    if (body.appearance !== undefined) data.appearance = JSON.stringify(body.appearance)
    if (body.temperament !== undefined) data.temperament = JSON.stringify(body.temperament)
    if (body.relationships !== undefined) data.relationships = JSON.stringify(body.relationships)
    if (body.status !== undefined) data.status = JSON.stringify(body.status)

    const character = await app.prisma.character.update({
      where: { id: charId },
      data
    })

    // 如果提供了状态/关系，插入新的历史记录（而不是更新旧记录）
    // Snapshot state is written only by archive confirmation.

    return { success: true, data: character }
  })

  // DELETE /api/characters/:charId
  app.delete('/api/characters/:charId', async (request, reply) => {
    const { charId } = request.params as any
    await app.prisma.character.delete({ where: { id: charId } })
    return { success: true }
  })
}
