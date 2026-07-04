import type { FastifyInstance } from 'fastify'

/**
 * GET /api/v2/provider-configs — 可用 AI 模型列表（不含 apiKey）
 * 原本挂在 chapters.ts 第 34-53 行，Q12 拆出独立文件。
 */
export async function v2ProviderConfigsRoutes(app: FastifyInstance) {
  app.get('/provider-configs', async () => {
    const configs = await app.prisma.aiProviderConfig.findMany({
      where: { apiKey: { not: null } },
      select: {
        id: true,
        name: true,
        model: true,
        contextLength: true,
        maxTokens: true,
        temperature: true,
        isDefault: true,
        type: true,
        remarks: true
      },
      orderBy: [{ isDefault: 'desc' }, { name: 'asc' }]
    })
    return { success: true, data: configs }
  })
}
