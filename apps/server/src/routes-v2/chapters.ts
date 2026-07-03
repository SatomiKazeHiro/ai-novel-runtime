import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { sha256 } from '../services-v2/hash.js'
import { getDefaultConfig, searchRelevantMemories } from '../services-v2/config-defaults.js'
import { assemblePrompt } from '../services-v2/prompt-assembler.js'
import { resolveProvider, getProviderById } from '../services/ai-provider-init.js'
import { logAiCall } from '../services-v2/ai-call-logger.js'

function getConfigOrThrow(raw: string | null, ctx: string): any {
  if (raw == null || raw === '') return {}
  try { return JSON.parse(raw) } catch {
    throw new Error(`${ctx} JSON 解析失败: ${raw.slice(0, 80)}`)
  }
}

const GenerateBodySchema = z.object({
  providerConfigId: z.string().optional(),
  temperature: z.number().min(0).max(2).optional(),
  maxTokens: z.number().int().min(256).max(64000).optional(),
  characterIds: z.array(z.string()).optional(),
  memoryTypeIds: z.array(z.object({
    type: z.string(),
    category: z.string(),
    id: z.string()
  })).optional(),
  plotArcIds: z.array(z.string()).optional(),
  loreIds: z.array(z.string()).optional(),
  outline: z.string().optional(),
  styleNotes: z.string().optional(),
  scene: z.string().optional(),
  _useBodyConfig: z.boolean().optional()
})

