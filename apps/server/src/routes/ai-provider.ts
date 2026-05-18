import type { FastifyInstance } from 'fastify'

export async function aiProviderRoutes(app: FastifyInstance) {
  // GET /api/ai-providers — 列表
  app.get('/api/ai-providers', async (request, reply) => {
    const configs = await app.prisma.aiProviderConfig.findMany({
      orderBy: { createdAt: 'desc' }
    })
    return { success: true, data: configs }
  })

  // POST /api/ai-providers — 创建
  app.post('/api/ai-providers', async (request, reply) => {
    const body = request.body as any
    const data: any = {
      name: body.name,
      apiKey: body.apiKey || null,
      baseUrl: body.baseUrl || null,
      model: body.model,
      contextLength: body.contextLength ?? 64000,
      maxTokens: body.maxTokens ?? 4096,
      temperature: body.temperature ?? 0.7,
      isDefault: body.isDefault ?? false
    }

    // 如果设为默认，取消其他默认
    if (data.isDefault) {
      await app.prisma.aiProviderConfig.updateMany({
        where: { isDefault: true },
        data: { isDefault: false }
      })
    }

    const config = await app.prisma.aiProviderConfig.create({ data })
    return { success: true, data: config }
  })

  // PUT /api/ai-providers/:id — 更新
  app.put('/api/ai-providers/:id', async (request, reply) => {
    const { id } = request.params as any
    const body = request.body as any
    const data: any = {}

    if (body.name !== undefined) data.name = body.name
    if (body.apiKey !== undefined) data.apiKey = body.apiKey || null
    if (body.baseUrl !== undefined) data.baseUrl = body.baseUrl || null
    if (body.model !== undefined) data.model = body.model
    if (body.contextLength !== undefined) data.contextLength = body.contextLength
    if (body.maxTokens !== undefined) data.maxTokens = body.maxTokens
    if (body.temperature !== undefined) data.temperature = body.temperature
    if (body.isDefault !== undefined) data.isDefault = body.isDefault

    // 如果设为默认，取消其他默认
    if (data.isDefault) {
      await app.prisma.aiProviderConfig.updateMany({
        where: { isDefault: true, id: { not: id } },
        data: { isDefault: false }
      })
    }

    const config = await app.prisma.aiProviderConfig.update({ where: { id }, data })
    return { success: true, data: config }
  })

  // DELETE /api/ai-providers/:id — 删除
  app.delete('/api/ai-providers/:id', async (request, reply) => {
    const { id } = request.params as any
    await app.prisma.aiProviderConfig.delete({ where: { id } })
    return { success: true }
  })

  // POST /api/ai-providers/:id/default — 设为默认
  app.post('/api/ai-providers/:id/default', async (request, reply) => {
    const { id } = request.params as any
    await app.prisma.aiProviderConfig.updateMany({
      where: { isDefault: true },
      data: { isDefault: false }
    })
    const config = await app.prisma.aiProviderConfig.update({
      where: { id },
      data: { isDefault: true }
    })
    return { success: true, data: config }
  })
}
