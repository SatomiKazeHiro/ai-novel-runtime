import type { FastifyInstance } from 'fastify'
import { generateQueue } from '../queue/index.js'
import { extractAndSaveAll } from '../services/combined-extractor.js'
import { optimizeMemories } from '../services/memory-optimizer.js'
import { getActivePlotArcs } from '../services/plot-extractor.js'
import { saveGraphSnapshotAndDelta, type GraphSnapshot } from '../services/graph-snapshot.js'
import { organizeGraph } from '../services/graph-organizer.js'
import { PromptPipeline } from '@novel-runtime/prompt-runtime'
import { MemoryManager } from '@novel-runtime/memory-engine'
import { RuntimePromptCompiler, estimateTokens } from '@novel-runtime/ai-provider'
import { formatCharacterSnapshot, generateFallbackContent, DEFAULT_PIPELINE_BUDGET, scaleBudget } from '@novel-runtime/shared'
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

  // 辅助函数：为番外分配小数序号
  async function allocateSideStoryNumber(prisma: any, storyId: string, baseNumber: number): Promise<number> {
    const existing = await prisma.chapter.findMany({
      where: { storyId },
      select: { number: true }
    })
    const existingNumbers = existing.map((c: any) => c.number)
    let seq = 1
    while (true) {
      const candidate = Math.round((baseNumber + seq * 0.01) * 100) / 100
      if (!existingNumbers.some((n: number) => Math.abs(n - candidate) < 0.0001)) {
        return candidate
      }
      seq++
      if (seq > 99) return -1
    }
  }

  // 辅助函数：获取故事下最新章节（number 最大的）
  async function getLastChapter(prisma: any, storyId: string) {
    return prisma.chapter.findFirst({
      where: { storyId },
      orderBy: { number: 'desc' }
    })
  }

  // 辅助函数：获取角色的最新状态（历史表模式）
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

  // POST /api/stories/:storyId/chapters
  app.post('/api/stories/:storyId/chapters', async (request, reply) => {
    const { storyId } = request.params as any
    const body = request.body as any

    const existingCount = await app.prisma.chapter.count({ where: { storyId } })
    if (existingCount > 0) {
      return reply.status(400).send({ success: false, error: '已有章节，无法新建根章节' })
    }

    // 无章节时强制非番外
    const isSideStory = false
    const lastChapter = await app.prisma.chapter.findFirst({
      where: { storyId, isSideStory: false },
      orderBy: { number: 'desc' }
    })
    const number = (lastChapter?.number || 0) + 1

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
    const prisma = app.prisma

    const chapter = await prisma.chapter.findUnique({
      where: { id: chapterId },
      include: { childChapters: true }
    })
    if (!chapter) return reply.status(404).send({ success: false, error: 'Chapter not found' })

    // 已归档且有子章节的不可删除
    if (chapter.status === 'archived' && chapter.childChapters.length > 0) {
      return reply.status(400).send({ success: false, error: '已归档且有子章节的章节不可删除' })
    }

    // 只能删除末尾章节（number 最大的），除非是非归档的草稿/生成中/已选中章节
    if (chapter.status === 'archived') {
      const lastChapter = await getLastChapter(prisma, chapter.storyId)
      if (lastChapter && lastChapter.id !== chapterId) {
        return reply.status(400).send({ success: false, error: '只能按顺序从末尾删除已归档章节' })
      }
      // 如果是末尾章节，检查是否有番外需要先删除
      const sideStories = await prisma.chapter.findMany({
        where: { storyId: chapter.storyId, isSideStory: true },
        orderBy: { number: 'desc' }
      })
      // 如果存在 number > chapter.number 的番外？不，番外是挂在父章节下的
      // 实际上番外的 parentChapterId 指向任意章节，番外的 number 可能是小数
      // 删除末尾章节时，番外可能 number 比它大也可能比它小
      // 这里简化：如果该章节有 childChapters（已在上面拦截），或者存在 number 更大的番外
      const maxSideStory = sideStories[0]
      if (maxSideStory && maxSideStory.number > chapter.number) {
        return reply.status(400).send({ success: false, error: '存在尚未删除的番外，请先删除番外' })
      }
    }

    // 级联清理：删除同 fromChapterNumber 的派生数据
    if (chapter.status === 'archived' && chapter.number > 0) {
      try {
        const { count: memCount } = await prisma.memory.deleteMany({
          where: { storyId: chapter.storyId, fromChapterNumber: chapter.number }
        })
        const { count: teCount } = await prisma.timelineEvent.deleteMany({
          where: { storyId: chapter.storyId, fromChapterNumber: chapter.number }
        })
        const { count: bsCount } = await prisma.characterBranchState.deleteMany({
          where: { fromChapterNumber: chapter.number }
        })
        app.log.info(`[Delete] Cascade cleanup for chapter ${chapter.number}: memory=${memCount}, timeline=${teCount}, branchState=${bsCount}`)
      } catch (err: any) {
        app.log.error(`[Delete] Cascade cleanup failed: ${err.message}`)
      }
    }

    // 删除后重建图谱：用剩余最新章节的 snapshot 回退
    const { rebuildGraphFromSnapshot } = await import('../services/graph-snapshot.js')
    const prevChapter = await prisma.chapter.findFirst({
      where: { storyId: chapter.storyId, status: 'archived' },
      orderBy: { number: 'desc' }
    })
    if (prevChapter?.graphSnapshot) {
      try {
        const snapshot = JSON.parse(prevChapter.graphSnapshot)
        await rebuildGraphFromSnapshot(prisma, chapter.storyId, snapshot)
        app.log.info(`[Delete] Rebuilt graph from chapter ${prevChapter.number} snapshot`)
      } catch (err: any) {
        app.log.error(`[Delete] Graph rebuild failed: ${err.message}`)
      }
    } else {
      await prisma.graphEdge.deleteMany({ where: { storyId: chapter.storyId } })
      await prisma.graphNode.deleteMany({ where: { storyId: chapter.storyId } })
      app.log.info(`[Delete] Cleared all graph data for story ${chapter.storyId}`)
    }

    await prisma.chapter.delete({ where: { id: chapterId } })
    return { success: true }
  })

  // POST /api/chapters/:chapterId/preview
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

    // 生成限制：只能在最新章节上生成
    const lastChapter = await getLastChapter(prisma, chapter.storyId)
    if (lastChapter && lastChapter.id !== chapterId) {
      return reply.status(400).send({ success: false, error: '只能在最新章节上生成内容' })
    }

    const story = chapter.story

    // 查询角色并合并最新状态
    const charactersWithBranchState = await getCharactersWithLatestState(prisma, storyId)

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
        preview: pipelineResult.text,
        compiled,
        model: aiConfig ? { name: aiConfig.name, model: aiConfig.model, contextLength, maxTokens: aiConfig.maxTokens } : null
      }
    }
  })

  // POST /api/chapters/:chapterId/generate
  app.post('/api/chapters/:chapterId/generate', async (request, reply) => {
    const { chapterId } = request.params as any
    const body = request.body as any
    const storyId = body.storyId
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

    const story = chapter.story

    const charactersWithBranchState = await getCharactersWithLatestState(prisma, storyId)

    const loreItems = await prisma.loreItem.findMany({ where: { storyId } })
    const timelineEvents = await prisma.timelineEvent.findMany({ where: { storyId }, orderBy: { day: 'asc' } })

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

    if (customCompiled && customCompiled.systemMessage && customCompiled.userMessage) {
      const systemTokens = estimateTokens(customCompiled.systemMessage)
      const userTokens = estimateTokens(customCompiled.userMessage)
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
        timeline: timelineEvents.map(t => `第${t.day}天：${JSON.parse(t.events).join('；')}`).join('\n'),
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

  // POST /api/chapters/:chapterId/archive
  app.post('/api/chapters/:chapterId/archive', async (request, reply) => {
    const { chapterId } = request.params as any
    const prisma = app.prisma

    const chapter = await prisma.chapter.findUnique({
      where: { id: chapterId },
      include: { story: true }
    })
    if (!chapter) return reply.status(404).send({ success: false, error: 'Chapter not found' })

    if (chapter.status === 'archived') {
      app.log.info(`[Archive] Chapter ${chapterId} already archived, skipping`)
      return { success: true, data: { alreadyArchived: true } }
    }

    // 番外不触发任何提取，直接归档
    if (chapter.isSideStory) {
      await prisma.chapter.update({ where: { id: chapterId }, data: { status: 'archived' } })
      app.log.info(`[Archive] Side story ${chapterId} archived without extraction`)
      return { success: true, data: { sideStory: true } }
    }

    // 主线无正文：直接归档（无内容可提取）
    if (!chapter.content) {
      await prisma.chapter.update({ where: { id: chapterId }, data: { status: 'archived' } })
      return { success: true, data: { noContent: true } }
    }

    // 主线有正文：全部步骤成功后统一归档
    let extraction = null
    try {
      extraction = await extractAndSaveAll(app, chapterId, chapter.storyId, chapter.content, chapter.outline || undefined, chapter.number)
      app.log.info(`[Archive] Combined extraction completed for chapter ${chapterId}`)
    } catch (err: any) {
      app.log.error(`[Archive] Combined extraction failed: ${err.message}`)
      return reply.status(500).send({
        success: false,
        error: `归档失败：内容提取出错（${err.message}）。章节状态未变更，请检查 AI 配置后重试。`
      })
    }

    // graph organizer：合并上一章全局 + 本章提取
    let previousSnapshot: GraphSnapshot | null = null
    if (chapter.parentChapterId) {
      const parent = await prisma.chapter.findUnique({
        where: { id: chapter.parentChapterId },
        select: { graphSnapshot: true }
      })
      if (parent?.graphSnapshot) {
        previousSnapshot = JSON.parse(parent.graphSnapshot)
      }
    }
    if (!previousSnapshot) {
      const lastArchived = await prisma.chapter.findFirst({
        where: { storyId: chapter.storyId, status: 'archived', id: { not: chapterId } },
        orderBy: { number: 'desc' },
        select: { graphSnapshot: true }
      })
      if (lastArchived?.graphSnapshot) {
        previousSnapshot = JSON.parse(lastArchived.graphSnapshot)
      }
    }

    const graphRaw = extraction?.graph || { nodes: [], edges: [] }
    const graphOrganized = await organizeGraph(app, chapter.storyId, chapterId, previousSnapshot, graphRaw)
    if (!graphOrganized) {
      return reply.status(500).send({
        success: false,
        error: `归档失败：知识图谱整理出错。章节状态未变更，请检查 AI 配置后重试。`
      })
    }

    const graphSaved = await saveGraphSnapshotAndDelta(app, chapterId, chapter.storyId, graphOrganized)
    if (!graphSaved) {
      return reply.status(500).send({
        success: false,
        error: `归档失败：知识图谱保存出错。章节状态未变更，请检查后重试。`
      })
    }

    // 记忆优化（生成全局记忆）
    let optimizedCount = 0
    try {
      optimizedCount = await optimizeMemories(app, chapter.storyId, chapterId, chapter.number)
      app.log.info(`[Archive] Memory optimized: ${optimizedCount} global memories`)
    } catch (err: any) {
      app.log.error(`[Archive] Memory optimization failed: ${err.message}`)
      return reply.status(500).send({
        success: false,
        error: `归档失败：记忆优化出错（${err.message}）。章节状态未变更，请检查 AI 配置后重试。`
      })
    }

    // 全部成功后：正式归档
    await prisma.chapter.update({ where: { id: chapterId }, data: { status: 'archived' } })

    return {
      success: true,
      data: { extraction, optimizedCount, graph: graphSaved }
    }
  })

  // POST /api/chapters/:chapterId/develop
  app.post('/api/chapters/:chapterId/develop', async (request, reply) => {
    const { chapterId } = request.params as any
    const body = request.body as any
    const prisma = app.prisma

    const parentChapter = await prisma.chapter.findUnique({
      where: { id: chapterId },
      include: { story: true }
    })
    if (!parentChapter) return reply.status(404).send({ success: false, error: 'Chapter not found' })

    // 校验：只能从 archived 或 selected 的章节发展
    if (!['archived', 'selected'].includes(parentChapter.status)) {
      return reply.status(400).send({ success: false, error: '只能从已归档或已选中的章节发展' })
    }

    const isSideStory = body.isSideStory === true

    // 已有子章节的只能发展番外
    const hasChildren = await prisma.chapter.count({ where: { parentChapterId: chapterId } })
    if (hasChildren > 0 && !isSideStory) {
      return reply.status(400).send({ success: false, error: '该章节已有后续章节，只能发展番外章节' })
    }

    // 主线只能从最新章节发展
    if (!isSideStory) {
      const lastChapter = await getLastChapter(prisma, parentChapter.storyId)
      if (lastChapter && lastChapter.id !== chapterId) {
        return reply.status(400).send({ success: false, error: '主线章节只能从最新章节继续发展' })
      }
    }

    // 计算新章节的序号
    let number: number
    if (isSideStory && body.number !== undefined) {
      number = parseFloat(body.number)
    } else if (isSideStory) {
      const allocated = await allocateSideStoryNumber(prisma, parentChapter.storyId, parentChapter.number)
      if (allocated < 0) {
        return reply.status(400).send({
          success: false,
          error: `该章节的番外数量已达上限（99个），建议归档整理或合并分支后再试`
        })
      }
      number = allocated
    } else {
      const lastSibling = await prisma.chapter.findFirst({
        where: { storyId: parentChapter.storyId, parentChapterId: chapterId },
        orderBy: { number: 'desc' }
      })
      number = lastSibling ? lastSibling.number + 1 : (parentChapter.number + 1)
    }

    const newChapter = await prisma.chapter.create({
      data: {
        storyId: parentChapter.storyId,
        parentChapterId: chapterId,
        number,
        isSideStory,
        title: body.title || (isSideStory ? `番外·${number}` : `第${Math.floor(number)}章`),
        outline: body.outline || '',
        status: 'draft',
        runtimeProfileId: body.runtimeProfileId || parentChapter.runtimeProfileId || parentChapter.story?.runtimeProfileId || null
      }
    })

    app.log.info(`[Develop] Chapter ${chapterId} → new chapter ${newChapter.id} (number=${number})`)
    return { success: true, data: newChapter }
  })

  // GET /api/stories/:storyId/chapter-tree
  app.get('/api/stories/:storyId/chapter-tree', async (request, reply) => {
    const { storyId } = request.params as any
    const prisma = app.prisma

    const allChapters = await prisma.chapter.findMany({
      where: { storyId },
      orderBy: { createdAt: 'asc' },
      include: { runtimeProfile: { select: { name: true } } }
    })

    const chapterMap = new Map(allChapters.map(c => [c.id, { ...c, children: [] as any[] }]))
    const roots: any[] = []

    for (const ch of allChapters) {
      const node = chapterMap.get(ch.id)!
      if (ch.parentChapterId && chapterMap.has(ch.parentChapterId)) {
        chapterMap.get(ch.parentChapterId)!.children.push(node)
      } else {
        roots.push(node)
      }
    }

    return { success: true, data: roots }
  })
}
