import type { FastifyInstance } from 'fastify'
import { ChapterStatus } from '@prisma/client'
import { generateQueue } from '../queue/index.js'
import { getActivePlotArcs } from '../services/plot-extractor.js'
import { PromptPipeline } from '@novel-runtime/prompt-runtime'
import { MemoryManager } from '@novel-runtime/memory-engine'
import { RuntimePromptCompiler, countTokens } from '@novel-runtime/ai-provider'
import {
  formatCharacterSnapshot,
  DEFAULT_PIPELINE_BUDGET,
  scaleBudget,
  safeJsonParse,
  PreviewRequestSchema,
  GenerateRequestSchema,
  SelectDraftRequestSchema,
  formatTimelinePosition
} from '@novel-runtime/shared'
import { loadRuntimeBase, loadWorkerTask } from '../services/runtime-loader.js'
import { parseBody, getLastChapter, getOrThrowChapter } from './_helpers.js'

/**
 * Generate 流：prompt preview / 多候选 generate / 选 candidate。
 *
 * 内部 helper：getCharactersWithLatestState（仅 preview + generate 用，保留在文件内闭包）。
 *
 * 路由路径：
 *   POST /api/chapters/:chapterId/preview   — 仅返回 compiled prompt,不调 AI
 *   POST /api/chapters/:chapterId/generate  — 入队 generateQueue,产生 N 个候选 draft
 *   POST /api/chapters/:chapterId/select    — 选候选并写 Chapter.content
 *
 * 注意：preview + generate 的 chapter 查询保留 inline `findUnique + include:{story:true} + 404`,
 * 因为它们要读 `chapter.story`。只有 select 用 `getOrThrowChapter`(无需 story)。
 */
