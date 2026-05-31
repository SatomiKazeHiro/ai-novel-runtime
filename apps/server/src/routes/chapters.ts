import type { FastifyInstance } from 'fastify'
import { generateQueue } from '../queue/index.js'
import { extractAndSaveAll } from '../services/combined-extractor.js'
import { organizeMemoriesAfterArchive } from '../services/memory-organizer.js'
import { getActivePlotArcs } from '../services/plot-extractor.js'
import { saveGraphSnapshotAndDelta } from '../services/graph-snapshot.js'
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
    const { versionBranchId } = request.query as any
    const where: any = { storyId }
    if (versionBranchId) where.versionBranchId = versionBranchId
    const chapters = await app.prisma.chapter.findMany({
      where,
      orderBy: { number: 'asc' }
    })
    return { success: true, data: chapters }
  })

  // 辅助函数：为番外分配小数序号（以 base 为基准，找第一个不冲突的 base + 0.01, base + 0.02...）
  // 返回负数表示溢出（超过 99 个番外）
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
      if (seq > 99) return -1 // 溢出标记
    }
  }

  // POST /api/stories/:storyId/chapters
  app.post('/api/stories/:storyId/chapters', async (request, reply) => {
    const { storyId } = request.params as any
    const body = request.body as any
    const isSideStory = body.isSideStory === true
    let number: number
    if (isSideStory && body.number !== undefined) {
      number = parseFloat(body.number)
    } else if (isSideStory) {
      const lastChapter = await app.prisma.chapter.findFirst({
        where: { storyId },
        orderBy: { number: 'desc' }
      })
      number = (lastChapter?.number || 0) + 0.5
    } else {
      const lastChapter = await app.prisma.chapter.findFirst({
        where: { storyId, isSideStory: false },
        orderBy: { number: 'desc' }
      })
      number = (lastChapter?.number || 0) + 1
    }

    // 新建根章节自动创建版本分支
    const versionBranch = await app.prisma.versionBranch.create({
      data: {
        storyId,
        name: body.versionBranchName || `主线·第${Math.floor(number)}章`
      }
    })

    const chapter = await app.prisma.chapter.create({
      data: {
        storyId,
        number,
        isSideStory,
        title: body.title,
        outline: body.outline || '',
        status: 'draft',
        versionBranchId: versionBranch.id
      }
    })
    return { success: true, data: chapter }
  })

  // GET /api/chapters/:chapterId
  app.get('/api/chapters/:chapterId', async (request, reply) => {
    const { chapterId } = request.params as any
    const chapter = await app.prisma.chapter.findUnique({
      where: { id: chapterId },
      include: { drafts: true, versionBranch: { select: { id: true, name: true } } }
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
      include: { story: true, versionBranch: true }
    })
    if (!chapter) return reply.status(404).send({ success: false, error: 'Chapter not found' })

    const vbId = chapter.versionBranchId
    const story = chapter.story

    // 查询角色并合并当前版本分支状态
    const characters = await prisma.character.findMany({ where: { storyId }, include: { branchStates: true } })
    const charactersWithBranchState = characters.map(c => {
      const bs = c.branchStates?.find((s: any) => s.versionBranchId === vbId)
      return { ...c, status: bs?.status || '{}', relationships: bs?.relationships || '{}' }
    })

    const loreItems = await prisma.loreItem.findMany({ where: { storyId } })
    const timelineEvents = await prisma.timelineEvent.findMany({ where: { storyId, versionBranchId: vbId }, orderBy: { day: 'asc' } })

    // 获取 checkpoint（同版本最后一个归档章节号）
    const checkpointChapter = await prisma.chapter.findFirst({
      where: { storyId, versionBranchId: vbId, status: 'archived' },
      orderBy: { number: 'desc' }
    })
    const checkpointNumber = checkpointChapter?.number || 0

    const memoryManager = new MemoryManager()
    const queryText = `${chapter.outline || ''} ${chapter.sceneLocation || ''} ${chapter.sceneMood || ''} ${chapter.sceneGoal || ''}`
    const relevantMemories = await memoryManager.searchRelevant(storyId, queryText, prisma, 20, checkpointNumber, vbId)

    const base = await loadRuntimeBase(storyId, prisma)
    const task = await loadWorkerTask(storyId, 'generation', prisma)
    const plotArcText = await getActivePlotArcs(prisma, storyId, vbId)

    // 读取默认模型配置，动态调整预算
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

  // POST /api/chapters/:chapterId/generate — 异步生成（创建 Draft 后入队，立即返回）
  app.post('/api/chapters/:chapterId/generate', async (request, reply) => {
    const { chapterId } = request.params as any
    const body = request.body as any
    const storyId = body.storyId
    const candidateCount = body.candidateCount || 3
    const temperatures = body.temperatures || [0.6, 0.75, 0.9]
    const customMaxTokens = body.maxTokens

    app.log.info(`[Generate] Async generation started for chapter ${chapterId}, candidates: ${candidateCount}`)

    const prisma = app.prisma

    // 1. 获取章节信息
    const chapter = await prisma.chapter.findUnique({
      where: { id: chapterId },
      include: { story: true, versionBranch: true }
    })
    if (!chapter) return reply.status(404).send({ success: false, error: 'Chapter not found' })

    // 2. 获取上下文（按版本隔离）
    const vbId = chapter.versionBranchId
    const story = chapter.story

    // 查询角色并合并当前版本分支状态
    const characters = await prisma.character.findMany({ where: { storyId }, include: { branchStates: true } })
    const charactersWithBranchState = characters.map(c => {
      const bs = c.branchStates?.find((s: any) => s.versionBranchId === vbId)
      return { ...c, status: bs?.status || '{}', relationships: bs?.relationships || '{}' }
    })

    const loreItems = await prisma.loreItem.findMany({ where: { storyId } })
    const timelineEvents = await prisma.timelineEvent.findMany({ where: { storyId, versionBranchId: vbId }, orderBy: { day: 'asc' } })

    // 2a. 获取 checkpoint（同版本）
    const checkpointChapter = await prisma.chapter.findFirst({
      where: { storyId, versionBranchId: vbId, status: 'archived' },
      orderBy: { number: 'desc' }
    })
    const checkpointNumber = checkpointChapter?.number || 0

    // 2b. 语义检索相关记忆（同版本）
    const memoryManager = new MemoryManager()
    const queryText = `${chapter.outline || ''} ${chapter.sceneLocation || ''} ${chapter.sceneMood || ''} ${chapter.sceneGoal || ''}`
    const relevantMemories = await memoryManager.searchRelevant(storyId, queryText, prisma, 20, checkpointNumber, vbId)

    // 3. 加载 Runtime Base + Generation Worker Task
    const base = await loadRuntimeBase(storyId, prisma)
    const task = await loadWorkerTask(storyId, 'generation', prisma)
    const plotArcText = await getActivePlotArcs(prisma, storyId, vbId)

    // 读取默认模型配置，动态调整预算
    const aiConfig = await prisma.aiProviderConfig.findFirst({ where: { isDefault: true } })
    const contextLength = aiConfig?.contextLength || DEFAULT_PIPELINE_BUDGET.total
    const maxTokens = customMaxTokens || aiConfig?.maxTokens || 4096
    const budget = scaleBudget(contextLength)

    // 5. 组装 Prompt
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

  // POST /api/chapters/:chapterId/archive — 归档章节并提取记忆/图谱/弧线
  app.post('/api/chapters/:chapterId/archive', async (request, reply) => {
    const { chapterId } = request.params as any

    const chapter = await app.prisma.chapter.findUnique({
      where: { id: chapterId },
      include: { story: true }
    })
    if (!chapter) return reply.status(404).send({ success: false, error: 'Chapter not found' })

    if (chapter.status === 'archived') {
      app.log.info(`[Archive] Chapter ${chapterId} already archived, skipping`)
      return { success: true, data: { alreadyArchived: true } }
    }

    await app.prisma.chapter.update({ where: { id: chapterId }, data: { status: 'archived' } })

    const vbId = chapter.versionBranchId

    let extraction = null
    if (chapter.content) {
      try {
        extraction = await extractAndSaveAll(app, chapterId, chapter.storyId, chapter.content, chapter.outline || undefined)
        app.log.info(`[Archive] Combined extraction completed for chapter ${chapterId}`)
      } catch (err: any) {
        app.log.error(`[Archive] Combined extraction failed: ${err.message}`)
      }
    }

    try {
      const organized = await organizeMemoriesAfterArchive(app, chapter.storyId, chapterId, vbId)
      app.log.info(`[Archive] Memory organized: merged=${organized.merged}, updated=${organized.updated}, deleted=${organized.deleted}`)
    } catch (err: any) {
      app.log.error(`[Archive] Memory organization failed: ${err.message}`)
    }

    let graphResult = null
    try {
      graphResult = await saveGraphSnapshotAndDelta(app, chapterId, chapter.storyId, vbId)
    } catch (err: any) {
      app.log.error(`[Archive] Graph snapshot failed: ${err.message}`)
    }

    return { success: true, data: { extraction, graph: graphResult } }
  })

  // POST /api/chapters/:chapterId/develop — 在指定章节上"发展"出下一章/番外
  app.post('/api/chapters/:chapterId/develop', async (request, reply) => {
    const { chapterId } = request.params as any
    const body = request.body as any
    const prisma = app.prisma

    const parentChapter = await prisma.chapter.findUnique({
      where: { id: chapterId },
      include: { story: true }
    })
    if (!parentChapter) return reply.status(404).send({ success: false, error: 'Chapter not found' })

    const isSideStory = body.isSideStory === true
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

    // 版本自动分配逻辑
    let newVersionBranchId = parentChapter.versionBranchId
    if (!isSideStory) {
      // 检查父章节是否已有后续子章节（非番外）
      const existingChildren = await prisma.chapter.count({
        where: { parentChapterId: chapterId, isSideStory: false }
      })
      if (existingChildren > 0) {
        // 有后续子章节 → 自动创建新版本分支
        const newVersionBranch = await prisma.versionBranch.create({
          data: {
            storyId: parentChapter.storyId,
            name: body.versionBranchName || `从${parentChapter.title || `第${parentChapter.number}章`}分叉`,
            forkFromChapterId: chapterId,
            forkFromVersionId: parentChapter.versionBranchId
          }
        })
        newVersionBranchId = newVersionBranch.id
      }
    }

    const newChapter = await prisma.chapter.create({
      data: {
        storyId: parentChapter.storyId,
        parentChapterId: chapterId,
        versionBranchId: newVersionBranchId,
        number,
        isSideStory,
        title: body.title || (isSideStory ? `番外·${number}` : `第${Math.floor(number)}章`),
        outline: body.outline || '',
        status: 'draft',
        runtimeProfileId: body.runtimeProfileId || parentChapter.runtimeProfileId || parentChapter.story?.runtimeProfileId || null
      }
    })

    app.log.info(`[Develop] Chapter ${chapterId} → new chapter ${newChapter.id} (number=${number}, versionBranch=${newVersionBranchId})`)
    return { success: true, data: newChapter }
  })

  // GET /api/stories/:storyId/chapter-tree — 获取章节分支树
  app.get('/api/stories/:storyId/chapter-tree', async (request, reply) => {
    const { storyId } = request.params as any
    const prisma = app.prisma

    const allChapters = await prisma.chapter.findMany({
      where: { storyId },
      orderBy: { createdAt: 'asc' },
      include: { runtimeProfile: { select: { name: true } }, versionBranch: { select: { name: true } } }
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

  // GET /api/stories/:storyId/version-branches — 获取版本分支列表
  app.get('/api/stories/:storyId/version-branches', async (request, reply) => {
    const { storyId } = request.params as any
    const branches = await app.prisma.versionBranch.findMany({
      where: { storyId },
      orderBy: { createdAt: 'asc' }
    })
    return { success: true, data: branches }
  })

  // GET /api/stories/:storyId/version-branches/:branchId/chain — 获取版本链（含祖先）
  app.get('/api/stories/:storyId/version-branches/:branchId/chain', async (request, reply) => {
    const { storyId, branchId } = request.params as any
    const prisma = app.prisma

    // 递归收集版本链
    const chainIds: string[] = []
    let currentId: string | null = branchId
    const visited = new Set<string>()

    while (currentId && !visited.has(currentId)) {
      visited.add(currentId)
      chainIds.push(currentId)
      const branch = await prisma.versionBranch.findUnique({
        where: { id: currentId },
        select: { forkFromVersionId: true }
      })
      currentId = branch?.forkFromVersionId || null
    }

    // 查询链上所有章节（当前版本 + 祖先版本）
    const allChapters = await prisma.chapter.findMany({
      where: { storyId, versionBranchId: { in: chainIds } },
      orderBy: { number: 'asc' },
      include: { runtimeProfile: { select: { name: true } }, versionBranch: { select: { name: true } } }
    })

    // 标记每个章节所属版本关系
    const data = allChapters.map((c: any) => ({
      ...c,
      isAncestorVersion: c.versionBranchId !== branchId
    }))

    return { success: true, data }
  })

  // PUT /api/version-branches/:branchId — 修改版本分支名称
  app.put('/api/version-branches/:branchId', async (request, reply) => {
    const { branchId } = request.params as any
    const body = request.body as any
    const branch = await app.prisma.versionBranch.update({
      where: { id: branchId },
      data: { name: body.name }
    })
    return { success: true, data: branch }
  })
}
