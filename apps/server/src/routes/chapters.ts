import type { FastifyInstance } from 'fastify'
import { generateQueue } from '../queue/index.js'
import { extractMemoryFromChapter, saveExtractedMemory } from '../services/memory-extractor.js'
import { extractGraphFromChapter, saveExtractedGraph } from '../services/graph-extractor.js'
import { extractPlotArcs, getActivePlotArcs } from '../services/plot-extractor.js'
import { PromptPipeline } from '@novel-runtime/prompt-runtime'
import { MemoryManager } from '@novel-runtime/memory-engine'
import { createProvider, RuntimePromptCompiler } from '@novel-runtime/ai-provider'
import { loadRuntimeBase, loadWorkerTask } from '../services/runtime-loader.js'

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
    const count = await app.prisma.chapter.count({ where: { storyId } })
    const chapter = await app.prisma.chapter.create({
      data: {
        storyId,
        number: count + 1,
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

    const memoryManager = new MemoryManager()
    const queryText = `${chapter.outline || ''} ${chapter.sceneLocation || ''} ${chapter.sceneMood || ''} ${chapter.sceneGoal || ''}`
    const relevantMemories = await memoryManager.searchRelevant(storyId, queryText, prisma, 20)

    const base = await loadRuntimeBase(storyId, prisma)
    const task = await loadWorkerTask(storyId, 'generation', prisma)
    const plotArcText = await getActivePlotArcs(prisma, storyId)

    const pipeline = new PromptPipeline({
      total: 64000,
      identity: 0, behavior: 0, jailbreak: 0, style: 2000,
      story: 12000, lore: 10000, character: 12000, scene: 12000,
      memory: 8000, timeline: 4000, plotArc: 3000, output: 16000
    })

    const pipelineResult = pipeline.run({
      story: `作品：《${story.title}》\n简介：${story.description || '无'}`,
      character: formatCharacterSnapshot(characters),
      lore: loreItems.map(l => `【${l.name}】${l.content}`).join('\n') || '无天道设定信息',
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
        preview: pipelineResult.text.slice(0, 2000) + (pipelineResult.text.length > 2000 ? '...' : '')
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

    // 2b. 语义检索相关记忆
    const memoryManager = new MemoryManager()
    const queryText = `${chapter.outline || ''} ${chapter.sceneLocation || ''} ${chapter.sceneMood || ''} ${chapter.sceneGoal || ''}`
    const relevantMemories = await memoryManager.searchRelevant(storyId, queryText, prisma, 20)

    // 3. 获取 AI 配置并创建 Provider
    const aiConfig = await prisma.aiProviderConfig.findFirst({ where: { isDefault: true } })
    const provider = aiConfig
      ? createProvider({
          name: aiConfig.name,
          apiKey: aiConfig.apiKey || undefined,
          baseUrl: aiConfig.baseUrl || undefined,
          model: aiConfig.model,
          maxTokens: aiConfig.maxTokens,
          temperature: aiConfig.temperature
        })
      : null

    // 4. 加载 Runtime Base + Generation Worker Task
    const base = await loadRuntimeBase(storyId, prisma)
    const task = await loadWorkerTask(storyId, 'generation', prisma)

    // 5. 组装 User Message（Context Layers）
    const plotArcText = await getActivePlotArcs(prisma, storyId)

    const pipeline = new PromptPipeline({
      total: 64000,
      identity: 0,
      behavior: 0,
      jailbreak: 0,
      style: 2000,
      story: 12000,
      lore: 10000,
      character: 12000,
      scene: 12000,
      memory: 8000,
      timeline: 4000,
      plotArc: 3000,
      output: 16000
    })

    const pipelineResult = pipeline.run({
      story: `作品：《${story.title}》\n简介：${story.description || '无'}`,
      character: formatCharacterSnapshot(characters),
      lore: loreItems.map(l => `【${l.name}】${l.content}`).join('\n') || '无天道设定信息',
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

    // 7. 调用 AI Provider 生成候选
    const drafts: string[] = []

    for (let i = 0; i < candidateCount; i++) {
      const temperature = 0.6 + i * 0.15
      let content: string

      if (provider?.generateWithRuntime) {
        try {
          app.log.info(`[Generate] Calling AI API (candidate ${String.fromCharCode(97 + i)}, temp=${temperature.toFixed(2)})`)
          content = await provider.generateWithRuntime(compiled, { temperature, maxTokens: 4096 })
          app.log.info(`[Generate] AI returned ${content.length} chars`)
        } catch (err: any) {
          app.log.error(`[Generate] AI API failed: ${err.message}`)
          content = generateFallback(chapter, i, err.message)
        }
      } else {
        app.log.warn('[Generate] No provider configured, using fallback')
        content = generateFallback(chapter, i, '未配置 API Key')
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
          params: JSON.stringify({ temperature: 0.6 + i * 0.15, model: aiConfig?.model || 'mock', source: aiConfig?.apiKey ? (aiConfig?.name || 'deepseek') : 'fallback' }),
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

    // 10. 提取记忆 + 图谱
    for (const draft of createdDrafts) {
      try {
        const memResult = await extractMemoryFromChapter(app, chapterId, storyId, draft.content)
        if (memResult) {
          await saveExtractedMemory(app, chapterId, storyId, memResult)
        }
      } catch (err: any) {
        app.log.error(`[Generate] Memory extraction failed: ${err.message}`)
      }

      try {
        const graphResult = await extractGraphFromChapter(app, chapterId, storyId, draft.content)
        if (graphResult) {
          await saveExtractedGraph(app, storyId, graphResult)
        }
      } catch (err: any) {
        app.log.error(`[Generate] Graph extraction failed: ${err.message}`)
      }
    }

    app.log.info(`[Generate] Completed. Created ${createdDrafts.length} drafts.`)

    return { success: true, data: { drafts: createdDrafts, count: createdDrafts.length, tokens: compiled.meta, layers: pipelineResult.stats } }
  })

  // POST /api/chapters/:chapterId/select — 同步阻塞，包含记忆提取
  app.post('/api/chapters/:chapterId/select', async (request, reply) => {
    const { chapterId } = request.params as any
    const body = request.body as any

    // 获取被采用的 draft 内容
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

    // 同步提取记忆
    let extractionResult: { memories: number; summary: string; timelineDay: number | null } | null = null
    if (draft.content) {
      app.log.info(`[Select] Starting memory extraction for chapter ${chapterId}`)
      try {
        const memResult = await extractMemoryFromChapter(app, chapterId, draft.storyId, draft.content)
        if (memResult) {
          await saveExtractedMemory(app, chapterId, draft.storyId, memResult)
          extractionResult = {
            memories: (memResult.mainEvents?.length || 0) + (memResult.sideEvents?.length || 0) + (memResult.emotions?.length || 0) + (memResult.foreshadowing?.length || 0) + (memResult.relationshipChanges?.length || 0) + Object.keys(memResult.characterStatusChanges || {}).length,
            summary: memResult.summary,
            timelineDay: memResult.timelineDay
          }
        }
        app.log.info(`[Select] Memory extraction completed: ${extractionResult?.memories || 0} memories`)
      } catch (err: any) {
        app.log.error(`[Select] Memory extraction failed: ${err.message}`)
      }

      // 图谱提取
      try {
        const graphResult = await extractGraphFromChapter(app, chapterId, draft.storyId, draft.content)
        if (graphResult) {
          await saveExtractedGraph(app, draft.storyId, graphResult)
          app.log.info(`[Select] Graph extraction completed: ${graphResult.nodes?.length || 0} nodes, ${graphResult.edges?.length || 0} edges`)
        }
      } catch (err: any) {
        app.log.error(`[Select] Graph extraction failed: ${err.message}`)
      }

      // 剧情弧线提取
      try {
        await extractPlotArcs(app, draft.storyId, chapterId, draft.content, draft.chapter?.outline || undefined)
        app.log.info(`[Select] Plot arc extraction completed`)
      } catch (err: any) {
        app.log.error(`[Select] Plot arc extraction failed: ${err.message}`)
      }
    }

    return { success: true, data: { extraction: extractionResult } }
  })

  // POST /api/chapters/:chapterId/archive
  app.post('/api/chapters/:chapterId/archive', async (request, reply) => {
    const { chapterId } = request.params as any
    await app.prisma.chapter.update({ where: { id: chapterId }, data: { status: 'archived' } })
    return { success: true }
  })
}

function formatCharacterSnapshot(characters: any[]): string {
  if (characters.length === 0) return '无角色信息'
  return characters.map(c => {
    const status = JSON.parse(c.status || '{}')
    const rels = JSON.parse(c.relationships || '{}')
    const statusStr = Object.entries(status).map(([k, v]) => `${k}:${v}`).join(', ')
    const relStr = Object.entries(rels).slice(0, 2).map(([k, v]) => `${k}-${v}`).join(', ')
    const parts = [`【${c.name}】`]
    if (statusStr) parts.push(`状态[${statusStr}]`)
    if (relStr) parts.push(`关系[${relStr}]`)
    return parts.join(' ')
  }).join('\n')
}

function generateFallback(chapter: any, index: number, reason: string): string {
  const styles = ['克制冷静', '情绪充沛', '戏剧化']
  return `【候选 ${String.fromCharCode(97 + index)} — ${styles[index] || '默认'}风格】（生成失败：${reason}）

${chapter.title}

${chapter.outline || '暂无大纲'}

林凡站在后山崖边，山风猎猎。他闭目凝神，体内灵力如潮水般涌动。${index === 0 ? '他一贯冷静克制，即使突破在即，面上也不见波澜。' : index === 1 ? '情绪翻涌，难以自抑，眼中竟有泪光闪动。' : '命运转折的时刻，天地色变，雷电交加。'}

远处，钟声悠悠传来……

【注：以上为降级模拟内容，真实 AI 生成失败原因：${reason}】`
}
