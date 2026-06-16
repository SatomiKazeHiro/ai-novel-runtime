import type { FastifyInstance } from 'fastify'
import { createProvider } from '@novel-runtime/ai-provider'

// Reusable projection that excludes the secret apiKey.
// All 5 ai-provider routes (GET list, GET default, POST create, PUT update,
// POST set-default) use this so apiKey never leaks in HTTP responses.
// P0 #6 / Task 12.
const AI_PROVIDER_SAFE_SELECT = {
  id: true, name: true, model: true, baseUrl: true,
  isDefault: true, remarks: true, type: true,
  maxTokens: true, temperature: true, contextLength: true,
  createdAt: true, updatedAt: true
} as const

export async function aiProviderRoutes(app: FastifyInstance) {
  // GET /api/ai-providers — 列表（apiKey 排除以防泄漏）
  app.get('/api/ai-providers', async (request, reply) => {
    const configs = await app.prisma.aiProviderConfig.findMany({
      orderBy: { createdAt: 'desc' },
      select: AI_PROVIDER_SAFE_SELECT
    })
    return { success: true, data: configs }
  })

  // GET /api/ai-providers/default — 获取当前默认配置（apiKey 排除）
  app.get('/api/ai-providers/default', async (request, reply) => {
    const config = await app.prisma.aiProviderConfig.findFirst({
      where: { isDefault: true },
      select: AI_PROVIDER_SAFE_SELECT
    })
    if (!config) {
      return reply.status(404).send({ success: false, error: 'No default AI provider configured' })
    }
    return { success: true, data: config }
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
      isDefault: body.isDefault ?? false,
      remarks: body.remarks || null
    }

    // 如果设为默认，取消其他默认
    if (data.isDefault) {
      await app.prisma.aiProviderConfig.updateMany({
        where: { isDefault: true },
        data: { isDefault: false }
      })
    }

    const config = await app.prisma.aiProviderConfig.create({
      data,
      select: AI_PROVIDER_SAFE_SELECT
    })
    return { success: true, data: config }
  })

  // PUT /api/ai-providers/:id — 更新
  app.put('/api/ai-providers/:id', async (request, reply) => {
    const { id } = request.params as any
    // findUnique reads full row so we can check `type === 'system'` for the 403;
    // the response below is filtered via AI_PROVIDER_SAFE_SELECT.
    const existing = await app.prisma.aiProviderConfig.findUnique({ where: { id } })
    if (!existing) return reply.status(404).send({ success: false, error: 'Config not found' })
    if (existing.type === 'system') {
      return reply.status(403).send({ success: false, error: '系统默认配置不可编辑' })
    }

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
    if (body.remarks !== undefined) data.remarks = body.remarks || null

    // 如果设为默认，取消其他默认
    if (data.isDefault) {
      await app.prisma.aiProviderConfig.updateMany({
        where: { isDefault: true, id: { not: id } },
        data: { isDefault: false }
      })
    }

    const config = await app.prisma.aiProviderConfig.update({
      where: { id },
      data,
      select: AI_PROVIDER_SAFE_SELECT
    })
    return { success: true, data: config }
  })

  // DELETE /api/ai-providers/:id — 删除
  app.delete('/api/ai-providers/:id', async (request, reply) => {
    const { id } = request.params as any
    const existing = await app.prisma.aiProviderConfig.findUnique({ where: { id } })
    if (!existing) return reply.status(404).send({ success: false, error: 'Config not found' })
    if (existing.type === 'system') {
      return reply.status(403).send({ success: false, error: '系统默认配置不可删除' })
    }
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
      data: { isDefault: true },
      select: AI_PROVIDER_SAFE_SELECT
    })
    return { success: true, data: config }
  })

  // POST /api/ai-providers/test — 检测连通性
  app.post('/api/ai-providers/test', async (request, reply) => {
    const body = request.body as any
    const { name, apiKey, baseUrl, model, id } = body

    if (!name || !model) {
      return reply.status(400).send({ success: false, error: '模型商和模型名称不能为空' })
    }

    let finalApiKey = apiKey
    // 编辑模式下 apiKey 为空，尝试从数据库读取现有配置
    if ((!finalApiKey || finalApiKey === '') && id) {
      const existing = await app.prisma.aiProviderConfig.findUnique({
        where: { id },
        select: { apiKey: true }
      })
      if (existing?.apiKey) {
        finalApiKey = existing.apiKey
      }
    }

    if (!finalApiKey) {
      return reply.status(400).send({ success: false, error: 'API Key 未配置' })
    }

    try {
      const provider = createProvider({ name, apiKey: finalApiKey, baseUrl: baseUrl || undefined, model })
      const result = await provider.testConnection()
      return result
    } catch (err: any) {
      return { success: false, message: err.message }
    }
  })
}
