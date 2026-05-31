import type { FastifyInstance } from 'fastify'
import { RuntimePromptCompiler } from '@novel-runtime/ai-provider'
import { cleanJsonBlock } from '@novel-runtime/shared'
import { loadRuntimeBase, loadWorkerTask } from './runtime-loader.js'
import { callAIWithLog } from './ai-call-logger.js'
import { saveExtractedMemory, type MemoryExtractionResult } from './memory-extractor.js'
import { saveExtractedGraph, type GraphExtractionResult } from './graph-extractor.js'
import { savePlotArcs, type PlotArcAnalysis } from './plot-extractor.js'

interface CombinedExtractionResult {
  memories: MemoryExtractionResult
  graph: GraphExtractionResult
  plotArcs: PlotArcAnalysis
}

/**
 * 合并提取：记忆 + 图谱 + 剧情弧线，一次 API 调用完成
 */
export async function extractAndSaveAll(
  app: FastifyInstance,
  chapterId: string,
  storyId: string,
  content: string,
  outline?: string
): Promise<{ memories: number; nodes: number; edges: number; arcs: number } | null> {
  const prisma = app.prisma

  // 获取章节版本分支 ID
  const chapter = await prisma.chapter.findUnique({ where: { id: chapterId }, select: { versionBranchId: true } })
  const vbId = chapter?.versionBranchId ?? ''

  // 加载已有弧线：只保留活跃/待收尾/待启动的 + 近期（30天内）更新过的（同分支）
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
  const existingArcs = await prisma.plotArc.findMany({
    where: {
      storyId,
      versionBranchId: vbId,
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
    prisma.graphNode.findMany({ where: { storyId, versionBranchId: vbId, type: 'character' } }),
    prisma.graphNode.findMany({
      where: { storyId, versionBranchId: vbId, type: { not: 'character' } },
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
提取对剧情有实质推动作用的信息：
- mainEvents: 主线事件（字符串数组，合并同一剧情链的连续事件，不要拆分）
- sideEvents: 支线/旁支事件（字符串数组）
- emotions: 主要角色情绪变化（字符串数组）
- foreshadowing: 新埋下的伏笔（字符串数组）
- relationshipChanges: 角色关系变化（字符串数组）
- characterStatusChanges: 角色状态变化（对象，如 {"张三": {"rank": "初级", "location": "北京"}}）
- timelineDay: 本章发生在第几天（数字，不确定则 null）
- summary: 本章一句话摘要（50字以内）
- scenes: 推动剧情的关键地点（对象数组，如 [{ "location": "名称", "description": "场景描写（可选）", "event": "在此发生的事件概括", "importance": 1-10 }]）
  importance 标准：7-10 核心剧情地点，4-6 有一定事件，1-3 路人提及/无实质事件

=== 任务2：实体与关系提取 ===
提取 importance >= 6 的核心实体和它们之间的关系：
- nodes: [{ type: "character"|"faction"|"event"|"item", key: "唯一标识（英文小写）", label: "显示名称", importance: 1-10, data: {...} }]
- edges: [{ fromKey, fromType, toKey, toType, relation }]
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
${content.slice(0, 8000)}`

  app.log.info(`[CombinedExtractor] Calling AI for chapter ${chapterId}`)

  try {
    const base = await loadRuntimeBase(storyId, prisma)
    const task = await loadWorkerTask(storyId, 'memory', prisma)

    const compiler = new RuntimePromptCompiler()
    const compiled = compiler.compile(base, task, extractPrompt)

    const raw = await callAIWithLog(app, {
      storyId, chapterId, callType: 'combined_extract',
      compiled, temperature: 0.3, maxTokens: 4096
    })
    if (!raw) return null

    const result: CombinedExtractionResult = JSON.parse(cleanJsonBlock(raw))

    // 保存记忆（按版本隔离）
    await saveExtractedMemory(app, chapterId, storyId, result.memories, vbId)

    // 保存图谱（过滤低重要性，按版本隔离）
    const filteredNodes = (result.graph?.nodes || []).filter(n => n.importance >= 6)
    await saveExtractedGraph(app, storyId, { nodes: filteredNodes, edges: result.graph?.edges || [] }, vbId)

    // 保存剧情弧线（按版本隔离）
    await savePlotArcs(app, storyId, result.plotArcs?.arcs || [], vbId)

    const memCount = (result.memories?.mainEvents?.length || 0) +
                     (result.memories?.sideEvents?.length || 0) +
                     (result.memories?.emotions?.length || 0) +
                     (result.memories?.foreshadowing?.length || 0) +
                     (result.memories?.relationshipChanges?.length || 0) +
                     (result.memories?.scenes?.length || 0) +
                     Object.keys(result.memories?.characterStatusChanges || {}).length

    app.log.info(
      `[CombinedExtractor] Saved: ${memCount} memories, ${filteredNodes.length} nodes, ${result.graph?.edges?.length || 0} edges, ${result.plotArcs?.arcs?.length || 0} arcs`
    )

    return {
      memories: memCount,
      nodes: filteredNodes.length,
      edges: result.graph?.edges?.length || 0,
      arcs: result.plotArcs?.arcs?.length || 0
    }
  } catch (err: any) {
    app.log.error(`[CombinedExtractor] Failed: ${err.message}`)
    return null
  }
}
