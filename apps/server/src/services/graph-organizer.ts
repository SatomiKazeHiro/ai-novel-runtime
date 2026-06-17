import type { FastifyInstance } from 'fastify'
import { RuntimePromptCompiler } from '@novel-runtime/ai-provider'
import { cleanJsonBlock } from '@novel-runtime/shared'
import { loadRuntimeBase, loadWorkerTask } from './runtime-loader.js'
import { callAIWithLog } from './ai-call-logger.js'
import { resolveProvider } from './ai-provider-init.js'
import type { GraphExtractionResult } from './graph-extractor.js'
import { expandNeighborhood, type GraphSnapshot } from './graph-snapshot.js'

const SAFETY_MARGIN_TOKENS = 2000
const MAX_NEIGHBORHOOD_ENTITIES = 200
const NEIGHBORHOOD_MAX_DEPTH = 2
const NEIGHBORHOOD_BUDGET_HEADROOM = 0.9  // warn at 90% budget usage

export async function organizeGraph(
  app: FastifyInstance,
  storyId: string,
  chapterId: string,
  previousSnapshot: GraphSnapshot | null,
  extractedGraph: GraphExtractionResult
): Promise<{ mergedGraph: GraphSnapshot; chapterGraph: GraphSnapshot }> {
  const prisma = app.prisma

  // Step 1: key matching — which N-1 nodes does this chapter re-use?
  const prevKeySet = new Set(
    (previousSnapshot?.nodes || []).map(n => `${n.type}:${n.key}`)
  )
  const newKeys = (extractedGraph.nodes || []).map(n => `${n.type}:${n.key}`)
  const matchedKeys = newKeys.filter(k => prevKeySet.has(k))

  // Step 2: code-merge fast path — no key overlap means no neighborhood to feed AI.
  // Skip the AI call entirely; the chapter's extracted graph IS the chapter delta.
  if (matchedKeys.length === 0) {
    return codeMerge(previousSnapshot, extractedGraph)
  }

  // Step 3: 2-hop BFS over N-1 starting from matched keys.
  const base = await loadRuntimeBase(storyId, prisma)
  const task = await loadWorkerTask(storyId, 'graph', prisma)

  // First compile pass with the FULL snapshot to learn how much of the prompt
  // budget is consumed by the non-graph parts (system + style + rules + ...).
  // We then use that number to compute the graph-side budget.
  const fullSnapshot = previousSnapshot || { nodes: [], edges: [], timestamp: '' }
  const firstCompiler = new RuntimePromptCompiler()
  const firstCompiled = firstCompiler.compile(base, task, buildOrganizePrompt(fullSnapshot, extractedGraph))
  const nonGraphTokens = firstCompiled.meta.totalTokens

  const resolved = await resolveProvider(prisma, storyId, chapterId)
  const contextLength = resolved?.config?.contextLength || 64000
  const outputReserve = resolved?.config?.maxTokens || 16384
  const graphBudget = Math.max(
    0,
    contextLength - nonGraphTokens - outputReserve - SAFETY_MARGIN_TOKENS
  )

  const neighborhood = expandNeighborhood(
    fullSnapshot,
    matchedKeys,
    {
      maxDepth: NEIGHBORHOOD_MAX_DEPTH,
      maxTokens: graphBudget,
      maxEntities: MAX_NEIGHBORHOOD_ENTITIES
    }
  )

  if (neighborhood.truncated) {
    // Per design spec §4.5: warn at ≥90% budget usage, so normal (well-fit)
    // truncations don't spam TODO logs on every archive call. High-usage
    // truncations are a real signal that contextLength may need bumping.
    const usageRatio = neighborhood.estimatedTokens / Math.max(1, graphBudget)
    if (usageRatio >= NEIGHBORHOOD_BUDGET_HEADROOM) {
      app.log.warn(
        `[TODO][GraphOrganizer] Neighborhood truncated (${neighborhood.truncateReason}), ` +
        `used ${neighborhood.estimatedTokens}/${graphBudget} tokens ` +
        `(${(usageRatio * 100).toFixed(0)}%), ` +
        `${neighborhood.nodes.length} nodes included. ` +
        `Consider increasing contextLength in ModelManager.`
      )
    }
  }

  // Second compile pass with the trimmed neighborhood as the "previous" graph.
  const trimmedSnapshot: GraphSnapshot = {
    nodes: neighborhood.nodes,
    edges: neighborhood.edges,
    timestamp: fullSnapshot.timestamp
  }
  const compiler = new RuntimePromptCompiler()
  const compiled = compiler.compile(base, task, buildOrganizePrompt(trimmedSnapshot, extractedGraph))

  // Step 4: AI call (unchanged from before)
  let raw: string | null
  try {
    raw = await callAIWithLog(app, {
      storyId, chapterId, callType: 'graph_organize',
      compiled, temperature: 0.2, maxTokens: 16384
    })
  } catch (err: any) {
    app.log.error(`[GraphOrganizer] AI call failed: ${err.message}`)
    throw err
  }
  if (!raw) {
    throw new Error('未配置可用的 AI Provider，请检查模型配置')
  }

  let result: any
  try {
    result = JSON.parse(cleanJsonBlock(raw))
  } catch (parseErr: any) {
    app.log.error(`[GraphOrganizer] JSON parse failed. Raw: ${raw.slice(0, 500)}`)
    throw new Error(`AI 返回格式错误，无法解析 JSON: ${parseErr.message}`)
  }

  const mergedGraph: GraphSnapshot = {
    nodes: result.mergedGraph?.nodes || [],
    edges: result.mergedGraph?.edges || [],
    timestamp: new Date().toISOString()
  }
  const chapterGraph: GraphSnapshot = {
    nodes: result.chapterGraph?.nodes || [],
    edges: result.chapterGraph?.edges || [],
    timestamp: new Date().toISOString()
  }

  app.log.info(
    `[GraphOrganizer] Neigh: ${neighborhood.nodes.length} nodes / ` +
    `${neighborhood.estimatedTokens} tok (cap ${graphBudget}). ` +
    `Merged: ${mergedGraph.nodes.length} nodes, ${mergedGraph.edges.length} edges. ` +
    `Chapter: ${chapterGraph.nodes.length} nodes, ${chapterGraph.edges.length} edges.`
  )

  return { mergedGraph, chapterGraph }
}

