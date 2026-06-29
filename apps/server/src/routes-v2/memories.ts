import type { FastifyInstance } from 'fastify'

export async function v2MemoryRoutes(app: FastifyInstance) {
  // GET /api/v2/memories?storyId=xxx&type=xxx&category=xxx&isActive=true
  app.get('/memories', async (request) => {
    const { storyId, type, category, isActive } = request.query as {
      storyId?: string; type?: string; category?: string; isActive?: string
    }
    if (!storyId) {
      return { success: false, error: '缺少 storyId 参数' }
    }
    const where: any = { storyId }
    if (type) where.type = type
    if (category) where.category = category
    if (isActive !== undefined) {
      where.isActive = isActive === 'true'
    }
    const items = await app.prisma.v2Memory.findMany({
      where,
      orderBy: { createdAt: 'desc' }
    })
    return { success: true, data: items }
  })

  // POST /api/v2/memories/temporary
  app.post('/memories/temporary', async (request) => {
    const body = request.body as any
    if (!body.storyId || !body.category || !body.content) {
      return { success: false, error: '缺少必填字段 storyId/category/content' }
    }
    const memory = await app.prisma.v2Memory.create({
      data: {
        storyId: body.storyId,
        type: 'temporary',
        category: body.category,
        content: body.content,
        importance: body.importance ?? 4,
        participants: body.participants ?? null
      }
    })
    return { success: true, data: memory }
  })

  // PUT /api/v2/memories/temporary/:memId
  app.put('/memories/temporary/:memId', async (request) => {
    const { memId } = request.params as { memId: string }
    const body = request.body as any
    const existing = await app.prisma.v2Memory.findUnique({ where: { id: memId } })
    if (!existing) {
      return { success: false, error: '记忆不存在' }
    }
    if (existing.type !== 'temporary') {
      return { success: false, error: '只能编辑临时记忆' }
    }
    const data: any = {}
    if (body.category !== undefined) data.category = body.category
    if (body.content !== undefined) data.content = body.content
    if (body.importance !== undefined) data.importance = body.importance
    if (body.participants !== undefined) data.participants = body.participants

    const memory = await app.prisma.v2Memory.update({ where: { id: memId }, data })
    return { success: true, data: memory }
  })

  // DELETE /api/v2/memories/temporary/:memId
  app.delete('/memories/temporary/:memId', async (request) => {
    const { memId } = request.params as { memId: string }
    const existing = await app.prisma.v2Memory.findUnique({ where: { id: memId } })
    if (!existing) {
      return { success: false, error: '记忆不存在' }
    }
    if (existing.type !== 'temporary') {
      return { success: false, error: '只能删除临时记忆' }
    }
    await app.prisma.v2Memory.delete({ where: { id: memId } })
    return { success: true }
  })
}
