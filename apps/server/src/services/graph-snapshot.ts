import type { FastifyInstance } from 'fastify'

export interface GraphNodeSnapshot {
  type: string
  key: string
  label: string
  data: Record<string, any>
  // TODO(2026-07-28): 加 weight 字段, 含义 = 在正文中出现的重要性（章节内出现次数 / 总篇幅占比）,
  //   用于 cytoscape 节点大小映射。计数源: chapter content 中 label 出现次数, 不让 AI 自评。
  //   当前未启用 —— 见 cumulative-graph.ts codeMerge 同日注释。
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
