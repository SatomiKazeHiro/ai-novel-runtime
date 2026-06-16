import type { FastifyInstance } from 'fastify'
import { generateQueue } from '../queue/index.js'
import { extractAll, prepareArchiveData, type PendingArchiveData } from '../services/combined-extractor.js'
import { optimizeMemories } from '../services/memory-optimizer.js'
import { getActivePlotArcs, preparePlotArcWrites, commitPlotArcWrites } from '../services/plot-extractor.js'
import { saveGraphSnapshotAndDelta, type GraphSnapshot } from '../services/graph-snapshot.js'
import { organizeGraph } from '../services/graph-organizer.js'
import { prepareMemoryWrites, commitMemoryWrites } from '../services/memory-extractor.js'
import { PromptPipeline } from '@novel-runtime/prompt-runtime'
import { MemoryManager } from '@novel-runtime/memory-engine'
import { RuntimePromptCompiler, estimateTokens } from '@novel-runtime/ai-provider'
import { formatCharacterSnapshot, generateFallbackContent, DEFAULT_PIPELINE_BUDGET, scaleBudget, safeJsonParse } from '@novel-runtime/shared'
import { loadRuntimeBase, loadWorkerTask } from '../services/runtime-loader.js'
import { callAIWithLog } from '../services/ai-call-logger.js'