export async function chapterGenerateRoutes(app: FastifyInstance) {
  // 辅助函数：获取角色的最新状态（历史表模式）。preview + generate 共用。
  async function getCharactersWithLatestState(prisma: any, storyId: string) {
    const characters = await prisma.character.findMany({ where: { storyId } })
    return Promise.all(characters.map(async (c: any) => {
      const latestState = await prisma.characterBranchState.findFirst({
        where: { characterId: c.id },
        orderBy: { fromChapterNumber: 'desc' }
      })
      return { ...c, status: latestState?.status || '{}', relationships: latestState?.relationships || '{}' }
    }))
  }

  // POST /api/chapters/:chapterId/preview
  app.post('/api/chapters/:chapterId/preview', async (request, reply) => {
    const { chapterId } = request.params as any
    const body = parseBody(PreviewRequestSchema, request, reply)
    if (body === null) return
    const storyId = body.storyId

    const prisma = app.prisma
    const chapter = await prisma.chapter.findUnique({
      where: { id: chapterId },
      include: { story: true }
    })
    if (!chapter) return reply.status(404).send({ success: false, error: 'Chapter not found' })

    // 生成限制：只能在最新章节上生成
    const lastChapter = await getLastChapter(prisma, chapter.storyId)
    if (lastChapter && lastChapter.id !== chapterId) {
      return reply.status(400).send({ success: false, error: '只能在最新章节上生成内容' })
    }

    const story = chapter.story

    // 查询角色并合并最新状态
    const charactersWithBranchState = await getCharactersWithLatestState(prisma, storyId)

    const loreItems = await prisma.loreItem.findMany({ where: { storyId } })
    const timelineEvents = await prisma.timelineEvent.findMany({ where: { storyId }, orderBy: { position: 'asc' } })

    // 获取 checkpoint（最后一个归档章节号）
    const checkpointChapter = await prisma.chapter.findFirst({
      where: { storyId, status: 'archived' },
      orderBy: { number: 'desc' }
    })
    const checkpointNumber = checkpointChapter?.number || 0

    const memoryManager = new MemoryManager()
    const queryText = `${chapter.outline || ''} ${chapter.sceneLocation || ''} ${chapter.sceneMood || ''} ${chapter.sceneGoal || ''}`
    const relevantMemories = await memoryManager.searchRelevant(storyId, queryText, prisma, 20, checkpointNumber)

    const base = await loadRuntimeBase(storyId, prisma)
    const task = await loadWorkerTask(storyId, 'generation', prisma)
    const plotArcText = await getActivePlotArcs(prisma, storyId)

    const aiConfig = await prisma.aiProviderConfig.findFirst({ where: { isDefault: true } })
    const contextLength = aiConfig?.contextLength || DEFAULT_PIPELINE_BUDGET.total
    const budget = scaleBudget(contextLength)

    const pipeline = new PromptPipeline(budget)

    const pipelineResult = pipeline.run({
      story: `作品：《${story.title}》\n简介：${story.description || '无'}`,
      character: formatCharacterSnapshot(charactersWithBranchState),
      lore: loreItems.map(l => `【${l.name}】${l.content}`).join('\n') || '无世界观设定信息',
      scene: `标题：${chapter.title || '未设定'}\n地点：${chapter.sceneLocation || '未设定'}\n氛围：${chapter.sceneMood || '未设定'}\n目标：${chapter.sceneGoal || '未设定'}`,
      memory: memoryManager.formatForPrompt(relevantMemories),
      timeline: timelineEvents.map(t => `[${formatTimelinePosition(t.position)}] ${safeJsonParse<string[]>(t.events, []).join('；')}`).join('\n'),
      plotArc: plotArcText || undefined,
      output: `请根据以下大纲生成本章正文：\n\n${chapter.outline || '无大纲'}`
    })

    const compiler = new RuntimePromptCompiler()
    const compiled = compiler.compile(base, task, pipelineResult.text)

    return {
      success: true,
      data: {
        tokens: compiled.meta,
        layers: pipelineResult.stats,
        preview: pipelineResult.text,
        compiled,
        model: aiConfig ? { name: aiConfig.name, model: aiConfig.model, contextLength, maxTokens: aiConfig.maxTokens } : null
      }
    }
  })

  // POST /api/chapters/:chapterId/generate
  app.post('/api/chapters/:chapterId/generate', async (request, reply) => {
    const { chapterId } = request.params as any
    const body = parseBody(GenerateRequestSchema, request, reply)
    if (body === null) return
    const candidateCount = body.candidateCount || 3
    const temperatures = body.temperatures || [0.6, 0.75, 0.9]
    const customMaxTokens = body.maxTokens

    app.log.info(`[Generate] Async generation started for chapter ${chapterId}, candidates: ${candidateCount}`)

    const prisma = app.prisma

    const chapter = await prisma.chapter.findUnique({
      where: { id: chapterId },
      include: { story: true }
    })
    if (!chapter) return reply.status(404).send({ success: false, error: 'Chapter not found' })

    // storyId 是 optional (GenerateRequestSchema),fallback 到 chapter 自身所属 story。
    // 这保留了原行为:之前 body.storyId 来自前端,缺失时下游 storyId 也会是 undefined
    // 但前端总是会传 — 现在用 chapter.storyId 兜底,反而更稳。
    const storyId = body.storyId ?? chapter.storyId

    // 允许 draft / generated / selected 三态生成候选
    // - draft: 首次生成
    // - generated: 已有候选不满意,再生成新的(追加)
    // - selected: 已选了一个,想多看几个对比(追加,Chapter.content 不动)
    // (Q#10 当时拒绝 generated 是因为"删旧+重建"无原子性,本改造改为纯加法,
    // 旧候选全部保留,不存在脏窗口问题)
    const GENERATE_ALLOWED_STATUSES = ['draft', 'generated', 'selected'] as const
    if (!GENERATE_ALLOWED_STATUSES.includes(chapter.status as any)) {
      return reply.status(400).send({
        success: false,
        error: `章节当前状态为 ${chapter.status}，只允许 draft / generated / selected 状态生成候选`
      })
    }

    // 状态机独占锁：原子性 updateMany（防止双击并发产生 2 批 draft）
    const lockResult = await prisma.chapter.updateMany({
      where: {
        id: chapterId,
        status: { in: [...GENERATE_ALLOWED_STATUSES] as ChapterStatus[] }
      },
      data: { status: 'generating' }
    })
    if (lockResult.count === 0) {
      return reply.status(409).send({
        success: false,
        error: '章节正在生成中或状态不允许，请刷新后重试'
      })
    }
    // 后续代码已假设 chapter.status === 'generating'，无需重新读取

    // 抢锁前的 chapter.status,worker 完成后用其恢复 chapter.status
    // (而不是写死 'generated')。selected 状态重生成后保持 selected,这是
    // 纯加法语义的关键:Chapter.content / 已选 draft 标记都不动。
    const preLockStatus = chapter.status

    const story = chapter.story

    const charactersWithBranchState = await getCharactersWithLatestState(prisma, storyId)

    const loreItems = await prisma.loreItem.findMany({ where: { storyId } })
    const timelineEvents = await prisma.timelineEvent.findMany({ where: { storyId }, orderBy: { position: 'asc' } })

    const checkpointChapter = await prisma.chapter.findFirst({
      where: { storyId, status: 'archived' },
      orderBy: { number: 'desc' }
    })
    const checkpointNumber = checkpointChapter?.number || 0

    const memoryManager = new MemoryManager()
    const queryText = `${chapter.outline || ''} ${chapter.sceneLocation || ''} ${chapter.sceneMood || ''} ${chapter.sceneGoal || ''}`
    const relevantMemories = await memoryManager.searchRelevant(storyId, queryText, prisma, 20, checkpointNumber)

    const base = await loadRuntimeBase(storyId, prisma)
    const task = await loadWorkerTask(storyId, 'generation', prisma)
    const plotArcText = await getActivePlotArcs(prisma, storyId)

    const aiConfig = await prisma.aiProviderConfig.findFirst({ where: { isDefault: true } })
    const contextLength = aiConfig?.contextLength || DEFAULT_PIPELINE_BUDGET.total
    const maxTokens = customMaxTokens || aiConfig?.maxTokens || 4096
    const budget = scaleBudget(contextLength)

    let compiled: any
    let layers: any[] = []
    const customCompiled = body.compiledPrompt

    if (customCompiled) {
      // GenerateRequestSchema 已嵌套校验 CompiledPromptSchema,
      // 此处 schema 一定 valid,直接用 customCompiled。
      const systemTokens = countTokens(customCompiled.systemMessage)
      const userTokens = countTokens(customCompiled.userMessage)
      compiled = {
        systemMessage: customCompiled.systemMessage,
        userMessage: customCompiled.userMessage,
        meta: { systemTokens, userTokens, totalTokens: systemTokens + userTokens }
      }
    } else {
      const pipeline = new PromptPipeline(budget)
      const pipelineResult = pipeline.run({
        story: `作品：《${story.title}》\n简介：${story.description || '无'}`,
        character: formatCharacterSnapshot(charactersWithBranchState),
        lore: loreItems.map(l => `【${l.name}】${l.content}`).join('\n') || '无世界观设定信息',
        scene: `标题：${chapter.title || '未设定'}\n地点：${chapter.sceneLocation || '未设定'}\n氛围：${chapter.sceneMood || '未设定'}\n目标：${chapter.sceneGoal || '未设定'}`,
        memory: memoryManager.formatForPrompt(relevantMemories),
        timeline: timelineEvents.map(t => `[${formatTimelinePosition(t.position)}] ${safeJsonParse<string[]>(t.events, []).join('；')}`).join('\n'),
        plotArc: plotArcText || undefined,
        output: `请根据以下大纲生成本章正文（约2000-4000字）：\n\n${chapter.outline || '无大纲'}`
      })
      const userMessage = pipelineResult.text
      layers = pipelineResult.stats

      const compiler = new RuntimePromptCompiler()
      compiled = compiler.compile(base, task, userMessage)
    }

    function tempToStyle(temp: number): string {
      if (temp <= 0.55) return '保守'
      if (temp <= 0.72) return '标准'
      if (temp <= 0.85) return '活跃'
      return '奔放'
    }

    const existingDraftCount = await prisma.draft.count({ where: { chapterId } })
    const generatingDrafts = []
    for (let i = 0; i < candidateCount; i++) {
      const temperature = temperatures[i] ?? (0.6 + i * 0.15)
      const style = tempToStyle(temperature)
      const draft = await prisma.draft.create({
        data: {
          storyId,
          chapterId,
          version: `版本${existingDraftCount + i + 1}(偏${style}版)`,
          content: '',
          temperature,
          maxTokens,
          params: JSON.stringify({ temperature, model: aiConfig?.model || 'fallback', source: 'generate' }),
          status: 'generating',
          compiledPrompt: JSON.stringify(compiled)
        }
      })
      generatingDrafts.push(draft)
    }

    await prisma.chapter.update({
      where: { id: chapterId },
      data: { compiledPrompt: JSON.stringify(compiled) }
    })

    await generateQueue.add('generate-chapter', {
      draftIds: generatingDrafts.map(d => d.id),
      chapterId,
      storyId,
      compiled,
      temperatures: generatingDrafts.map((_, i) => temperatures[i] ?? (0.6 + i * 0.15)),
      maxTokens,
      chapterTitle: chapter.title,
      chapterOutline: chapter.outline,
      preLockStatus   // 透传给 worker,决定 status 恢复目标
    })

    app.log.info(`[Generate] Queued ${generatingDrafts.length} drafts for chapter ${chapterId}`)

    return { success: true, data: { drafts: generatingDrafts, count: generatingDrafts.length, tokens: compiled.meta, layers } }
  })

  // POST /api/chapters/:chapterId/select
  app.post('/api/chapters/:chapterId/select', async (request, reply) => {
    const { chapterId } = request.params as any
    const body = parseBody(SelectDraftRequestSchema, request, reply)
    if (body === null) return

    const prisma = app.prisma
    const chapter = await getOrThrowChapter(prisma, chapterId, reply)
    if (chapter === null) return

    // 允许 generated / scored / selected / generating 四态选择候选
    // - generated / scored: 首次/评分后选择
    // - selected: 已选了一个,看到新生成的更好的候选想切换
    // - generating: 用户在 worker 跑的时候看到喜欢的就立即选;
    //   配合 generate-processor 的"rejected draft 跳过 + chapter.status 不覆盖"
    //   兜底,select 不会因为后续 worker 完成而被破坏
    // 切换路径下,UI 的 handleAdoptDraft 已有"确认覆盖"对话框兜底
    if (chapter.status !== 'generated' &&
        chapter.status !== 'scored' &&
        chapter.status !== 'selected' &&
        chapter.status !== 'generating') {
      return reply.status(400).send({
        success: false,
        error: `章节当前状态为 ${chapter.status}，只允许 generated / scored / selected / generating 状态选择候选`
      })
    }

    // Cross-chapter isolation: draftId must belong to current chapterId.
    // Use the compound unique key (id_chapterId) so the lookup is atomic.
    const draft = await prisma.draft.findUnique({
      where: { id_chapterId: { id: body.draftId, chapterId } }
    })
    if (!draft) return reply.status(404).send({ success: false, error: 'Draft not found' })

    // 状态机独占锁：原子性 updateMany（防止双击 select 产生重复 chapter update）
    const lockResult = await prisma.chapter.updateMany({
      where: { id: chapterId, status: { in: ['generated', 'scored', 'selected', 'generating'] } },
      data: { status: 'selected' }
    })
    if (lockResult.count === 0) {
      return reply.status(409).send({
        success: false,
        error: '章节正在被其他操作处理中或状态不允许，请刷新后重试'
      })
    }

    await prisma.$transaction(async (tx) => {
      await tx.draft.updateMany({ where: { chapterId }, data: { status: 'rejected' } })
      await tx.draft.update({ where: { id: body.draftId }, data: { status: 'selected' } })
      await tx.chapter.update({ where: { id: chapterId }, data: { status: 'selected', content: draft.content || undefined } })
    })

    return { success: true }
  })
}