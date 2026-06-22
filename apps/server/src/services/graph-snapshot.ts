import type { FastifyInstance } from 'fastify'

export interface GraphNodeSnapshot {
  type: string
  key: string
  label: string
  data: Record<string, any>
}

export interface GraphEdgeSnapshot {
  fromType: string
  fromKey: string
  toType: string
  toKey: string
  relation: string
  weight: number
}

export interface GraphSnapshot {
  nodes: GraphNodeSnapshot[]
  edges: GraphEdgeSnapshot[]
  timestamp: string
}

/**
 * 保存 graphSnapshot 和 graphDelta
 * graphSnapshot = B+ (AI 合并后的全局大图)
 * graphDelta = A (AI 整理后的本章范围图谱)
 */
export async function saveGraphSnapshotAndDelta(
  prisma: any,
  chapterId: string,
  storyId: string,
  graphResult: { mergedGraph: GraphSnapshot; chapterGraph: GraphSnapshot }
): Promise<{ snapshot: GraphSnapshot; delta: GraphSnapshot } | null> {
  try {
    // 1. 清空当前工作表
    await prisma.graphEdge.deleteMany({ where: { storyId } })
    await prisma.graphNode.deleteMany({ where: { storyId } })

    // 2. 从 mergedGraph 重建工作表
    const nodeIdMap = new Map<string, string>() // type:key -> id
    for (const node of graphResult.mergedGraph.nodes) {
      const created = await prisma.graphNode.create({
        data: {
          storyId,
          type: node.type,
          key: node.key,
          label: node.label,
          data: JSON.stringify(node.data || {})
        }
      })
      nodeIdMap.set(`${node.type}:${node.key}`, created.id)
    }

    // 创建关系边，同时做去重兜底（防止 AI 返回的 mergedGraph 中有完全重复的边）
    const seenEdges = new Set<string>()
    for (const edge of graphResult.mergedGraph.edges) {
      const fromId = nodeIdMap.get(`${edge.fromType}:${edge.fromKey}`)
      const toId = nodeIdMap.get(`${edge.toType}:${edge.toKey}`)
      if (!fromId || !toId) continue

      const edgeKey = `${fromId}:${toId}:${edge.relation}`
      if (seenEdges.has(edgeKey)) continue
      seenEdges.add(edgeKey)

      await prisma.graphEdge.create({
        data: {
          storyId,
          fromId,
          toId,
          relation: edge.relation,
          weight: edge.weight || 1
        }
      })
    }

    // 3. 保存到章节
    await prisma.chapter.update({
      where: { id: chapterId },
      data: {
        graphSnapshot: JSON.stringify(graphResult.mergedGraph),
        graphDelta: JSON.stringify(graphResult.chapterGraph)
      }
    })

    return { snapshot: graphResult.mergedGraph, delta: graphResult.chapterGraph }
  } catch (err: any) {
    console.error(`[GraphSnapshot] Failed: ${err.message}`)
    return null
  }
}

/**
 * 从 snapshot 重建 GraphNode/GraphEdge（删除章节后回退用）
 */
export async function rebuildGraphFromSnapshot(
  prisma: any,
  storyId: string,
  snapshot: GraphSnapshot
) {
  // 1. 清空
  await prisma.graphEdge.deleteMany({ where: { storyId } })
  await prisma.graphNode.deleteMany({ where: { storyId } })

  // 2. 重建
  const nodeIdMap = new Map<string, string>()
  for (const node of snapshot.nodes) {
    const created = await prisma.graphNode.create({
      data: {
        storyId,
        type: node.type,
        key: node.key,
        label: node.label,
        data: JSON.stringify(node.data || {})
      }
    })
    nodeIdMap.set(`${node.type}:${node.key}`, created.id)
  }

  for (const edge of snapshot.edges) {
    const fromId = nodeIdMap.get(`${edge.fromType}:${edge.fromKey}`)
    const toId = nodeIdMap.get(`${edge.toType}:${edge.toKey}`)
    if (fromId && toId) {
      await prisma.graphEdge.create({
        data: {
          storyId,
          fromId,
          toId,
          relation: edge.relation,
          weight: edge.weight || 1
        }
      })
    }
  }
}

export interface ExpandOptions {
  maxDepth: number
  maxTokens: number
  maxEntities?: number
  tokenEstimator?: (node: GraphNodeSnapshot) => number
}