export async function chapterRoutes(app: FastifyInstance) {
  // 状态转换校验已下线（Q#3 决策 2026-06-16：helper 死代码，删除直至需要集中校验时再回填）。
  // 当前每个路由用 `chapter.status === 'xxx'` 内联校验。

  function assertStatusIn(
    chapter: { id: string; status: string; number: number },
    allowedStatuses: string[],
    operation: string
  ) {
    if (!allowedStatuses.includes(chapter.status)) {
      throw new Error(`章节 ${chapter.number} 当前状态为 ${chapter.status}，不允许执行 ${operation}`)
    }
  }

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

    const chapter = await app.prisma.chapter.findUnique({ where: { id: chapterId } })
    if (!chapter) return reply.status(404).send({ success: false, error: 'Chapter not found' })

    // archived 章节只读，不允许任何修改
    if (chapter.status === 'archived') {
      return reply.status(400).send({ success: false, error: '已归档章节不可修改' })
    }

    // 禁止直接通过 PUT 修改 status，状态转换必须通过专门接口
    if (body.status !== undefined) {
      return reply.status(400).send({ success: false, error: '不允许直接修改 status 字段' })
    }

    const data: any = {}
    if (body.title !== undefined) data.title = body.title
    if (body.outline !== undefined) data.outline = body.outline
    if (body.content !== undefined) data.content = body.content
    if (body.sceneLocation !== undefined) data.sceneLocation = body.sceneLocation
    if (body.sceneMood !== undefined) data.sceneMood = body.sceneMood
    if (body.sceneGoal !== undefined) data.sceneGoal = body.sceneGoal
    if (body.aiProviderConfigId !== undefined) data.aiProviderConfigId = body.aiProviderConfigId || null

    // reviewing 状态只允许调整 content 和 pendingArchiveData
    if (chapter.status === 'reviewing') {
      const allowedKeys = ['content', 'pendingArchiveData']
      const receivedKeys = Object.keys(data)
      const invalidKeys = receivedKeys.filter(k => !allowedKeys.includes(k))
      if (invalidKeys.length > 0) {
        return reply.status(400).send({
          success: false,
          error: `reviewing 状态不允许修改以下字段：${invalidKeys.join(', ')}`
        })
      }
    }

    const updated = await app.prisma.chapter.update({ where: { id: chapterId }, data })
    return { success: true, data: updated }
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
        const snapshot = safeJsonParse(prevChapter.graphSnapshot, null)
        if (snapshot) await rebuildGraphFromSnapshot(prisma, chapter.storyId, snapshot)
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

    // 如果这是最后一个章节，清理故事级别的派生数据
    const remainingChapters = await prisma.chapter.count({
      where: { storyId: chapter.storyId }
    })
    if (remainingChapters === 0) {
      try {
        const { count: arcCount } = await prisma.plotArc.deleteMany({
          where: { storyId: chapter.storyId }
        })
        const { count: logCount } = await prisma.promptLog.deleteMany({
          where: { storyId: chapter.storyId }
        })
        // GraphNode/GraphEdge 已经在上面 else 分支清理，但如果走的是 rebuild 路径没清理，这里兜底
        const { count: edgeCount } = await prisma.graphEdge.deleteMany({
          where: { storyId: chapter.storyId }
        })
        const { count: nodeCount } = await prisma.graphNode.deleteMany({
          where: { storyId: chapter.storyId }
        })
        app.log.info(`[Delete] Last chapter removed. Cleaned plotArc=${arcCount}, promptLog=${logCount}, graphNode=${nodeCount}, graphEdge=${edgeCount}`)
      } catch (err: any) {
        app.log.error(`[Delete] Final cleanup failed: ${err.message}`)
      }
    }

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
      timeline: timelineEvents.map(t => `第${t.day}天：${safeJsonParse<string[]>(t.events, []).join('；')}`).join('\n'),
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

    // 只允许 draft 或 generated 状态生成候选；generated 表示用户想重新生成
    if (chapter.status === 'generating') {
      return reply.status(400).send({
        success: false,
        error: '章节正在生成中，请等待当前生成完成后再试'
      })
    }
    if (chapter.status !== 'draft' && chapter.status !== 'generated') {
      return reply.status(400).send({
        success: false,
        error: `章节当前状态为 ${chapter.status}，只允许 draft 或 generated 状态生成候选`
      })
    }

    // 如果已有候选，用户重新生成时先清空旧候选
    if (chapter.status === 'generated') {
      const deleted = await prisma.draft.deleteMany({ where: { chapterId } })
      await prisma.chapter.update({ where: { id: chapterId }, data: { status: 'draft' } })
      app.log.info(`[Generate] Cleared ${deleted.count} old drafts for chapter ${chapterId} before regenerating`)
    }

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
        timeline: timelineEvents.map(t => `第${t.day}天：${safeJsonParse<string[]>(t.events, []).join('；')}`).join('\n'),
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

    const chapter = await app.prisma.chapter.findUnique({ where: { id: chapterId } })
    if (!chapter) return reply.status(404).send({ success: false, error: 'Chapter not found' })

    // 只允许 generated 状态选择候选
    if (chapter.status !== 'generated') {
      return reply.status(400).send({
        success: false,
        error: `章节当前状态为 ${chapter.status}，只允许 generated 状态选择候选`
      })
    }

    // Cross-chapter isolation: draftId must belong to current chapterId.
    // Use the compound unique key (id_chapterId) so the lookup is atomic.
    const draft = await app.prisma.draft.findUnique({
      where: { id_chapterId: { id: body.draftId, chapterId } }
    })
    if (!draft) return reply.status(404).send({ success: false, error: 'Draft not found' })

    await app.prisma.$transaction(async (tx) => {
      await tx.draft.updateMany({ where: { chapterId }, data: { status: 'rejected' } })
      await tx.draft.update({ where: { id: body.draftId }, data: { status: 'selected' } })
      await tx.chapter.update({ where: { id: chapterId }, data: { status: 'selected', content: draft.content || undefined } })
    })

    return { success: true }
  })

  // POST /api/chapters/:chapterId/prepare-archive
  app.post('/api/chapters/:chapterId/prepare-archive', async (request, reply) => {
    const { chapterId } = request.params as any
    const prisma = app.prisma

    const chapter = await prisma.chapter.findUnique({
      where: { id: chapterId },
      include: { story: true }
    })
    if (!chapter) return reply.status(404).send({ success: false, error: 'Chapter not found' })

    // 只允许 selected 状态进入 reviewing
    if (chapter.status !== 'selected') {
      return reply.status(400).send({
        success: false,
        error: `章节当前状态为 ${chapter.status}，只允许 selected 状态准备归档`
      })
    }

    // 番外不触发提取，直接归档
    if (chapter.isSideStory) {
      await prisma.chapter.update({ where: { id: chapterId }, data: { status: 'archived' } })
      return { success: true, data: { sideStory: true, status: 'archived' } }
    }

    // 主线无正文：直接归档
    if (!chapter.content) {
      await prisma.chapter.update({ where: { id: chapterId }, data: { status: 'archived' } })
      return { success: true, data: { noContent: true, status: 'archived' } }
    }

    const outlineText = chapter.outline || ''
    const contentText = chapter.content || ''
    if (!outlineText.trim()) {
      return reply.status(400).send({ success: false, error: '归档失败：大纲不能为空' })
    }
    if (!contentText.trim()) {
      return reply.status(400).send({ success: false, error: '归档失败：正文不能为空' })
    }
    if (contentText.length < outlineText.length) {
      return reply.status(400).send({
        success: false,
        error: `归档失败：正文长度（${contentText.length}）不能小于大纲长度（${outlineText.length}）`
      })
    }

    let pending: PendingArchiveData | null = null
    try {
      pending = await prepareArchiveData(
        app,
        chapterId,
        chapter.storyId,
        contentText,
        chapter.outline,
        chapter.number,
        chapter.parentChapterId
      )
    } catch (err: any) {
      // Rollback: revert chapter.status to 'selected' (defensive — the
      // current code puts the status update after this block, so this
      // guards future reordering where the flip might move ahead of
      // the AI call).
      await prisma.chapter.update({
        where: { id: chapterId },
        data: { status: 'selected' }
      }).catch(() => { /* swallow rollback failure */ })
      app.log.error(`[Prepare-Archive] Failed for chapter ${chapterId}: ${err.message}`)
      return reply.status(500).send({
        success: false,
        error: `准备归档失败：AI 提取出错（${err.message}）。请检查 AI 配置后重试。`
      })
    }

    if (!pending) {
      return reply.status(500).send({
        success: false,
        error: '准备归档失败：AI 提取返回为空，请检查 AI 配置后重试'
      })
    }

    await prisma.chapter.update({
      where: { id: chapterId },
      data: {
        status: 'reviewing',
        pendingArchiveData: JSON.stringify(pending)
      }
    })

    return { success: true, data: pending }
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

    // 只允许 reviewing 状态确认归档
    if (chapter.status !== 'reviewing') {
      return reply.status(400).send({
        success: false,
        error: `章节当前状态为 ${chapter.status}，只允许 reviewing 状态确认归档`
      })
    }

    // 番外或无正文：prepare-archive 阶段已处理，这里兜底
    if (chapter.isSideStory || !chapter.content) {
      await prisma.chapter.update({
        where: { id: chapterId },
        data: { status: 'archived', pendingArchiveData: null }
      })
      return { success: true, data: { skipped: true } }
    }

    const pending = safeJsonParse(chapter.pendingArchiveData, null) as PendingArchiveData | null

    if (!pending) {
      return reply.status(400).send({
        success: false,
        error: '归档失败：没有找到预归档数据，请先调用 prepare-archive'
      })
    }

    // 事务写入
    let graphSaved: { snapshot: GraphSnapshot; delta: GraphSnapshot } | null = null
    try {
      graphSaved = await prisma.$transaction(async (tx) => {
        // 1. 写入记忆、角色状态、时间线
        await commitMemoryWrites(tx, chapterId, chapter.storyId, pending.memories)

        // 2. 更新章节摘要
        if (pending.memories.summary) {
          await tx.chapter.update({
            where: { id: chapterId },
            data: { summary: pending.memories.summary }
          })
        }

        // 3. 写入剧情弧线
        await commitPlotArcWrites(tx, pending.plotArcs)

        // 4. 写入图谱快照
        const saved = await saveGraphSnapshotAndDelta(tx, chapterId, chapter.storyId, pending.graph)
        if (!saved) {
          throw new Error('知识图谱保存失败')
        }

        // 5. 正式归档
        await tx.chapter.update({
          where: { id: chapterId },
          data: { status: 'archived', pendingArchiveData: null }
        })

        return saved
      })

      app.log.info(`[Archive] Transaction committed for chapter ${chapterId}`)
    } catch (err: any) {
      app.log.error(`[Archive] Transaction failed: ${err.message}`)
      return reply.status(500).send({
        success: false,
        error: `归档失败：数据保存出错（${err.message}）。章节状态未变更，请检查 AI 配置后重试。`
      })
    }

    // 阶段 4：记忆优化（失败不阻塞归档）
    let optimizedCount = 0
    try {
      optimizedCount = await optimizeMemories(app, chapter.storyId, chapterId, chapter.number)
      app.log.info(`[Archive] Memory optimized: ${optimizedCount} global memories`)
    } catch (err: any) {
      app.log.error(`[Archive] Memory optimization failed (non-blocking): ${err.message}`)
    }

    return {
      success: true,
      data: { optimizedCount, graph: graphSaved }
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

    // 校验：只能从已归档的章节发展
    if (parentChapter.status !== 'archived') {
      return reply.status(400).send({ success: false, error: '只能从已归档的章节发展' })
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
