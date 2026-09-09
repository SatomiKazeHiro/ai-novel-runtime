import { createProvider } from '@novel-runtime/ai-provider'
import type { FastifyInstance } from 'fastify'

export async function getProviderById(prisma: any, id: string) {
  const config = await prisma.aiProviderConfig.findUnique({ where: { id } })
  if (!config) return null
  return {
    provider: createProvider({
      name: config.name,
      apiKey: config.apiKey || undefined,
      baseUrl: config.baseUrl || undefined,
      model: config.model,
      maxTokens: config.maxTokens,
      temperature: config.temperature,
      thinking: config.thinking ?? 'auto'
    }),
    config
  }
}

export async function getDefaultProvider(prisma: any) {
  const aiConfig = await prisma.aiProviderConfig.findFirst({
    where: { isDefault: true }
  })
  if (!aiConfig) return null
  return getProviderById(prisma, aiConfig.id)
}

export async function resolveProvider(
  prisma: any,
  storyId: string,
  chapterId?: string
): Promise<{ provider: any; config: any } | null> {
  // 1. 章节覆盖
  if (chapterId) {
    const chapter = await prisma.chapter.findUnique({
      where: { id: chapterId },
      select: { aiProviderConfigId: true }
    })
    if (chapter?.aiProviderConfigId) {
      const result = await getProviderById(prisma, chapter.aiProviderConfigId)
      if (result) return result
    }
  }

  // 2. 小说默认
  const story = await prisma.story.findUnique({
    where: { id: storyId },
    select: { aiProviderConfigId: true }
  })
  if (story?.aiProviderConfigId) {
    const result = await getProviderById(prisma, story.aiProviderConfigId)
    if (result) return result
  }

  // 3. 全局默认（custom）
  const globalConfig = await prisma.aiProviderConfig.findFirst({
    where: { isDefault: true, type: 'custom' }
  })
  if (globalConfig) {
    const result = await getProviderById(prisma, globalConfig.id)
    if (result) return result
  }

  // 4. 系统默认（.env）
  const systemConfig = await prisma.aiProviderConfig.findFirst({
    where: { type: 'system' }
  })
  if (systemConfig) {
    const result = await getProviderById(prisma, systemConfig.id)
    if (result) return result
  }

  return null
}

export async function initAiProviderConfig(app: FastifyInstance) {
  const apiKey = process.env.DEEPSEEK_API_KEY
  const baseUrl = process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com'
  const model = process.env.DEEPSEEK_MODEL || 'deepseek-chat'
  const contextLength = parseInt(process.env.DEEPSEEK_CONTEXT_LENGTH || '64000', 10)

  if (!apiKey) {
    app.log.warn('DEEPSEEK_API_KEY not found in env, skipping AI provider init')
    return
  }

  const existing = await app.prisma.aiProviderConfig.findFirst({
    where: { name: 'deepseek', type: 'system' }
  })

  if (existing) {
    // 始终从 .env 同步 apiKey，方便修改 Key 后重启生效
    // 注意：thinking 字段是用户偏好，不随 .env 同步覆盖
    if (existing.apiKey !== apiKey) {
      await app.prisma.aiProviderConfig.update({
        where: { id: existing.id },
        data: { apiKey, baseUrl, model, contextLength }
      })
      app.log.info('DeepSeek AI Provider config updated from env')
    } else {
      app.log.info('DeepSeek AI Provider config already exists')
    }
    return
  }

  await app.prisma.aiProviderConfig.create({
    data: {
      type: 'system',
      name: 'deepseek',
      apiKey,
      baseUrl,
      model,
      contextLength,
      maxTokens: 4096,
      temperature: 0.7,
      thinking: 'auto',
      isDefault: true
    }
  })

  app.log.info('DeepSeek AI Provider config initialized from env')
}
