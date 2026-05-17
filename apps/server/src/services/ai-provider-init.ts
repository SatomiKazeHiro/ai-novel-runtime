import type { FastifyInstance } from 'fastify'

export async function initAiProviderConfig(app: FastifyInstance) {
  const existing = await app.prisma.aiProviderConfig.findFirst({
    where: { name: 'deepseek', isDefault: true }
  })

  if (existing) {
    app.log.info('DeepSeek AI Provider config already exists')
    return
  }

  const apiKey = process.env.DEEPSEEK_API_KEY
  const baseUrl = process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com'
  const model = process.env.DEEPSEEK_MODEL || 'deepseek-chat'

  if (!apiKey) {
    app.log.warn('DEEPSEEK_API_KEY not found in env, skipping AI provider init')
    return
  }

  await app.prisma.aiProviderConfig.create({
    data: {
      name: 'deepseek',
      apiKey,
      baseUrl,
      model,
      maxTokens: 4096,
      temperature: 0.7,
      isDefault: true
    }
  })

  app.log.info('DeepSeek AI Provider config initialized from env')
}
