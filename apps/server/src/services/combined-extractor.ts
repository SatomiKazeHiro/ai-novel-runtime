import type { FastifyInstance } from 'fastify'
import { RuntimePromptCompiler } from '@novel-runtime/ai-provider'
import { truncateByParagraph } from '@novel-runtime/prompt-runtime'
import { cleanJsonBlock, safeJsonParse, type PendingArchiveData } from '@novel-runtime/shared'
import { loadRuntimeBase, loadWorkerTask } from './runtime-loader.js'
import { callAIWithLog } from './ai-call-logger.js'
import { type MemoryExtractionResult, extractMemoryFromChapter, prepareMemoryWrites, type ArchiveMemoryData } from './memory-extractor.js'
import { type GraphExtractionResult } from './graph-extractor.js'
import { type PlotArcAnalysis, extractPlotArcs, preparePlotArcWrites, type PlotArcWrite } from './plot-extractor.js'
import { organizeGraph } from './graph-organizer.js'
import { type GraphSnapshot } from './graph-snapshot.js'

export interface CombinedExtractionData {
  memories: MemoryExtractionResult | null
  graph: GraphExtractionResult
  plotArcs: PlotArcAnalysis | null
}

// Re-export the shared `PendingArchiveData` so existing imports
// (`from '../services/combined-extractor.js'`) keep working unchanged.
// The shared type is the single source of truth for the shape parked in
// `Chapter.pendingArchiveData`; both server and web must agree on it.
export type { PendingArchiveData }

/**
 * 合并提取：记忆 + 图谱 + 剧情弧线，一次 API 调用完成
 * 纯提取，不写入数据库。写入请在外层事务中统一执行。
 */
