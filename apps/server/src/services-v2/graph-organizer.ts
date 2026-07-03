import { resolveProvider } from '../services/ai-provider-init.js'
import type { GraphData, GraphNodeData, GraphEdgeData } from './graph-types.js'

/**
 * 合并本章图谱与上一章总图谱，返回新的总图谱。
 *
 * 第一步：代码取 1-hop 邻域
 *   找出 chapterGraph 中与 mergedGraph 按 (type, key) 匹配的节点，
 *   从 mergedGraph 中收集这些节点 + 直接相连的边和邻居节点。
 *
 * 第二步：AI 合并且重
 *   将 chapterGraph + 邻域传给 AI，由 AI 负责去重、合并 data、清理边。
 *
 * 特殊情况：
 *   - 第一章（无 previousMergedGraph）：直接返回 chapterGraph，不走 AI
 *   - 无节点匹配（章节图谱全是新实体）：代码直接合并（并集），不走 AI
 */
export async function mergeGraph(
  prisma: any,
  storyId: string,
  chapterGraph: GraphData,
  previousMergedGraph: GraphData | null
): Promise<GraphData> {
  // 无上一章总图谱或上一章总图谱为空：本章图谱即为新总图谱
  if (!previousMergedGraph || previousMergedGraph.nodes.length === 0) {
    return chapterGraph
  }

  // 找出匹配的节点 key 集合
  const prevKeySet = new Set(previousMergedGraph.nodes.map(n => makeKeyId(n)))
  const matchedKeyIds = new Set<string>()
  for (const node of chapterGraph.nodes) {
    const kid = makeKeyId(node)
    if (prevKeySet.has(kid)) matchedKeyIds.add(kid)
  }

  // 无重叠 → 直接并集（不调 AI）
  if (matchedKeyIds.size === 0) {
    return codeMerge(chapterGraph, previousMergedGraph)
  }

  // 收集 1-hop 邻域
  const neighborhood = collectNeighborhood(previousMergedGraph, matchedKeyIds)
  if (neighborhood.nodes.length === 0) {
    return codeMerge(chapterGraph, previousMergedGraph)
  }

  // AI 合并
  const resolved = await resolveProvider(prisma, storyId)
  if (!resolved?.provider?.generate) {
    return codeMerge(chapterGraph, previousMergedGraph)
  }

  const systemMessage = `你是一位专精知识图谱合并的专家。
你需要将"本章图谱"与"现有总图谱的邻域"合并为一张无冗余、无矛盾的"新的总图谱"。
返回严格的 JSON 格式，不要包含任何解释、markdown 标记或额外文字。`

  const userMessage = `请将以下两个图谱合并，生成"新的总图谱"。

【本章图谱】（本章中提取/编辑的实体和关系）
节点：${JSON.stringify(chapterGraph.nodes)}
边：${JSON.stringify(chapterGraph.edges)}

【总图谱邻域】（现有总图谱中与本章相关的 1-hop 邻域）
节点：${JSON.stringify(neighborhood.nodes)}
边：${JSON.stringify(neighborhood.edges)}

【合并规则】
1. 按 (type, key) 匹配去重：相同 key 的节点视为同一实体，合并其 data（本章优先，邻域补充）
2. 语义去重：若发现两个名称不同的节点可能指同一实体，合并为一个（保留更通用的名称）
3. 边去重：(fromKey, toKey, 同义relation) 的边只保留一条
4. 过时边移除：若邻域中某条关系在本章中已发生变化，用新边替换旧边
5. 保留邻域中未被本章修改的节点和边（它们是总图谱的历史积累）
6. 不要凭空编造新的节点或边

返回 JSON 格式（与输入格式相同）：
{
  "nodes": [...],
  "edges": [...]
}`

  let raw: string
  try {
    raw = await resolved.provider.generate(userMessage, {
      system: systemMessage,
      temperature: 0.2
    })
  } catch (err: any) {
    throw new Error(`AI 合并图谱失败: ${err?.message || '未知错误'}`)
  }

  const parsed = parseAIJson(raw)
  if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.nodes)) {
    throw new Error('AI 合并图谱返回数据格式错误：期望对象含 nodes/edges 数组')
  }

  return {
    nodes: Array.isArray(parsed.nodes) ? parsed.nodes : [],
    edges: Array.isArray(parsed.edges) ? parsed.edges : []
  }
}

/** 代码直接合并（用于首章 / 无重叠 / AI 失败的兜底） */
function codeMerge(chapter: GraphData, prev: GraphData): GraphData {
  const nodeMap = new Map<string, GraphNodeData>()
  for (const n of prev.nodes) nodeMap.set(makeKeyId(n), { ...n })
  // 本章同名节点覆盖
  for (const n of chapter.nodes) nodeMap.set(makeKeyId(n), { ...n })

  const edgeSet = new Set<string>()
  const edges: GraphEdgeData[] = []
  for (const e of [...prev.edges, ...chapter.edges]) {
    const sig = `${e.fromKey}|${e.relation}|${e.toKey}`
    if (!edgeSet.has(sig)) {
      edgeSet.add(sig)
      edges.push(e)
    }
  }

  return { nodes: Array.from(nodeMap.values()), edges }
}

/** 收集 matchedKeyIds 的 1-hop 邻域 */
function collectNeighborhood(graph: GraphData, matchedKeyIds: Set<string>): GraphData {
  const includedNodeKeys = new Set(matchedKeyIds)

  // 遍历边，收集"以匹配节点为一端"的边，并将另一端也加入
  const edges: GraphEdgeData[] = []
  for (const e of graph.edges) {
    const fromMatch = matchedKeyIds.has(e.fromKey)
    const toMatch = matchedKeyIds.has(e.toKey)
    if (fromMatch || toMatch) {
      edges.push(e)
      includedNodeKeys.add(e.fromKey)
      includedNodeKeys.add(e.toKey)
    }
  }

  const nodes = graph.nodes.filter(n => includedNodeKeys.has(makeKeyId(n)))
  return { nodes, edges }
}

function makeKeyId(n: { type: string; key: string }): string {
  return `${n.type}:${n.key}`
}

function parseAIJson(raw: string): any {
  let text = raw.trim()
  if (text.startsWith('```')) {
    text = text.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '')
  }
  try { return JSON.parse(text) } catch {
    const objMatch = text.match(/\{[\s\S]*\}/)
    if (objMatch) {
      try { return JSON.parse(objMatch[0]) } catch { /* fall through */ }
    }
    return null
  }
}