export interface NeighborhoodResult {
  nodes: GraphNodeSnapshot[]
  edges: GraphEdgeSnapshot[]
  truncated: boolean
  truncateReason?: 'token_budget' | 'max_entities'
  estimatedTokens: number
}

const defaultTokenEstimator = (n: GraphNodeSnapshot): number => {
  // Heuristic: ~4 chars per token (English-leaning). Matches the project's
  // shared/estimateTokens convention; suitable for prompt-side planning only.
  //
  // Estimation vs Validation 边界 (P0 #8 收口, 2026-06-22):
  //   - 此函数被 expandNeighborhood BFS 循环里 per-node 调用 (单章 200+ 次)。
  //     同步调 `countTokens` (js-tiktoken) 会让 BFS 慢一个数量级, 故保留 heuristic。
  //   - 真值校验由 graph-organizer.ts 的 `firstCompiled.meta.totalTokens` (line ~47)
  //     在邻域选择后做一次精确编译, 与 heuristic 预算对比并打 warn。
  //   - 也就是说: heuristic 失真只影响"选哪些节点",不影响"AI 看到的最终邻域大小"。
  //   见 docs/ISSUES.md P0 #8 "estimation vs validation" 说明。
  return Math.ceil((n.label.length + JSON.stringify(n.data || {}).length) / 4)
}

export function expandNeighborhood(
  snapshot: GraphSnapshot,
  matchedKeys: string[],
  options: ExpandOptions
): NeighborhoodResult {
  const { maxDepth, maxTokens, maxEntities, tokenEstimator = defaultTokenEstimator } = options

  if (!Number.isFinite(options.maxTokens) || options.maxTokens < 0) {
    throw new RangeError(
      `expandNeighborhood: maxTokens must be a non-negative finite number, got ${options.maxTokens}`
    )
  }

  const allNodesByKey = new Map<string, GraphNodeSnapshot>()
  for (const n of snapshot.nodes) {
    allNodesByKey.set(`${n.type}:${n.key}`, n)
  }

  // Pre-build adjacency: nodeKey -> list of otherNodeKey
  const adj = new Map<string, string[]>()
  for (const e of snapshot.edges) {
    const from = `${e.fromType}:${e.fromKey}`
    const to = `${e.toType}:${e.toKey}`
    if (!adj.has(from)) adj.set(from, [])
    if (!adj.has(to)) adj.set(to, [])
    adj.get(from)!.push(to)
    adj.get(to)!.push(from)
  }

  // BFS, tracking depth per node
  const visited = new Map<string, number>() // key -> depth
  const queue: Array<{ key: string; depth: number }> = []
  for (const k of matchedKeys) {
    if (allNodesByKey.has(k) && !visited.has(k)) {
      visited.set(k, 0)
      queue.push({ key: k, depth: 0 })
    }
  }

  const includedNodes: GraphNodeSnapshot[] = []
  let estimatedTokens = 0
  let truncated = false
  let truncateReason: 'token_budget' | 'max_entities' | undefined

  while (queue.length > 0) {
    const { key, depth } = queue.shift()!
    const node = allNodesByKey.get(key)!
    const cost = tokenEstimator(node)

    // entity-count cap
    if (maxEntities !== undefined && includedNodes.length + 1 > maxEntities) {
      truncated = true
      truncateReason = 'max_entities'
      break
    }
    // budget cap — check BEFORE adding so we don't include a node we can't afford
    if (estimatedTokens + cost > maxTokens) {
      truncated = true
      truncateReason = 'token_budget'
      break
    }

    includedNodes.push(node)
    estimatedTokens += cost

    if (depth >= maxDepth) continue
    const neighbors = adj.get(key) || []
    for (const nb of neighbors) {
      if (!visited.has(nb)) {
        visited.set(nb, depth + 1)
        queue.push({ key: nb, depth: depth + 1 })
      }
    }
  }

  // Edge pruning: keep edges whose BOTH endpoints are in the included set
  const includedKeys = new Set(includedNodes.map(n => `${n.type}:${n.key}`))
  const includedEdges = snapshot.edges.filter(e =>
    includedKeys.has(`${e.fromType}:${e.fromKey}`) &&
    includedKeys.has(`${e.toType}:${e.toKey}`)
  )

  return {
    nodes: includedNodes,
    edges: includedEdges,
    truncated,
    truncateReason,
    estimatedTokens
  }
}
