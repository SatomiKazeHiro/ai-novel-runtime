import type { FastifyInstance } from 'fastify'
import { RuntimePromptCompiler } from '@novel-runtime/ai-provider'
import { cleanJsonBlock } from '@novel-runtime/shared'
import { loadRuntimeBase, loadWorkerTask } from './runtime-loader.js'
import { callAIWithLog } from './ai-call-logger.js'
import { saveExtractedMemory, type MemoryExtractionResult } from './memory-extractor.js'
import { type GraphExtractionResult } from './graph-extractor.js'
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
  outline?: string,
  fromChapterNumber?: number
): Promise<{ memories: number; graph: { nodes: any[]; edges: any[] }; arcs: number } | null> {
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
- characterStatusChanges: 角色状态变化（对象，如 {"张三": {"rank": "初级", "location": "北京"}}}）
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

    // 保存记忆（标记来源章节号）
    await saveExtractedMemory(app, chapterId, storyId, result.memories, chNum)

    // 图谱提取结果（过滤低重要性 + type 规范化），由 graph-organizer 处理合并
    const TYPE_MAP: Record<string, string> = {
      '角色': 'character', '人物': 'character',
      '势力': 'faction', '组织': 'faction', '门派': 'faction',
      '事件': 'event',
      '物品': 'item', '道具': 'item', '武器': 'item', '装备': 'item',
      '兵器': 'item', '法宝': 'item', '灵器': 'item',
      'weapon': 'item', 'prop': 'item', 'object': 'item', 'tool': 'item',
      'armor': 'item', 'treasure': 'item', 'artifact': 'item', 'gear': 'item',
      'realm': 'faction', 'sect': 'faction', 'clan': 'faction', 'guild': 'faction',
      'place': 'event', 'location': 'event', 'scene': 'event',
    }
    const normalizeType = (t: string) => TYPE_MAP[t] || t

    const filteredNodes = (result.graph?.nodes || []).filter(n => n.importance >= 6).map(n => ({
      ...n,
      type: normalizeType(n.type)
    })) as any[]

    // 建立 key -> 规范化后的 type 映射，用于修正边
    const keyToType = new Map<string, string>()
    for (const n of filteredNodes) keyToType.set(n.key, n.type)

    const normalizedEdges = (result.graph?.edges || []).map(e => ({
      ...e,
      fromType: keyToType.get(e.fromKey) || normalizeType(e.fromType),
      toType: keyToType.get(e.toKey) || normalizeType(e.toType)
    }))

    // 保存剧情弧线
    await savePlotArcs(app, storyId, result.plotArcs?.arcs || [])

    const memCount = (result.memories?.mainEvents?.length || 0) +
                     (result.memories?.sideEvents?.length || 0) +
                     (result.memories?.emotions?.length || 0) +
                     (result.memories?.foreshadowing?.length || 0) +
                     (result.memories?.relationshipChanges?.length || 0) +
                     (result.memories?.scenes?.length || 0) +
                     Object.keys(result.memories?.characterStatusChanges || {}).length

    app.log.info(
      `[CombinedExtractor] Saved: ${memCount} memories, ${filteredNodes.length} nodes, ${normalizedEdges.length} edges, ${result.plotArcs?.arcs?.length || 0} arcs`
    )

    return {
      memories: memCount,
      graph: { nodes: filteredNodes, edges: normalizedEdges },
      arcs: result.plotArcs?.arcs?.length || 0
    }
  } catch (err: any) {
    app.log.error(`[CombinedExtractor] Failed: ${err.message}`)
    return null
  }
}
