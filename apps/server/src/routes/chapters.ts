import type { FastifyInstance } from 'fastify'
import { generateQueue } from '../queue/index.js'
import { extractAndSaveAll } from '../services/combined-extractor.js'
import { organizeMemoriesAfterArchive } from '../services/memory-organizer.js'
import { getActivePlotArcs } from '../services/plot-extractor.js'
import { PromptPipeline } from '@novel-runtime/prompt-runtime'
import { MemoryManager } from '@novel-runtime/memory-engine'
import { RuntimePromptCompiler } from '@novel-runtime/ai-provider'
import { formatCharacterSnapshot, generateFallbackContent, DEFAULT_PIPELINE_BUDGET } from '@novel-runtime/shared'
import { loadRuntimeBase, loadWorkerTask } from '../services/runtime-loader.js'
import { callAIWithLog } from '../services/ai-call-logger.js'

export async function chapterRoutes(app: FastifyInstance) {
  // GET /api/stories/:storyId/chapters
  app.get('/api/stories/:storyId/chapters', async (request, reply) => {
    const { storyId } = request.params as any
    const chapters = await app.prisma.chapter.findMany({
      where: { storyId },
      orderBy: { number: 'asc' }
    })
    return { success: true, data: chapters }
  })

  // POST /api/stories/:storyId/chapters
  app.post('/api/stories/:storyId/chapters', async (request, reply) => {
    const { storyId } = request.params as any
    const body = request.body as any
    const isSideStory = body.isSideStory === true
    let number: number
    if (isSideStory && body.number !== undefined) {
      // 番外：使用指定序号（如 3.5）
      number = parseFloat(body.number)
    } else {
      // 正篇：取当前最大序号 + 1
      const lastChapter = await app.prisma.chapter.findFirst({
        where: { storyId, isSideStory: false },
        orderBy: { number: 'desc' }
      })
      number = (lastChapter?.number || 0) + 1
    }
    const chapter = await app.prisma.chapter.create({
      data: {
        storyId,
        number,
        isSideStory,
        title: body.title,
        outline: body.outline || '',
        status: 'draft'
      }
    })
    return { success: true, data: chapter }
  })

  // GET /api/chapters/:chapterId
  app.get('/api/chapters/:chapterId', async (request, reply) => {
    const { chapterId } = request.params as any
    const chapter = await app.prisma.chapter.findUnique({
      where: { id: chapterId },
      include: { drafts: true }
    })
    if (!chapter) return reply.status(404).send({ success: false, error: 'Chapter not found' })
    return { success: true, data: chapter }
  })

  // PUT /api/chapters/:chapterId
  app.put('/api/chapters/:chapterId', async (request, reply) => {
    const { chapterId } = request.params as any
    const body = request.body as any
    const data: any = {}
    if (body.title !== undefined) data.title = body.title
    if (body.outline !== undefined) data.outline = body.outline
    if (body.content !== undefined) data.content = body.content
    if (body.status !== undefined) data.status = body.status
    if (body.sceneLocation !== undefined) data.sceneLocation = body.sceneLocation
    if (body.sceneMood !== undefined) data.sceneMood = body.sceneMood
    if (body.sceneGoal !== undefined) data.sceneGoal = body.sceneGoal
    const chapter = await app.prisma.chapter.update({ where: { id: chapterId }, data })
    return { success: true, data: chapter }
  })

  // DELETE /api/chapters/:chapterId
  app.delete('/api/chapters/:chapterId', async (request, reply) => {
    const { chapterId } = request.params as any
    await app.prisma.chapter.delete({ where: { id: chapterId } })
    return { success: true }
  })

  // POST /api/chapters/:chapterId/preview — 只组装 Prompt，不调用 AI
  app.post('/api/chapters/:chapterId/preview', async (request, reply) => {
    const { chapterId } = request.params as any
    const body = request.body as any
    const storyId = body.storyId

    const prisma = app.prisma
    const chapter = await prisma.chapter.findUnique({
      where: { id: chapterId },
      include: { story: true }
    })
    if (!chapter) return reply.status(404).send({ success: false, error: 'Chapter not found' })

    const story = chapter.story
    const characters = await prisma.character.findMany({ where: { storyId } })
    const loreItems = await prisma.loreItem.findMany({ where: { storyId } })
    const timelineEvents = await prisma.timelineEvent.findMany({ where: { storyId }, orderBy: { day: 'asc' } })

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

    const pipeline = new PromptPipeline(DEFAULT_PIPELINE_BUDGET)

    const pipelineResult = pipeline.run({
      story: `作品：《${story.title}》\n简介：${story.description || '无'}`,
      character: formatCharacterSnapshot(characters),
      lore: loreItems.map(l => `【${l.name}】${l.content}`).join('\n') || '无世界观设定信息',
      scene: `地点：${chapter.sceneLocation || '未设定'}\n氛围：${chapter.sceneMood || '未设定'}\n目标：${chapter.sceneGoal || '未设定'}`,
      memory: memoryManager.formatForPrompt(relevantMemories),
      timeline: timelineEvents.map(t => `第${t.day}天：${JSON.parse(t.events).join('；')}`).join('\n'),
      plotArc: plotArcText || undefined,
      output: `请根据以下大纲生成本章正文（约2000-4000字）：\n\n${chapter.outline || '无大纲'}`
    })

    const compiler = new RuntimePromptCompiler()
    const compiled = compiler.compile(base, task, pipelineResult.text)

    return {
      success: true,
      data: {
        tokens: compiled.meta,
        layers: pipelineResult.stats,
        preview: pipelineResult.text // pipelineResult.text.slice(0, 2000) + (pipelineResult.text.length > 2000 ? '...' : '')
      }
    }
  })

  // POST /api/chapters/:chapterId/generate — 同步阻塞生成
  app.post('/api/chapters/:chapterId/generate', async (request, reply) => {
    const { chapterId } = request.params as any
    const body = request.body as any
    const storyId = body.storyId
    const candidateCount = body.candidateCount || 3

    app.log.info(`[Generate] Sync generation started for chapter ${chapterId}`)

    const prisma = app.prisma

    // 1. 获取章节信息
    const chapter = await prisma.chapter.findUnique({
      where: { id: chapterId },
      include: { story: true }
    })
    if (!chapter) return reply.status(404).send({ success: false, error: 'Chapter not found' })

    // 2. 获取上下文
    const story = chapter.story
    const characters = await prisma.character.findMany({ where: { storyId } })
    const loreItems = await prisma.loreItem.findMany({ where: { storyId } })
    const timelineEvents = await prisma.timelineEvent.findMany({ where: { storyId }, orderBy: { day: 'asc' } })

    // 2a. 获取 checkpoint
    const checkpointChapter = await prisma.chapter.findFirst({
      where: { storyId, status: 'archived' },
      orderBy: { number: 'desc' }
    })
    const checkpointNumber = checkpointChapter?.number || 0

    // 2b. 语义检索相关记忆（只读 checkpoint 之前）
    const memoryManager = new MemoryManager()
    const queryText = `${chapter.outline || ''} ${chapter.sceneLocation || ''} ${chapter.sceneMood || ''} ${chapter.sceneGoal || ''}`
    const relevantMemories = await memoryManager.searchRelevant(storyId, queryText, prisma, 20, checkpointNumber)

    // 3. 加载 Runtime Base + Generation Worker Task
    const base = await loadRuntimeBase(storyId, prisma)
    const task = await loadWorkerTask(storyId, 'generation', prisma)

    // 5. 组装 User Message（Context Layers）
    const plotArcText = await getActivePlotArcs(prisma, storyId)

    const pipeline = new PromptPipeline(DEFAULT_PIPELINE_BUDGET)

    const pipelineResult = pipeline.run({
      story: `作品：《${story.title}》\n简介：${story.description || '无'}`,
      character: formatCharacterSnapshot(characters),
      lore: loreItems.map(l => `【${l.name}】${l.content}`).join('\n') || '无世界观设定信息',
      scene: `地点：${chapter.sceneLocation || '未设定'}\n氛围：${chapter.sceneMood || '未设定'}\n目标：${chapter.sceneGoal || '未设定'}`,
      memory: memoryManager.formatForPrompt(relevantMemories),
      timeline: timelineEvents.map(t => `第${t.day}天：${JSON.parse(t.events).join('；')}`).join('\n'),
      plotArc: plotArcText || undefined,
      output: `请根据以下大纲生成本章正文（约2000-4000字）：\n\n${chapter.outline || '无大纲'}`
    })
    const userMessage = pipelineResult.text

    // 6. 编译最终 Prompt
    const compiler = new RuntimePromptCompiler()
    const compiled = compiler.compile(base, task, userMessage)

    // 6. 调用 AI Provider 生成候选
    const drafts: string[] = []

    for (let i = 0; i < candidateCount; i++) {
      const temperature = 0.6 + i * 0.15
      let content: string

      try {
        app.log.info(`[Generate] Calling AI API (candidate ${String.fromCharCode(97 + i)}, temp=${temperature.toFixed(2)})`)
        const result = await callAIWithLog(app, {
          storyId,
          chapterId,
          callType: 'generate',
          compiled,
          temperature,
          maxTokens: 4096
        })
        content = result ?? generateFallbackContent(chapter, i, '未配置 API Key')
        app.log.info(`[Generate] AI returned ${content.length} chars`)
      } catch (err: any) {
        app.log.error(`[Generate] AI API failed: ${err.message}`)
        content = generateFallbackContent(chapter, i, err.message)
      }

      drafts.push(content)
    }

    // 8. 保存 Draft
    const createdDrafts = []
    for (let i = 0; i < drafts.length; i++) {
      const draft = await prisma.draft.create({
        data: {
          storyId,
          chapterId,
          version: `candidate_${String.fromCharCode(97 + i)}`,
          content: drafts[i],
          params: JSON.stringify({ temperature: 0.6 + i * 0.15, model: 'fallback', source: 'fallback' }),
          status: 'candidate'
        }
      })
      createdDrafts.push(draft)
    }

    // 9. 更新章节状态
    await prisma.chapter.update({
      where: { id: chapterId },
      data: { status: 'generated' }
    })

    app.log.info(`[Generate] Completed. Created ${createdDrafts.length} drafts.`)

    return { success: true, data: { drafts: createdDrafts, count: createdDrafts.length, tokens: compiled.meta, layers: pipelineResult.stats } }
  })

  // POST /api/chapters/:chapterId/select — 选择最终采用的 draft
  app.post('/api/chapters/:chapterId/select', async (request, reply) => {
    const { chapterId } = request.params as any
    const body = request.body as any

    const draft = await app.prisma.draft.findUnique({
      where: { id: body.draftId },
      include: { chapter: true }
    })
    if (!draft) return reply.status(404).send({ success: false, error: 'Draft not found' })

    await app.prisma.$transaction(async (tx) => {
      await tx.draft.updateMany({ where: { chapterId }, data: { status: 'rejected' } })
      await tx.draft.update({ where: { id: body.draftId }, data: { status: 'selected' } })
      await tx.chapter.update({ where: { id: chapterId }, data: { status: 'selected', content: draft.content || undefined } })
    })

    return { success: true }
  })

  // POST /api/chapters/:chapterId/archive — 归档章节并提取记忆/图谱/弧线（一次性，不可重复归档）
  app.post('/api/chapters/:chapterId/archive', async (request, reply) => {
    const { chapterId } = request.params as any

    const chapter = await app.prisma.chapter.findUnique({
      where: { id: chapterId },
      include: { story: true }
    })
    if (!chapter) return reply.status(404).send({ success: false, error: 'Chapter not found' })

    // 已归档则跳过（防止重复提取污染）
    if (chapter.status === 'archived') {
      app.log.info(`[Archive] Chapter ${chapterId} already archived, skipping`)
      return { success: true, data: { alreadyArchived: true } }
    }

    await app.prisma.chapter.update({ where: { id: chapterId }, data: { status: 'archived' } })

    // 合并提取（记忆 + 图谱 + 弧线，一次 API 调用）
    let extraction = null
    if (chapter.content) {
      try {
        extraction = await extractAndSaveAll(app, chapterId, chapter.storyId, chapter.content, chapter.outline || undefined)
        app.log.info(`[Archive] Combined extraction completed for chapter ${chapterId}`)
      } catch (err: any) {
        app.log.error(`[Archive] Combined extraction failed: ${err.message}`)
      }
    }

    // AI 记忆整理：对新旧记忆做语义层面的合并/更新/删除
    try {
      const organized = await organizeMemoriesAfterArchive(app, chapter.storyId, chapterId)
      app.log.info(`[Archive] Memory organized: merged=${organized.merged}, updated=${organized.updated}, deleted=${organized.deleted}`)
    } catch (err: any) {
      app.log.error(`[Archive] Memory organization failed: ${err.message}`)
    }

    return { success: true, data: { extraction } }
  })
}


