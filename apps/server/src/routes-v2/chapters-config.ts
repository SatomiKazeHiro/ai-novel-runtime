import type { FastifyInstance } from 'fastify'
import { getDefaultConfig, searchRelevantMemories } from '../services-v2/config-defaults.js'
import { assemblePrompt } from '../services-v2/prompt-assembler.js'

/**
 * 章节配置与 prompt 组装路由：
 * - POST /api/v2/chapters/:chapterId/config — 生成并保存默认配置
 * - POST /api/v2/chapters/:chapterId/memory-search — 语义搜索记忆（"系统分配"按钮）
 * - POST /api/v2/chapters/:chapterId/preview — 仅组装 prompt 不调用 AI
 * 原本挂在 chapters.ts 第 165-293 行，Q12-3 拆出。
 *
 * getConfigOrThrow 在这里复制一份（也复制到 chapters-generate.ts），
 * 跟 archive/analysis 现有惯例对齐 — 5 行函数复制比抽 utils 易读。
 */
function getConfigOrThrow(raw: string | null, ctx: string): any {
  if (raw == null || raw === '') return {}
  try { return JSON.parse(raw) } catch {
    throw new Error(`${ctx} JSON 解析失败: ${raw.slice(0, 80)}`)
  }
}

export async function v2ChapterConfigRoutes(app: FastifyInstance) {
  // POST /api/v2/chapters/:chapterId/config — 生成并保存默认配置
  app.post('/chapters/:chapterId/config', async (request) => {
    const { chapterId } = request.params as { chapterId: string }
    const existing = await app.prisma.v2Chapter.findUnique({ where: { id: chapterId } })
    if (!existing) {
      return { success: false, error: '章节不存在' }
    }
    if (existing.status === 'archived') {
      return { success: false, error: '已归档章节不可修改配置' }
    }
    const config = await getDefaultConfig(app.prisma, existing.storyId)
    await app.prisma.v2Chapter.update({
      where: { id: chapterId },
      data: { config: JSON.stringify(config) }
    })
    return { success: true, data: config }
  })

  // POST /api/v2/chapters/:chapterId/memory-search — 语义搜索记忆（"系统分配"按钮）
  app.post('/chapters/:chapterId/memory-search', async (request) => {
    const { chapterId } = request.params as { chapterId: string }
    const { query } = (request.body || {}) as { query?: string }
    if (!query?.trim()) {
      return { success: false, error: '缺少 query（请提供大纲文本作为搜索查询）' }
    }
    const chapter = await app.prisma.v2Chapter.findUnique({
      where: { id: chapterId },
      select: { storyId: true, number: true }
    })
    if (!chapter) return { success: false, error: '章节不存在' }
    const result = await searchRelevantMemories(app.prisma, chapter.storyId, query, chapter.number)
    return { success: true, data: result }
  })

  // POST /api/v2/chapters/:chapterId/preview — 仅组装 prompt 不调用 AI
  app.post('/chapters/:chapterId/preview', async (request, reply) => {
    const { chapterId } = request.params as { chapterId: string }
    const body = (request.body || {}) as any

    const existing = await app.prisma.v2Chapter.findUnique({ where: { id: chapterId } })
    if (!existing) return { success: false, error: '章节不存在' }

    const config: any = {
      characterIds: body.characterIds || [],
      memoryTypeIds: body.memoryTypeIds || [],
      plotArcIds: body.plotArcIds || [],
      loreIds: body.loreIds || [],
      outline: existing.outline || undefined,
      styleNotes: body.styleNotes || undefined,
      scene: body.scene || undefined
    }
    // body 未传数据源时，从 chapter.config 回退
    if (!body._useBodyConfig) {
      let saved: any
      try {
        saved = getConfigOrThrow(existing.config, '章节配置')
      } catch (err: any) {
        return reply.status(422).send({ success: false, error: `数据完整性错误: ${err.message}，请重新保存配置` })
      }
      if (!config.characterIds.length) config.characterIds = saved.characterIds || []
      if (!config.memoryTypeIds.length) config.memoryTypeIds = saved.memoryTypeIds || []
      if (!config.plotArcIds.length) config.plotArcIds = saved.plotArcIds || []
      if (!config.loreIds.length) config.loreIds = saved.loreIds || []
      if (!config.outline) config.outline = saved.outline || undefined
    }

    let contextLength = 64000
    const pcId = body.providerConfigId
    if (pcId) {
      const pc = await app.prisma.aiProviderConfig.findUnique({ where: { id: pcId }, select: { contextLength: true } })
      contextLength = pc?.contextLength || contextLength
    } else {
      const def = await app.prisma.aiProviderConfig.findFirst({ where: { isDefault: true }, select: { contextLength: true } })
      contextLength = def?.contextLength || contextLength
    }

    let systemMessage: string
    let userMessage: string
    let runtimeDegraded = false
    try {
      const assembled = await assemblePrompt(app.prisma, existing.storyId, config, contextLength)
      systemMessage = assembled.systemMessage
      userMessage = assembled.userMessage
      runtimeDegraded = assembled.runtimeDegraded === true
    } catch (err: any) {
      return reply.status(422).send({ success: false, error: `数据完整性错误: ${err.message}` })
    }
    const estSystem = Math.ceil(systemMessage.length / 2)
    const estUser = Math.ceil(userMessage.length / 2)
    return {
      success: true,
      data: {
        systemMessage,
        userMessage,
        estimatedSystemTokens: estSystem,
        estimatedUserTokens: estUser,
        estimatedTotalTokens: estSystem + estUser,
        contextBudget: contextLength,
        runtimeDegraded
      }
    }
  })
}
