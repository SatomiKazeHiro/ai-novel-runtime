import { PromptPipeline } from '@novel-runtime/prompt-runtime'
import { MemoryManager } from '@novel-runtime/memory-engine'
import { GraphService } from '@novel-runtime/knowledge-graph'
import { createProvider, RuntimePromptCompiler } from '@novel-runtime/ai-provider'
import { loadRuntimeBase, loadWorkerTask } from './runtime-loader.js'
import { extractMemoryFromChapter, saveExtractedMemory } from './memory-extractor.js'
import { extractGraphFromChapter, saveExtractedGraph } from './graph-extractor.js'
import { extractPlotArcs, getActivePlotArcs } from './plot-extractor.js'
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

    // 3b. 语义检索相关记忆（基于章节大纲+场景）
    const queryText = `${chapter.outline || ''} ${chapter.sceneLocation || ''} ${chapter.sceneMood || ''} ${chapter.sceneGoal || ''}`
    const relevantMemories = await memoryManager.searchRelevant(storyId, queryText, prisma, 20)

    // 4. 获取图谱
    const graphNodes = await prisma.graphNode.findMany({ where: { storyId } })
    const graphEdges = await prisma.graphEdge.findMany({ where: { storyId } })
    const graph = new GraphService()
    graph.import({
      nodes: graphNodes.map(n => ({ id: n.id, type: n.type, key: n.key, label: n.label, ...JSON.parse(n.data || '{}') })),
      edges: graphEdges.map(e => ({ source: e.fromId, target: e.toId, relation: e.relation, weight: e.weight }))
    })

    // 5. 加载 Runtime Base + Generation Worker Task
    const base = await loadRuntimeBase(storyId, prisma)
    const task = await loadWorkerTask(storyId, 'generation', prisma)

    // 6. 组装 User Message（Context Layers）
    const pipeline = new PromptPipeline({
      total: 64000,
      identity: 0,       // identity 在 system message 中，user message 中不占预算
      behavior: 0,       // behavior 在 system message 中
      jailbreak: 0,      // jailbreak 在 system message 中
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
      style: '',
      story: `作品：《${story.title}》\n${story.description || ''}`,
      lore: loreItems.map(l => `【${l.name}】${l.content}`).join('\n') || '无天道设定信息',
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

    // 8. 获取默认 AI Provider
    const aiConfig = await prisma.aiProviderConfig.findFirst({
      where: { isDefault: true }
    })

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

    // 9. 生成多个候选
    const drafts: string[] = []
    for (let i = 0; i < candidateCount; i++) {
      let content: string
      if (provider?.generateWithRuntime) {
        try {
          content = await provider.generateWithRuntime(compiled, { temperature: 0.6 + i * 0.15 })
        } catch (err: any) {
          app.log.error(`[Generate] AI provider error: ${err.message}`)
          content = generateMockContent(chapter, i)
        }
      } else {
        content = generateMockContent(chapter, i)
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
          params: JSON.stringify({ temperature: 0.6 + i * 0.15, model: aiConfig?.model || 'mock' }),
          status: 'candidate'
        }
      })
      createdDrafts.push(draft)
      app.log.info(`[Generate] Draft created: ${draft.id}`)
    }

    // 11. 提取记忆 + 图谱
    for (const draft of createdDrafts) {
      try {
        const memoryResult = await extractMemoryFromChapter(app, chapterId, storyId, draft.content)
        if (memoryResult) {
          await saveExtractedMemory(app, chapterId, storyId, memoryResult)
        }
      } catch (e: any) {
        app.log.error(`[Generate] Memory extraction failed: ${e.message}`)
      }

      try {
        const graphResult = await extractGraphFromChapter(app, chapterId, storyId, draft.content)
        if (graphResult) {
          await saveExtractedGraph(app, storyId, graphResult)
        }
      } catch (e: any) {
        app.log.error(`[Generate] Graph extraction failed: ${e.message}`)
      }

      try {
        await extractPlotArcs(app, storyId, chapterId, draft.content, chapter.outline || undefined)
      } catch (e: any) {
        app.log.error(`[Generate] Plot arc extraction failed: ${e.message}`)
      }
    }

    // 12. 更新章节状态
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

function generateMockContent(chapter: any, index: number): string {
  const temps = ['克制冷静', '情绪充沛', '戏剧化']
  return `【候选 ${String.fromCharCode(97 + index)} — ${temps[index] || '默认'}风格】\n\n${chapter.title}\n\n${chapter.outline || '暂无大纲'}\n\n（此处为模拟生成内容，实际接入 DeepSeek API 后将返回真实章节文本。当前使用的是 ${temps[index] || '默认'} 风格的模拟输出。）\n\n林凡站在后山崖边，山风猎猎。他闭目凝神，体内灵力如潮水般涌动——那是${index === 0 ? '他一贯冷静克制的方式' : index === 1 ? '情绪翻涌、难以自抑的状态' : '命运转折、戏剧化的时刻'}。\n\n远处，青云宗的钟声悠悠传来……`
}