function buildOrganizePrompt(prev: GraphSnapshot, extracted: GraphExtractionResult): string {
  return `你是小说知识图谱整理助手。

【任务】
1. 将"上一章的邻域子图"与"本章新提取的节点/边"合并为一个新的全局图谱。
2. 基于"本章新提取的节点/边"，独立生成本章的范围图谱（本章纯净视图，不被全局历史污染）。

【上一章邻域子图（与本章新节点相关的 2 层邻居）】
${JSON.stringify(prev)}

【本章新提取】
${JSON.stringify(extracted)}

【全局合并规则（仅用于 mergedGraph）】
1. 节点去重：相同 type:key 的节点合并 data，label 以最新描述为准
2. 旧节点保留，不要删除

【关系合并与优化规则（核心）】
1. 同一对节点间，如果 relation 语义相同或相近（如"被收留"和"被收留并信任"），合并为一条，使用最能概括全貌的表述
2. 同一剧情线的连续经历（如"收留→教她学习→给她办理户口"），合并为一条概括性 relation，不怕长但要包含完整核心信息。例如合并为"收留并教她学习，给她办理户口"
3. 根本性不同的独立事件（如"教她武功"和"给她办理户口"），保留为多条边
4. 同一章内或时间上接近的事件，优先合并或优化
5. 语义不同但属同一对节点的不同情况（如"道侣，信任和恩爱" + "假装背叛"），保留为多条边
6. relation 可以是较长的概括性短语，但必须包含该关系的核心信息，不要遗漏关键内容

【边去重规则】
- 合并优化后，相同 (fromType:fromKey, relation, toType:toKey) 的边只保留一条
- 同一对节点间的不同 relation（如"师徒"和"兄弟"）保留为多条边

【type 约束】
所有 type 字段必须是以下四种之一："character"、"faction"、"event"、"item"。

【本章范围图谱规则（用于 chapterGraph）】
1. 只基于"本章新提取"的节点和边，不要从邻域子图中引入本章未提及的节点/边
2. 只对本章新提取做格式化和去重，不合并邻域 data
3. 节点 data 和边 relation 必须严格反映本章明确提及的内容
4. 如果本章新提取的关系是"投靠"，就保持"投靠"，不要替换成邻域中更复杂的历史关系
5. chapterGraph 是本章的纯净视图，不得夹带邻域历史前提

【type 约束（非常重要）】
所有 type 字段必须是以下四种标准值之一，不得使用其他值：
- "character"（角色/人物）
- "faction"（势力/组织/门派）
- "event"（事件）
- "item"（物品/道具/武器/装备/法宝）
如果 AI 想返回 "weapon"、"prop"、"object" 等其他值，一律收敛为 "item"。

【输出格式】
返回严格 JSON，不要 markdown：
{
  "mergedGraph": {
    "nodes": [{ "type": "character", "key": "zhangsan", "label": "张三", "data": {} }],
    "edges": [{ "fromType": "character", "fromKey": "zhangsan", "toType": "character", "toKey": "lisi", "relation": "兄弟", "weight": 1 }]
  },
  "chapterGraph": {
    "nodes": [...],
    "edges": [...]
  }
}

mergedGraph 是合并后的新全局图谱（包含邻域子图 + 本章新增/更新）。
chapterGraph 是本章的范围图谱（基于本章新提取独立生成，只反映本章内容，不夹带邻域历史）。`
}

function codeMerge(
  previousSnapshot: GraphSnapshot | null,
  extracted: GraphExtractionResult
): { mergedGraph: GraphSnapshot; chapterGraph: GraphSnapshot } {
  const prevNodes = previousSnapshot?.nodes || []
  const prevEdges = previousSnapshot?.edges || []
  const newNodes = extracted.nodes || []
  const newEdges = extracted.edges || []

  // Node union, dedupe by type:key (extracted overrides on collision).
  // Coerce to GraphNodeSnapshot shape (data is required, default {}).
  const nodeMap = new Map<string, any>()
  for (const n of prevNodes) {
    nodeMap.set(`${n.type}:${n.key}`, { ...n, data: n.data || {} })
  }
  for (const n of newNodes) {
    nodeMap.set(`${n.type}:${n.key}`, { ...n, data: n.data || {} })
  }

  // Edge union, dedupe by (fromType, fromKey, relation, toType, toKey).
  // ExtractedEdge omits weight; default to 1.
  const seen = new Set<string>()
  const mergedEdges: any[] = []
  for (const e of [...prevEdges, ...newEdges]) {
    const k = `${e.fromType}:${e.fromKey}|${e.relation}|${e.toType}:${e.toKey}`
    if (seen.has(k)) continue
    seen.add(k)
    mergedEdges.push({ ...e, weight: (e as any).weight ?? 1 })
  }

  const now = new Date().toISOString()
  return {
    mergedGraph: {
      nodes: Array.from(nodeMap.values()),
      edges: mergedEdges,
      timestamp: now
    },
    chapterGraph: {
      nodes: newNodes.map(n => ({ ...n, data: n.data || {} })),
      edges: newEdges.map(e => ({ ...e, weight: (e as any).weight ?? 1 })),
      timestamp: now
    }
  }
}