export async function v2ChapterRoutes(app: FastifyInstance) {
  // GET /api/v2/provider-configs — 可用 AI 模型列表（不含 apiKey）
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

  // GET /api/v2/chapters?storyId=xxx
  app.get('/chapters', async (request) => {
    const { storyId } = request.query as { storyId?: string }
    if (!storyId) {
      return { success: false, error: '缺少 storyId 参数' }
    }
    const chapters = await app.prisma.v2Chapter.findMany({
      where: { storyId },
      orderBy: { number: 'asc' }
    })
    // 计算 canDelete：非归档始终可删，归档仅末尾可删
    const maxNumber = chapters.length > 0
      ? Math.max(...chapters.map(c => c.number))
      : 0
    const data = chapters.map(c => ({
      ...c,
      canDelete: c.status !== 'archived' || c.number === maxNumber
    }))
    return { success: true, data }
  })

  // POST /api/v2/chapters
  app.post('/chapters', async (request) => {
    const body = request.body as any
    if (!body.storyId || !body.title) {
      return { success: false, error: '缺少必填字段 storyId/title' }
    }
    let number: number
    if (body.number !== undefined) {
      number = body.number
    } else {
      const last = await app.prisma.v2Chapter.findFirst({
        where: { storyId: body.storyId },
        orderBy: { number: 'desc' }
      })
      number = last ? Math.floor(last.number) + 1 : 1
    }
    // check duplicate number
    const existing = await app.prisma.v2Chapter.findUnique({
      where: { storyId_number: { storyId: body.storyId, number } }
    })
    if (existing) {
      return { success: false, error: `第 ${number} 章已存在` }
    }
    const chapter = await app.prisma.v2Chapter.create({
      data: {
        storyId: body.storyId,
        number,
        title: body.title,
        content: body.content || '',
        contentHash: body.content ? sha256(body.content) : '',
        status: 'draft',
        config: '{}'
      }
    })
    return { success: true, data: chapter }
  })

  // GET /api/v2/chapters/:chapterId
  app.get('/chapters/:chapterId', async (request) => {
    const { chapterId } = request.params as { chapterId: string }
    const chapter = await app.prisma.v2Chapter.findUnique({
      where: { id: chapterId },
      include: { drafts: { orderBy: { createdAt: 'desc' } } }
    })
    if (!chapter) {
      return { success: false, error: '章节不存在' }
    }
    return { success: true, data: chapter }
  })

  // PUT /api/v2/chapters/:chapterId
  app.put('/chapters/:chapterId', async (request) => {
    const { chapterId } = request.params as { chapterId: string }
    const body = request.body as any

    const existing = await app.prisma.v2Chapter.findUnique({ where: { id: chapterId } })
    if (!existing) {
      return { success: false, error: '章节不存在' }
    }
    if (existing.status === 'archived') {
      return { success: false, error: '已归档章节不可修改' }
    }

    const data: any = {}
    const editableFields = ['draft', 'generating', 'analyzing'].includes(existing.status)
      ? ['title', 'content', 'config', 'outline']
      : []

    if (body.title !== undefined && editableFields.includes('title')) {
      data.title = body.title
    }
    if (body.outline !== undefined && editableFields.includes('outline')) {
      data.outline = body.outline
    }
    if (body.content !== undefined) {
      data.content = body.content
      data.contentHash = body.content ? sha256(body.content) : ''
    }
    if (body.config !== undefined && editableFields.includes('config')) {
      data.config = typeof body.config === 'string' ? body.config : JSON.stringify(body.config)
    }

    const chapter = await app.prisma.v2Chapter.update({
      where: { id: chapterId },
      data
    })
    return { success: true, data: chapter }
  })

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

  // GET /api/v2/chapters/:chapterId/drafts — 候选文章列表
  app.get('/chapters/:chapterId/drafts', async (request) => {
    const { chapterId } = request.params as { chapterId: string }
    const drafts = await app.prisma.v2Draft.findMany({
      where: { chapterId },
      orderBy: { createdAt: 'desc' }
    })
    return { success: true, data: drafts }
  })

  // DELETE /api/v2/drafts/:draftId — 删除候选文章
  app.delete('/drafts/:draftId', async (request) => {
    const { draftId } = request.params as { draftId: string }
    const draft = await app.prisma.v2Draft.findUnique({
      where: { id: draftId },
      include: { chapter: { select: { status: true } } }
    })
    if (!draft) {
      return { success: false, error: '候选文章不存在' }
    }
    if (draft.chapter.status === 'archived') {
      return { success: false, error: '已归档章节的候选文章不可删除' }
    }
    await app.prisma.v2Draft.delete({ where: { id: draftId } })
    return { success: true }
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

  // POST /api/v2/chapters/:chapterId/generate — SSE 流式生成候选文章
  app.post('/chapters/:chapterId/generate', async (request, reply) => {
    const { chapterId } = request.params as { chapterId: string }
    const parsed = GenerateBodySchema.safeParse(request.body || {})
    if (!parsed.success) {
      return reply.status(400).send({
        success: false,
        error: parsed.error.errors.map(e => `${e.path.join('.') || '<root>'}: ${e.message}`).join('; ')
      })
    }
    const body = parsed.data

    const existing = await app.prisma.v2Chapter.findUnique({ where: { id: chapterId } })
    if (!existing) {
      return reply.status(404).send({ success: false, error: '章节不存在' })
    }
    if (existing.status === 'archived') {
      return reply.status(400).send({ success: false, error: '已归档章节不可生成' })
    }

    // 限制同时生成中的候选数 ≤ 3
    const generatingCount = await app.prisma.v2Draft.count({
      where: { chapterId, status: 'generating' }
    })
    if (generatingCount >= 3) {
      return reply.status(400).send({ success: false, error: '已有 3 个候选正在生成中，请等待或删除后再试' })
    }

    // 组装 prompt — 优先用 body 中的配置，否则回退到 chapter.config
    const config: any = {
      characterIds: body.characterIds || [],
      memoryTypeIds: body.memoryTypeIds || [],
      plotArcIds: body.plotArcIds || [],
      loreIds: body.loreIds || [],
      outline: existing.outline || undefined
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

    // 生成即保存：把当前配置写入 chapter.config，下次打开自动恢复
    {
      const configToSave: any = {
        characterIds: config.characterIds,
        memoryTypeIds: config.memoryTypeIds,
        plotArcIds: config.plotArcIds,
        loreIds: config.loreIds,
        providerConfigId: body.providerConfigId || undefined,
        temperature: body.temperature,
        maxTokens: body.maxTokens
      }
      try {
        await app.prisma.v2Chapter.update({
          where: { id: chapterId },
          data: { config: JSON.stringify(configToSave) }
        })
      } catch (err: any) {
        app.log.error(`[V2-Config] 保存配置失败: ${err.message}`)
        return reply.status(500).send({ success: false, error: '保存配置失败，请重试' })
      }
    }

    if (!config.outline?.trim()) {
      return reply.status(400).send({ success: false, error: '大纲不能为空，请先填写本章大纲' })
    }

    // 查 provider contextLength 用于 token 预算
    let contextLength = 64000
    const providerCfgId = body.providerConfigId
    if (providerCfgId) {
      const pc = await app.prisma.aiProviderConfig.findUnique({
        where: { id: providerCfgId },
        select: { contextLength: true }
      })
      contextLength = pc?.contextLength || contextLength
    } else {
      const defaultPc = await app.prisma.aiProviderConfig.findFirst({
        where: { isDefault: true },
        select: { contextLength: true }
      })
      contextLength = defaultPc?.contextLength || contextLength
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

    // 创建 draft，附上本次生成使用的配置快照
    const draftConfigMeta = await (async () => {
      let model: string | null = null
      let providerName: string | null = null
      const lookupId = providerCfgId || null
      if (lookupId) {
        const pc = await app.prisma.aiProviderConfig.findUnique({
          where: { id: lookupId },
          select: { name: true, model: true }
        }).catch((err: any) => { app.log.warn(`[V2-Provider] 查询 provider ${lookupId} 失败: ${err.message}`); return null })
        if (pc) { providerName = pc.name; model = pc.model }
      } else {
        const def = await app.prisma.aiProviderConfig.findFirst({
          where: { isDefault: true },
          select: { name: true, model: true }
        }).catch((err: any) => { app.log.warn(`[V2-Provider] 查询默认 provider 失败: ${err.message}`); return null })
        if (def) { providerName = def.name; model = def.model }
      }
      return JSON.stringify({
        outline: config.outline || '',
        characterIds: config.characterIds,
        memoryTypeIds: config.memoryTypeIds,
        plotArcIds: config.plotArcIds,
        loreIds: config.loreIds,
        providerConfigId: lookupId,
        temperature: body.temperature,
        maxTokens: body.maxTokens,
        model,
        providerName
      })
    })()
    const draft = await app.prisma.v2Draft.create({
      data: {
        chapterId,
        content: '',
        status: 'generating',
        config: draftConfigMeta
      }
    })

    // 设置 SSE 响应头
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no'
    })

    const send = (event: string, data: any) => {
      reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
    }

    send('draft-start', { draftId: draft.id })

    // 运行时降级提示：assemblePrompt fallback 到 FALLBACK_SYSTEM 时告知前端
    if (runtimeDegraded) {
      send('runtime-warning', {
        draftId: draft.id,
        message: 'AI 写作人格加载失败，已使用通用 fallback。生成质量可能下降。'
      })
    }

    let resolved: any = null
    let logId: string | null = null
    try {
      // 解析 provider：支持 body 指定 providerConfigId，或走默认 fallback 链
      if (body.providerConfigId) {
        resolved = await getProviderById(app.prisma, body.providerConfigId)
      }
      if (!resolved) {
        resolved = await resolveProvider(app.prisma, existing.storyId, chapterId)
      }
      if (!resolved?.provider?.streamGenerate) {
        send('draft-error', { draftId: draft.id, error: '无可用 AI Provider' })
        reply.raw.end()
        return
      }

      const streamOptions: any = { system: systemMessage }
      if (body.temperature !== undefined) streamOptions.temperature = Number(body.temperature)
      if (body.maxTokens !== undefined) streamOptions.maxTokens = Number(body.maxTokens)

      const estimatedTokens = Math.ceil((systemMessage.length + userMessage.length) / 2)

      // 流式开始前先写日志，确保中断/断开也能留记录
      logId = await logAiCall(app.prisma, {
        storyId: existing.storyId,
        chapterId,
        callType: 'generation',
        aiProviderConfigId: resolved.config.id,
        providerName: resolved.config.name,
        model: resolved.config.model,
        systemMessage,
        userMessage,
        responseContent: '',
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
        estimatedTokens,
        temperature: body.temperature,
        maxTokens: body.maxTokens,
        durationMs: 0,
        status: 'success'
      }).catch((err: any) => { app.log.warn(`[V2-PromptLog] 写入日志失败: ${err.message}`); return null })

      const genStartTime = Date.now()
      let fullContent = ''
      for await (const delta of resolved.provider.streamGenerate(userMessage, streamOptions)) {
        fullContent += delta
        send('draft-chunk', { draftId: draft.id, delta })
      }

      await app.prisma.v2Draft.update({
        where: { id: draft.id },
        data: { content: fullContent, status: 'completed' }
      })
      send('draft-done', { draftId: draft.id })

      // 回填日志：补充实际响应内容和耗时
      if (logId) {
        app.prisma.promptLog.update({
          where: { id: logId },
          data: { responseContent: fullContent, durationMs: Date.now() - genStartTime }
        }).catch((err: any) => app.log.warn(`[V2-PromptLog] 回填日志失败: ${err.message}`))
      }
    } catch (err: any) {
      // 错误处理路径：v2Draft.status='failed' 必须写入成功，否则 draft 卡在 generating
      // 重试一次（应对短暂 DB 抖动）；仍失败则 log error（不 throw，避免破坏 SSE 响应）
      let draftUpdateOk = false
      try {
        await app.prisma.v2Draft.update({
          where: { id: draft.id },
          data: { status: 'failed' }
        })
        draftUpdateOk = true
      } catch (firstErr: any) {
        app.log.warn(`[V2-Draft] draft 状态更新首次失败，准备重试: ${firstErr.message}`)
        try {
          await app.prisma.v2Draft.update({
            where: { id: draft.id },
            data: { status: 'failed' }
          })
          draftUpdateOk = true
        } catch (secondErr: any) {
          app.log.error(`[V2-Draft] draft 状态更新重试仍失败，draft 将卡在 generating 状态: ${secondErr.message}`)
        }
      }

      // 更新预设日志为错误状态
      if (logId) {
        app.prisma.promptLog.update({
          where: { id: logId },
          data: {
            status: 'error',
            errorMessage: err.message,
            responseContent: `[ERROR] ${(err.message || 'unknown').slice(0, 2000)}`,
            durationMs: 0
          }
        }).catch((logErr: any) => app.log.warn(`[V2-PromptLog] 错误日志更新失败: ${logErr.message}`))
      }

      try {
        send('draft-error', { draftId: draft.id, error: err.message })
      } catch (sendErr: any) {
        app.log.warn(`[V2-SSE] 发送 draft-error 失败（连接已断开）: ${sendErr.message}`)
      }
    }

    reply.raw.end()
  })

  // DELETE /api/v2/chapters/:chapterId
  app.delete('/chapters/:chapterId', async (request, reply) => {
    const { chapterId } = request.params as { chapterId: string }
    const existing = await app.prisma.v2Chapter.findUnique({ where: { id: chapterId } })
    if (!existing) {
      return reply.code(404).send({ success: false, error: '章节不存在' })
    }
    if (existing.status === 'archived') {
      const lastChapter = await app.prisma.v2Chapter.findFirst({
        where: { storyId: existing.storyId },
        orderBy: { number: 'desc' }
      })
      if (lastChapter && lastChapter.id !== chapterId) {
        return { success: false, error: '只能从末尾删除已归档章节' }
      }
    }

    // 判断是否是故事唯一章节（删除后需清理 story-level 派生数据）
    const totalChapters = await app.prisma.v2Chapter.count({
      where: { storyId: existing.storyId }
    })
    const isLastChapter = totalChapters === 1

    // 原子事务：级联清理 + 章节删除 + 末章 story-level 清理
    // 任何一步失败 → 全部回滚，章节不会被孤立
    try {
      await app.prisma.$transaction(async (tx) => {
        if (existing.status === 'archived') {
          const { count: memCount } = await tx.v2Memory.deleteMany({
            where: { storyId: existing.storyId, originChapterNumber: existing.number }
          })
          const { count: teCount } = await tx.v2TimelineEvent.deleteMany({
            where: { storyId: existing.storyId, chapterNumber: existing.number }
          })
          const { count: padCount } = await tx.v2PlotArcDraft.deleteMany({
            where: { chapterId: existing.id }
          })
          // V2CharacterSnapshot 没有 storyId，通过本故事的角色 ID 过滤
          const storyCharacters = await tx.v2Character.findMany({
            where: { storyId: existing.storyId },
            select: { id: true }
          })
          const { count: csCount } = await tx.v2CharacterSnapshot.deleteMany({
            where: { characterId: { in: storyCharacters.map(c => c.id) }, chapterNumber: existing.number }
          })
          app.log.info(
            `[V2 Delete] Cascade cleanup for chapter ${existing.number}: ` +
            `memory=${memCount}, timeline=${teCount}, plotArcDraft=${padCount}, characterSnapshot=${csCount}`
          )
        }
        await tx.v2Chapter.delete({ where: { id: chapterId } })
        if (isLastChapter) {
          const { count: arcCount } = await tx.v2PlotArc.deleteMany({
            where: { storyId: existing.storyId }
          })
          const { count: logCount } = await tx.v2MemoryMergeLog.deleteMany({
            where: { storyId: existing.storyId }
          })
          app.log.info(
            `[V2 Delete] Last chapter removed. Cleaned plotArc=${arcCount}, memoryMergeLog=${logCount}`
          )
        }
      })
      return { success: true }
    } catch (err: any) {
      if (err?.code === 'P2025') {
        return reply.code(404).send({ success: false, error: '章节不存在（已被删除）' })
      }
      if (err?.code === 'P2003') {
        return reply.code(409).send({ success: false, error: '该章节存在未被级联清理的关联数据，无法删除' })
      }
      app.log.error(`[V2 Delete] Chapter ${chapterId} cascade failed: ${err.message}`)
      return reply.code(500).send({
        success: false,
        error: `删除失败，已回滚（派生数据未清理）: ${err.message}`
      })
    }
  })
}
