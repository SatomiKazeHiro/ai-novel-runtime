import type { FastifyInstance } from 'fastify'

export async function v2LoreRoutes(app: FastifyInstance) {
  // GET /api/v2/lore?storyId=xxx
  app.get('/lore', async (request) => {
    const { storyId } = request.query as { storyId?: string }
    if (!storyId) return { success: false, error: '缺少 storyId 参数' }
    const items = await app.prisma.loreItem.findMany({
      where: { storyId },
      orderBy: [{ category: 'asc' }, { createdAt: 'asc' }]
    })
    return { success: true, data: items }
  })

  // POST /api/v2/lore
  app.post('/lore', async (request) => {
    const body = request.body as any
    if (!body.storyId || !body.slug || !body.name) {
      return { success: false, error: '缺少必填字段 storyId/slug/name' }
    }
    const category = body.category || 'rule'
    const existing = await app.prisma.loreItem.findUnique({
      where: { storyId_category_slug: { storyId: body.storyId, category, slug: body.slug } }
    })
    if (existing) return { success: false, error: '该分类下已存在相同标识的世界观条目' }
    const item = await app.prisma.loreItem.create({
      data: {
        storyId: body.storyId,
        category,
        slug: body.slug,
        name: body.name,
        content: body.content || '',
        metadata: '{}'
      }
    })
    return { success: true, data: item }
  })

  // PUT /api/v2/lore/:loreId
  app.put('/lore/:loreId', async (request, reply) => {
    const { loreId } = request.params as { loreId: string }
    const body = request.body as any
    const data: any = {}
    if (body.slug !== undefined) data.slug = body.slug
    if (body.name !== undefined) data.name = body.name
    if (body.content !== undefined) data.content = body.content
    if (body.category !== undefined) data.category = body.category

    try {
      const item = await app.prisma.loreItem.update({ where: { id: loreId }, data })
      return { success: true, data: item }
    } catch (err: any) {
      if (err?.code === 'P2025') {
        return reply.code(404).send({ success: false, error: '条目不存在' })
      }
      if (err?.code === 'P2002') {
        return reply.code(409).send({ success: false, error: `标识冲突: ${err.meta?.target || 'slug 已存在'}` })
      }
      app.log.error(`[V2] 更新 lore ${loreId} 失败: ${err?.message}`)
      return reply.code(500).send({ success: false, error: '更新 lore 条目失败' })
    }
  })

  // DELETE /api/v2/lore/:loreId
  app.delete('/lore/:loreId', async (request, reply) => {
    const { loreId } = request.params as { loreId: string }
    try {
      await app.prisma.loreItem.delete({ where: { id: loreId } })
      return { success: true }
    } catch (err: any) {
      if (err?.code === 'P2025') {
        return reply.code(404).send({ success: false, error: '条目不存在' })
      }
      if (err?.code === 'P2003') {
        return reply.code(409).send({ success: false, error: '该条目存在关联数据，无法删除' })
      }
      app.log.error(`[V2] 删除 lore ${loreId} 失败: ${err?.message}`)
      return reply.code(500).send({ success: false, error: '删除 lore 条目失败' })
    }
  })
}