export async function extractAll(
  app: FastifyInstance,
  chapterId: string,
  storyId: string,
  content: string,
  outline?: string,
  fromChapterNumber?: number
): Promise<CombinedExtractionData | null> {
  const prisma = app.prisma
  const chNum = fromChapterNumber ?? 0

  // 查询本故事的主角名单
  const protagonists = await prisma.character.findMany({
    where: { storyId, protagonist: true },
    select: { name: true }
  })
  const protagonistNames = protagonists.map(p => p.name)

  // 加载已有弧线：只保留活跃/待收尾/待启动的 + 近期（30天内）更新过的
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
  const existingArcs = await prisma.plotArc.findMany({
    where: {
      storyId,
      OR: [
        { status: { in: ['active', 'resolving', 'pending'] } },
        { updatedAt: { gte: thirtyDaysAgo } }
      ]
    }
  })
  const existingArcsText = existingArcs.length > 0
    ? existingArcs.map(a => `- ${a.name} (${a.type}, ${a.status}, 进度${a.progress}%)`).join('\n')
    : '暂无已追踪的剧情弧线'

  // 加载已有节点（用于去重提示）：角色节点全部保留 + 其他类型只保留最近100个
  const [characterNodes, recentOtherNodes] = await Promise.all([
    prisma.graphNode.findMany({ where: { storyId, type: 'character' } }),
    prisma.graphNode.findMany({
      where: { storyId, type: { not: 'character' } },
      orderBy: { createdAt: 'desc' },
      take: 100
    })
  ])
  const combinedNodes = [...characterNodes, ...recentOtherNodes]
  const existingKeys = new Set(combinedNodes.map(n => `${n.type}:${n.key}`))

  app.log.info(
    `[CombinedExtractor] Context injection: ${existingArcs.length} arcs, ${characterNodes.length} characters, ${recentOtherNodes.length} recent nodes`
  )

  const extractPrompt = `请分析以下小说章节，同时完成【记忆提取】、【实体关系提取】和【剧情弧线分析】三个任务。返回严格 JSON 格式，不要 markdown 代码块，不要解释文字。

=== 任务1：记忆提取 ===
提取对剧情有实质推动作用的信息。
本故事主角：${protagonistNames.join('、') || '无明确主角'}

每条事件必须包含：
- description: 简洁描述"有什么人做了什么"
- participants: 参与该事件的所有角色名单
- importance: 事件在本章的重要性（4~7）。如果事件有主角参与，请自行+1，最终为5~8。

importance 评分标准：
- 7: 本章核心转折/高潮，占大量篇幅
- 6: 重要推进，占中等篇幅
- 5: 有一定作用，占少量篇幅
- 4: 过渡/铺垫，篇幅很短

主角参与且达到 8 分的事件视为"主要事件"，放入 mainEvents；其他放入 sideEvents。

**重要：mainEvents 和 sideEvents 数组的顺序必须和事件在文章中的出现顺序完全一致，不能打乱，更不能把结尾的事件放到数组开头。**

事件格式示例：
{
  "description": "许青向姜禾解释现代社会的身份制度和法律危险",
  "participants": ["许青", "姜禾"],
  "importance": 6
}

提取字段：
- mainEvents: 主要事件（对象数组，每个对象包含 description / participants / importance）
- sideEvents: 次要事件（对象数组，格式同上）
- emotions: 主要角色情绪变化（字符串数组）
- foreshadowing: 新埋下的伏笔（字符串数组）
- relationshipChanges: 角色关系变化（字符串数组）
- characterStatusChanges: 角色状态变化（对象，如 {"张三": {"rank": "初级", "location": "北京", "relationships": {"李四": "兄弟", "王五": "敌对"}}}）。其中 relationships 子键可选，用于表达该角色与其他角色的关系变化。
- timelineDay: 本章发生在第几天（数字，不确定则 null）
- summary: 本章一句话摘要（50字以内）
- scenes: 推动剧情的关键地点（对象数组，如 [{ "location": "名称", "description": "场景描写（可选）", "event": "在此发生的事件概括", "importance": 1-10 }]）
  场景 importance 标准：7-10 核心剧情地点，4-6 有一定事件，1-3 路人提及/无实质事件

=== 任务2：实体与关系提取 ===
提取 importance >= 6 的核心实体和它们之间的关系：
- nodes: [{ type: "character"|"faction"|"event"|"item", key: "唯一标识（英文小写）", label: "显示名称", importance: 1-10, data: {...} }]
- edges: [{ fromKey, fromType, toKey, toType, relation }]
  relation 应该是一个简洁的核心词或短语（2-6字为佳），直接表达两实体间的核心联系，不要带状语、从句或补充说明
已有实体（不要重复提取，但可补充新属性）：${Array.from(existingKeys).join(', ') || '无'}

=== 任务3：剧情弧线分析 ===
分析已有弧线的推进，标注未解悬念：
现有弧线：
${existingArcsText}

返回弧线列表：
- arcs: [{ name, type: "main"|"side", status: "pending"|"active"|"resolving"|"completed", progress: 0-100, currentStage, nextGoal, unresolved: [], summary }]

=== 返回格式 ===
{
  "memories": { mainEvents, sideEvents, emotions, foreshadowing, relationshipChanges, characterStatusChanges, timelineDay, summary, scenes },
  "graph": { "nodes": [...], "edges": [...] },
  "plotArcs": { "arcs": [...] }
}

章节大纲：${outline || '无大纲'}
章节内容如下：
${truncateByParagraph(content, 8000)}`

  app.log.info(`[CombinedExtractor] Calling AI for chapter ${chapterId}`)

  let raw: string | null
  try {
    const base = await loadRuntimeBase(storyId, prisma)
    const task = await loadWorkerTask(storyId, 'memory', prisma)

    const compiler = new RuntimePromptCompiler()
    const compiled = compiler.compile(base, task, extractPrompt)

    // 不传 maxTokens → 由 provider `options?.maxTokens ?? aiConfig.maxTokens`
    // 链回退到用户在 ModelManager 配置的值。合并提取把记忆+图谱+弧线压
    // 在一次调用里，4096 的硬编码预算经常不够，会被 maxTokens 截断导致
    // markdown fence 不闭合、JSON.parse 失败（旧实现还会吞掉这个错误）。
    raw = await callAIWithLog(app, {
      storyId, chapterId, callType: 'combined_extract',
      compiled, temperature: 0.3
    })
  } catch (err: any) {
    app.log.error(`[CombinedExtractor] AI call failed: ${err.message}`)
    return null
  }
  if (!raw) return null

  // JSON 解析失败（含 cleanJsonBlock 检测到的不完整 fence）直接抛给上游。
  // 路由 chapters.ts:603 的 catch 会把 err.message 透传到前端，让用户看
  // 到真实错误（"响应被截断，请增大 maxTokens…"）而不是误导的
  // "AI 提取返回为空"。
  const result = JSON.parse(cleanJsonBlock(raw))

  const memories: MemoryExtractionResult = result.memories
  const graph: GraphExtractionResult = result.graph || { nodes: [], edges: [] }
  const plotArcs: PlotArcAnalysis = result.plotArcs

  // 统计
  const memCount = (memories?.mainEvents?.length || 0) +
                   (memories?.sideEvents?.length || 0) +
                   (memories?.emotions?.length || 0) +
                   (memories?.foreshadowing?.length || 0) +
                   (memories?.relationshipChanges?.length || 0) +
                   (memories?.scenes?.length || 0) +
                   Object.keys(memories?.characterStatusChanges || {}).length

  app.log.info(
    `[CombinedExtractor] Extracted: ${memCount} memories, ${graph.nodes?.length || 0} nodes, ${graph.edges?.length || 0} edges, ${plotArcs?.arcs?.length || 0} arcs`
  )

  return { memories, graph, plotArcs }
}

