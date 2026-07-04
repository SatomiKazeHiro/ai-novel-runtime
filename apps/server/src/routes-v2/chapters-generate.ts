import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { assemblePrompt } from '../services-v2/prompt-assembler.js'
import { resolveProvider, getProviderById } from '../services/ai-provider-init.js'
import { logAiCall } from '../services-v2/ai-call-logger.js'

/**
 * POST /api/v2/chapters/:chapterId/generate — SSE 流式生成候选文章
 * 原本挂在 chapters.ts 第 295-570 行，Q12-4 拆出到独立文件。
 * 替换之前 generate-stream stub 的占位（grep 验证 0 调用方，安全删除）。
 *
 * getConfigOrThrow 在这里复制一份（chapters-config.ts 也已有一份），
 * 跟 archive/analysis 现有惯例对齐 — 5 行函数复制比抽 utils 易读。
 */
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

export async function v2ChapterGenerateRoutes(app: FastifyInstance) {
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
}
