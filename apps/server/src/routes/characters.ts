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


  // GET /api/stories/:storyId/characters/:charId/snapshot — v4 单角色快照(给编辑弹窗切换章节用,避免拉全部角色)
  app.get('/api/stories/:storyId/characters/:charId/snapshot', async (request, reply) => {
    const { storyId, charId } = request.params as any
    const chapterParam = (request.query as any).chapter
    const viewChapterNumber = chapterParam && chapterParam !== 'null' ? Number(chapterParam) : null
    if (viewChapterNumber !== null && Number.isNaN(viewChapterNumber)) {
      return reply.status(400).send({ success: false, error: 'invalid chapter number' })
    }
    const data = await fetchCharacterDisplay(app.prisma, storyId, viewChapterNumber, charId)
    if (data.length === 0) {
      return reply.status(404).send({ success: false, error: 'Character not found' })
    }
    return { success: true, data: data[0] }
  })
  // PUT /api/stories/:storyId/characters/:charId/snapshot/:chapterNumber — v4 快照纠错: 用户手动编辑已归档快照
  app.put('/api/stories/:storyId/characters/:charId/snapshot/:chapterNumber', async (request, reply) => {
    const { storyId, charId, chapterNumber } = request.params as any
    const body = (request.body ?? {}) as any
    const chapterNum = Number(chapterNumber)
    if (!Number.isFinite(chapterNum)) {
      return reply.status(400).send({ success: false, error: 'invalid chapter number' })
    }

    const character = await app.prisma.character.findFirst({ where: { id: charId, storyId } })
    if (!character) {
      return reply.status(404).send({ success: false, error: 'Character not found' })
    }

    const status = body.status ?? {}
    const relationships = body.relationships ?? {}
    if (typeof status !== 'object' || status === null || Array.isArray(status)) {
      return reply.status(400).send({ success: false, error: 'status 必须是 JSON 对象' })
    }
    if (typeof relationships !== 'object' || relationships === null || Array.isArray(relationships)) {
      return reply.status(400).send({ success: false, error: 'relationships 必须是 JSON 对象' })
    }
    // 与归档语义一致: 空白 costume 视同未描写 → null (character-extractor.ts:112)
    // spec 声明 costume 为 string | null: 非字符串非 null → 400, 存储 trim 后的值
    let costume: string | null = null
    if (body.costume !== undefined && body.costume !== null) {
      if (typeof body.costume !== 'string') {
        return reply.status(400).send({ success: false, error: 'costume 必须是字符串或 null' })
      }
      costume = body.costume.trim() || null
    }

    const result = await app.prisma.characterBranchState.updateMany({
      where: { characterId: charId, fromChapterNumber: chapterNum },
      data: {
        status: JSON.stringify(status),
        relationships: JSON.stringify(relationships),
        costume
      }
    })
    if (result.count === 0) {
      return reply.status(404).send({ success: false, error: '该章节无此角色快照' })
    }
    return { success: true, data: { updated: result.count } }
  })
  // GET /api/stories/:storyId/characters
  app.get('/api/stories/:storyId/characters', async (request, reply) => {
    const { storyId } = request.params as any
    // ?include=branchStates 可选：需要「最新快照」的调用方显式传，默认不查（避免白查未消费的数据）
    const includeBranchStates = (request.query as any).include === 'branchStates'
    const characters = await app.prisma.character.findMany({
      where: { storyId },
      ...(includeBranchStates
        ? { include: { branchStates: { orderBy: { fromChapterNumber: 'desc' } } } }
        : {}),
      orderBy: { createdAt: 'asc' }
    })
    return { success: true, data: characters }
  })

  // POST /api/stories/:storyId/characters
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
        relationships: body.relationships !== undefined ? JSON.stringify(body.relationships) : '{}',
        status: body.status !== undefined ? JSON.stringify(body.status) : '{}'
      }
    })

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