/**
 * 准备归档数据：提取 + 整理，但不写入数据库
 * 返回的数据可直接序列化存储在 Chapter.pendingArchiveData 中
 */
export async function prepareArchiveData(
  app: FastifyInstance,
  chapterId: string,
  storyId: string,
  content: string,
  outline: string | null,
  fromChapterNumber: number,
  parentChapterId: string | null
): Promise<PendingArchiveData | null> {
  const prisma = app.prisma

  // 1. 纯提取
  const extraction = await extractAll(app, chapterId, storyId, content, outline || undefined, fromChapterNumber)
  if (!extraction || !extraction.memories) {
    return null
  }

  // 2. 查找上一章全局图谱 snapshot
  let previousSnapshot: GraphSnapshot | null = null
  if (parentChapterId) {
    const parent = await prisma.chapter.findUnique({
      where: { id: parentChapterId },
      select: { graphSnapshot: true }
    })
    if (parent?.graphSnapshot) {
      previousSnapshot = safeJsonParse(parent.graphSnapshot, null)
    }
  }
  if (!previousSnapshot) {
    const lastArchived = await prisma.chapter.findFirst({
      where: { storyId, status: 'archived', id: { not: chapterId } },
      orderBy: { number: 'desc' },
      select: { graphSnapshot: true }
    })
    if (lastArchived?.graphSnapshot) {
      previousSnapshot = safeJsonParse(lastArchived.graphSnapshot, null)
    }
  }

  // 3. 整理图谱
  const graphRaw = extraction.graph || { nodes: [], edges: [] }
  const graphOrganized = await organizeGraph(app, storyId, chapterId, previousSnapshot, graphRaw)

  // 4. 准备记忆写入数据
  const memoryData = prepareMemoryWrites(storyId, chapterId, extraction.memories, fromChapterNumber)

  // 5. 准备剧情弧线写入数据
  const plotArcWrites = extraction.plotArcs
    ? await preparePlotArcWrites(prisma, storyId, extraction.plotArcs.arcs)
    : []

  return {
    memories: memoryData,
    graph: {
      mergedGraph: graphOrganized.mergedGraph,
      chapterGraph: graphOrganized.chapterGraph
    },
    plotArcs: plotArcWrites,
    meta: {
      extractedAt: new Date().toISOString(),
      chapterNumber: fromChapterNumber
    }
  }
}

// 兼容旧接口
export { extractMemoryFromChapter }
