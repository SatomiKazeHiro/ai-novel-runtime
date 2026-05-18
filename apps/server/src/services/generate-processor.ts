import { PromptPipeline } from '@novel-runtime/prompt-runtime'
import { MemoryManager } from '@novel-runtime/memory-engine'
import { RuntimePromptCompiler } from '@novel-runtime/ai-provider'
import { formatCharacterSnapshot, generateFallbackContent, DEFAULT_PIPELINE_BUDGET } from '@novel-runtime/shared'
import { loadRuntimeBase, loadWorkerTask } from './runtime-loader.js'
import { callAIWithLog } from './ai-call-logger.js'
import { getActivePlotArcs } from './plot-extractor.js'
import type { FastifyInstance } from 'fastify'

const memoryManager = new MemoryManager()

export function createGenerateProcessor(app: FastifyInstance) {
  return async (job: any) => {
    const { chapterId, storyId, candidateCount = 3 } = job.data
    app.log.info(`[Generate] Starting generation for chapter ${chapterId}, candidates: ${candidateCount}`)

    const prisma = app.prisma

    // 1. 获取章节信息
    const chapter = await prisma.chapter.findUnique({
      where: { id: chapterId },
      include: { story: true }
    })
    if (!chapter) throw new Error(`Chapter ${chapterId} not found`)

    // 2. 获取 Story 上下文
    const story = chapter.story

    // 3. 获取角色、世界观、记忆、时间线、剧情弧线
    const characters = await prisma.character.findMany({ where: { storyId } })
    const loreItems = await prisma.loreItem.findMany({ where: { storyId } })
    const timelineEvents = await prisma.timelineEvent.findMany({ where: { storyId }, orderBy: { day: 'asc' } })
    const plotArcText = await getActivePlotArcs(prisma, storyId)

    // 3a. 获取 checkpoint（最后一个归档章节号，生成只基于 checkpoint 之前的状态）
    const checkpointChapter = await prisma.chapter.findFirst({
      where: { storyId, status: 'archived' },
      orderBy: { number: 'desc' }
    })
    const checkpointNumber = checkpointChapter?.number || 0

    // 3b. 语义检索相关记忆（基于章节大纲+场景，只读 checkpoint 之前）
    const queryText = `${chapter.outline || ''} ${chapter.sceneLocation || ''} ${chapter.sceneMood || ''} ${chapter.sceneGoal || ''}`
    const relevantMemories = await memoryManager.searchRelevant(storyId, queryText, prisma, 20, checkpointNumber)

    // 4. 加载 Runtime Base + Generation Worker Task
    const base = await loadRuntimeBase(storyId, prisma)
    const task = await loadWorkerTask(storyId, 'generation', prisma)

    // 5. 组装 User Message（Context Layers）
    const pipeline = new PromptPipeline(DEFAULT_PIPELINE_BUDGET)

    const pipelineResult = pipeline.run({
      style: '',
      story: `作品：《${story.title}》\n${story.description || ''}`,
      lore: loreItems.map(l => `【${l.name}】${l.content}`).join('\n') || '无世界观设定信息',
      character: formatCharacterSnapshot(characters),
      scene: `地点：${chapter.sceneLocation || '未设定'}\n氛围：${chapter.sceneMood || '未设定'}\n目标：${chapter.sceneGoal || '未设定'}`,
      memory: memoryManager.formatForPrompt(relevantMemories),
      timeline: timelineEvents.map(t => `第${t.day}天：${JSON.parse(t.events).join('；')}`).join('\n'),
      plotArc: plotArcText || undefined,
      output: `请根据以下大纲生成玄幻修仙章节内容：\n\n${chapter.outline || '无大纲'}`
    })
    const userMessage = pipelineResult.text

    // 7. 编译最终 Prompt（System Message = Runtime Base + Task，User Message = Context）
    const compiler = new RuntimePromptCompiler()
    const compiled = compiler.compile(base, task, userMessage)

    app.log.info(`[Generate] Assembled prompt: system=${compiled.meta.systemTokens}tokens, user=${compiled.meta.userTokens}tokens, total=${compiled.meta.totalTokens}tokens`)

    // 6. 生成多个候选
    const drafts: string[] = []
    for (let i = 0; i < candidateCount; i++) {
      let content: string
      try {
        const result = await callAIWithLog(app, {
          storyId,
          chapterId,
          callType: 'generate',
          compiled,
          temperature: 0.6 + i * 0.15
        })
        content = result ?? generateFallbackContent(chapter, i, '未配置 API Key')
      } catch (err: any) {
        app.log.error(`[Generate] AI provider error: ${err.message}`)
        content = generateFallbackContent(chapter, i, err.message)
      }
      drafts.push(content)
    }

    // 10. 保存 Draft
    const createdDrafts = []
    for (let i = 0; i < drafts.length; i++) {
      const draft = await prisma.draft.create({
        data: {
          storyId,
          chapterId,
          version: `candidate_${String.fromCharCode(97 + i)}`, // a, b, c
          content: drafts[i],
          params: JSON.stringify({ temperature: 0.6 + i * 0.15, model: 'fallback' }),
          status: 'candidate'
        }
      })
      createdDrafts.push(draft)
      app.log.info(`[Generate] Draft created: ${draft.id}`)
    }

    // 11. 更新章节状态
    await prisma.chapter.update({
      where: { id: chapterId },
      data: { status: 'generated' }
    })

    return {
      draftIds: createdDrafts.map(d => d.id),
      count: createdDrafts.length,
      tokens: compiled.meta,
      layers: pipelineResult.stats
    }
  }
}
