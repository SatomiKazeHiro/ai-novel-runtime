import type { FastifyInstance } from 'fastify'
import { generateQueue } from '../queue/index.js'
import { getActivePlotArcs } from '../services/plot-extractor.js'
import { PromptPipeline } from '@novel-runtime/prompt-runtime'
import { MemoryManager } from '@novel-runtime/memory-engine'
import { RuntimePromptCompiler, countTokens } from '@novel-runtime/ai-provider'
import {
  formatCharacterSnapshot,
  DEFAULT_PIPELINE_BUDGET,
  scaleBudget,
  PreviewRequestSchema,
  GenerateRequestSchema,
  SelectDraftRequestSchema
} from '@novel-runtime/shared'
import { loadRuntimeBase, loadWorkerTask } from '../services/runtime-loader.js'
import { parseBody, getLastChapter, getOrThrowChapter } from './_helpers.js'

/**
 * Generate 流：prompt preview / 多候选 generate / 选 candidate。
 *
 * 内部 helper：getCharactersWithLatestState（仅 preview + generate 用，export 单测也用）。
 *
 * 路由路径：
 *   POST /api/chapters/:chapterId/preview   — 仅返回 compiled prompt,不调 AI
 *   POST /api/chapters/:chapterId/generate  — 入队 generateQueue,产生 N 个候选 draft
 *   POST /api/chapters/:chapterId/select    — 选候选并写 Chapter.content
 *
 * 注意：preview + generate 的 chapter 查询保留 inline `findUnique + include:{story:true} + 404`,
 * 因为它们要读 `chapter.story`。只有 select 用 `getOrThrowChapter`(无需 story)。
 */
/**
 * fallback 链: snapshot (CharacterBranchState) > Character base 字段 > '{}'
 * 让新建但未归档的角色也能在 prompt 注入基础关系/状态。
 * export 是为了支持单测。
 */
export async function getCharactersWithLatestState(
  prisma: any,
  storyId: string
): Promise<Array<{ status: string; relationships: string; [k: string]: any }>> {
  const characters = await prisma.character.findMany({ where: { storyId } })
  return Promise.all(characters.map(async (c: any) => {
    const latestState = await prisma.characterBranchState.findFirst({
      where: { characterId: c.id },
      orderBy: { fromChapterNumber: 'desc' }
    })
    return {
      ...c,
      status: latestState?.status ?? c.status ?? '{}',
      relationships: latestState?.relationships ?? c.relationships ?? '{}'
    }
  }))
}

export async function chapterGenerateRoutes(app: FastifyInstance) {

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

    // 获取 checkpoint（最后一个归档章节号）
    const checkpointChapter = await prisma.chapter.findFirst({
      where: { storyId, status: 'archived' },
      orderBy: { number: 'desc' }
    })
    const checkpointNumber = checkpointChapter?.number || 0

    const memoryManager = new MemoryManager()
    const queryText = `${chapter.outline || ''} ${chapter.sceneLocation || ''} ${chapter.sceneMood || ''} ${chapter.sceneGoal || ''}`
    const relevantMemories = await memoryManager.searchRelevant(storyId, queryText, prisma, 20, checkpointNumber)
    // 本章 temporary 记忆：用户手动加、只本章生效
    const temporaryMemories = await prisma.memory.findMany({
      where: { storyId, layer: 'temporary', chapterId },
      orderBy: { createdAt: 'asc' }
    })
    const temporaryText = temporaryMemories.map(m => `- [临时] ${m.content}`).join('\n')

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
      memory: [memoryManager.formatForPrompt(relevantMemories), temporaryText].filter(Boolean).join('\n'),
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

    // v2: archived 章节不允许再生成 (UI 也隐藏按钮,这里兜底)
    if (chapter.status === 'archived') {
      return reply.status(400).send({
        success: false,
        error: '已归档章节不能生成新草稿'
      })
    }

    // 无锁: 候选生成与章节状态正交; worker 用 Draft.status 判断是否跳过
    // 双击并发会产生 2 批 draft — Draft 表的 (id_chapterId) 唯一索引允许同 chapter 多 draft,
    // 用户最终看到候选数翻倍,无脏状态。

    const story = chapter.story

    const charactersWithBranchState = await getCharactersWithLatestState(prisma, storyId)

    const loreItems = await prisma.loreItem.findMany({ where: { storyId } })

    const checkpointChapter = await prisma.chapter.findFirst({
      where: { storyId, status: 'archived' },
      orderBy: { number: 'desc' }
    })
    const checkpointNumber = checkpointChapter?.number || 0

    const memoryManager = new MemoryManager()
    const queryText = `${chapter.outline || ''} ${chapter.sceneLocation || ''} ${chapter.sceneMood || ''} ${chapter.sceneGoal || ''}`
    const relevantMemories = await memoryManager.searchRelevant(storyId, queryText, prisma, 20, checkpointNumber)
    // 本章 temporary 记忆：用户手动加、只本章生效
    const temporaryMemories = await prisma.memory.findMany({
      where: { storyId, layer: 'temporary', chapterId },
      orderBy: { createdAt: 'asc' }
    })
    const temporaryText = temporaryMemories.map(m => `- [临时] ${m.content}`).join('\n')

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
        memory: [memoryManager.formatForPrompt(relevantMemories), temporaryText].filter(Boolean).join('\n'),
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
      chapterOutline: chapter.outline
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

    // v2: archived 章节不允许选候选
    if (chapter.status === 'archived') {
      return reply.status(400).send({
        success: false,
        error: '已归档章节不能选择新候选'
      })
    }

    // Cross-chapter isolation
    const draft = await prisma.draft.findUnique({
      where: { id_chapterId: { id: body.draftId, chapterId } }
    })
    if (!draft) return reply.status(404).send({ success: false, error: 'Draft not found' })

    // 只能采用已生成完成且内容非空的候选：误选空文会导致候选集全灭 + 正文不变
    if (draft.status !== 'completed' || !draft.content) {
      return reply.status(400).send({
        success: false,
        error: '只能选择已生成完成的候选'
      })
    }

    // v2: 采用 = 仅把选中候选的 content 写到 Chapter.content。
    // 不再置其他候选 rejected —— 候选是用户的素材库：采用后仍可参考/换用其他候选，
    // 甚至用其他候选的内容替换当前正文的瑕疵部分。"哪个被采用"靠 chapter.content 匹配。
    await prisma.chapter.update({
      where: { id: chapterId },
      data: { content: draft.content }
    })

    return { success: true }
  })
}
