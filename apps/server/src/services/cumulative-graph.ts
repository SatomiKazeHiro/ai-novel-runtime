import type { FastifyInstance } from 'fastify'
import { RuntimePromptCompiler } from '@novel-runtime/ai-provider'
import { cleanJsonBlock } from '@novel-runtime/shared'
import { loadRuntimeBase, loadWorkerTask } from './runtime-loader.js'
import { callAIWithLog } from './ai-call-logger.js'
import { expandNeighborhood, type GraphSnapshot } from './graph-snapshot.js'

const SAFETY_MARGIN_TOKENS = 2000
const NEIGHBORHOOD_MAX_DEPTH = 2
const NEIGHBORHOOD_MAX_ENTITIES = 200

const NON_EVENT_TYPES = new Set(['character', 'faction', 'item'])

export interface CumulativeGraphInput {
  storyId: string
  chapterId: string
  chapterNumber: number
  chapterGraph: GraphSnapshot | null
  prevCumulativeGraph: GraphSnapshot | null
}

export interface CumulativeGraphResult {
  cumulativeGraph: GraphSnapshot
  aiCalled: boolean
}

/**
 * 从 chapterGraph + prev cumulativeGraph 计算本章节全局图谱。
 *
 * 路径:
 *   - 空 chapterGraph → 继承 prev
 *   - 首章 (prev = null) → 直接用 chapterGraph
 *   - 正常 → 2-hop BFS 找 prev 中与 chapterGraph 共享 type:key 的邻域 → 与 chapterGraph 合并 →
 *           AI 去重(对邻域内的边和节点)→ code merge 进 prev(基于 fromType:fromKey:relation:toType:toKey 去重)
 */
export async function buildCumulativeGraph(
  app: FastifyInstance,
  input: CumulativeGraphInput
): Promise<CumulativeGraphResult> {
  const chapterGraph = input.chapterGraph
  const prev = input.prevCumulativeGraph
  const now = new Date().toISOString()

  // 1. 空 chapterGraph:继承 prev(用户可能想完全删除本章图谱)
  if (!chapterGraph || chapterGraph.nodes.length === 0) {
    return {
      cumulativeGraph: prev ?? { nodes: [], edges: [], timestamp: now },
      aiCalled: false
    }
  }

  // 2. 首章:chapterGraph 自身即为全局图谱
  if (!prev) {
    return {
      cumulativeGraph: { ...chapterGraph, timestamp: now },
      aiCalled: false
    }
  }

  // 3. 正常路径:2-hop BFS + AI 去重 + code merge
  const prisma = app.prisma

  // 收集 chapterGraph 中的非 event 节点作为锚点
  const nonEventKeys = chapterGraph.nodes
    .filter(n => NON_EVENT_TYPES.has(n.type))
    .map(n => `${n.type}:${n.key}`)

  // prev 中匹配这些 key 的节点
  const prevKeySet = new Set(prev.nodes.map(n => `${n.type}:${n.key}`))
  const matchedKeys = nonEventKeys.filter(k => prevKeySet.has(k))

  // 如果没有非 event 节点匹配 → code merge chapterGraph 进 prev(不调 AI)
  if (matchedKeys.length === 0) {
    return {
      cumulativeGraph: codeMerge(prev, chapterGraph, now),
      aiCalled: false
    }
  }

  // 2-hop BFS over prev 从 matchedKeys 出发
  const base = await loadRuntimeBase(input.storyId, prisma)
  const task = await loadWorkerTask(input.storyId, 'graph', prisma)

  const firstCompiler = new RuntimePromptCompiler()
  const firstCompiled = firstCompiler.compile(base, task, buildDedupPrompt(prev, chapterGraph))
  const nonGraphTokens = firstCompiled.meta.totalTokens

  const resolved = await (await import('./ai-provider-init.js')).resolveProvider(prisma, input.storyId, input.chapterId)
  const contextLength = resolved?.config?.contextLength || 64000
  const outputReserve = resolved?.config?.maxTokens || 16384
  const graphBudget = Math.max(
    0,
    contextLength - nonGraphTokens - outputReserve - SAFETY_MARGIN_TOKENS
  )

  const neighborhood = expandNeighborhood(prev, matchedKeys, {
    maxDepth: NEIGHBORHOOD_MAX_DEPTH,
    maxTokens: graphBudget,
    maxEntities: NEIGHBORHOOD_MAX_ENTITIES
  })

  // 用 trimmed neighborhood 作为 dedup 输入的一部分
  const trimmedPrev: GraphSnapshot = {
    nodes: neighborhood.nodes,
    edges: neighborhood.edges,
    timestamp: prev.timestamp
  }

  const compiler = new RuntimePromptCompiler()
  const compiled = compiler.compile(base, task, buildDedupPrompt(trimmedPrev, chapterGraph))

  let raw: string | null
  try {
    raw = await callAIWithLog(app, {
      storyId: input.storyId, chapterId: input.chapterId, callType: 'cumulative_dedup',
      compiled, temperature: 0.2, maxTokens: 16384
    })
  } catch (err: any) {
    app.log.error(`[CumulativeGraph] AI call failed: ${err.message}`)
    throw err
  }
  if (!raw) throw new Error('未配置可用的 AI Provider，请检查模型配置')

  let parsed: any
  try {
    parsed = JSON.parse(cleanJsonBlock(raw))
  } catch (err: any) {
    app.log.error(`[CumulativeGraph] JSON parse failed: ${err.message}`)
    throw new Error(`AI 返回格式错误: ${err.message}`)
  }

  const deduped: GraphSnapshot = {
    nodes: parsed.nodes || [],
    edges: parsed.edges || [],
    timestamp: now
  }

  // code merge deduped → prev
  const merged = codeMerge(prev, deduped, now)

  app.log.info(
    `[CumulativeGraph] Neigh: ${neighborhood.nodes.length} nodes. ` +
    `Deduped: ${deduped.nodes.length} nodes, ${deduped.edges.length} edges. ` +
    `Merged cumulative: ${merged.nodes.length} nodes, ${merged.edges.length} edges.`
  )

  return { cumulativeGraph: merged, aiCalled: true }
}

function buildDedupPrompt(neighborhood: GraphSnapshot, chapterGraph: GraphSnapshot): string {
  return `你是小说知识图谱去重助手。

【任务】基于"上一章邻域子图"和"本章图谱",生成去重后的"小范围子图"。
- 节点去重:相同 type:key 合并 data,以最新为准
- 边去重:相同 (fromType:fromKey, relation, toType:toKey) 只保留一条
- 删除孤立的"上一章"节点(没有任何边,且不在 chapterGraph 中)

【上一章邻域子图】
${JSON.stringify(neighborhood)}

【本章图谱】
${JSON.stringify(chapterGraph)}

【输出严格 JSON】
{
  "nodes": [{ "type": "character", "key": "zhangsan", "label": "张三", "data": {} }],
  "edges": [{ "fromType": "character", "fromKey": "zhangsan", "toType": "character", "toKey": "lisi", "relation": "兄弟", "weight": 1 }]
}`
}

function codeMerge(prev: GraphSnapshot, chapterGraph: GraphSnapshot, now: string): GraphSnapshot {
  const nodeMap = new Map<string, any>()
  for (const n of prev.nodes) nodeMap.set(`${n.type}:${n.key}`, { ...n, data: n.data || {} })
  for (const n of chapterGraph.nodes) nodeMap.set(`${n.type}:${n.key}`, { ...n, data: n.data || {} })

  // 边 weight = 跨章节出现次数 (程序计数, 不让 AI 自评)
  //   - 新边: weight = 1
  //   - 合并命中: weight += 1 (chapterGraph 里 AI 的 weight 字段被忽略)
  //   - 语义: weight=N 表示这条关系在 N 个章节被 AI 抽出过
  //
  // TODO(2026-07-28) 已知局限 — 命名漂移会让 weight 失真:
  //   - relation 漂移: AI 第 1 章写"收留", 第 3 章写"帮助", 第 5 章写"扶持"
  //     → 3 条不同边, weight 各 = 1, 实际是同一段关系
  //   - key 漂移: 同理, "xu_qing" / "xq" 不归一也算两条不同节点
  // 解决需要额外调一次 AI 做 relation / entity 归一化 (独立 scope).
  const edgeMap = new Map<string, any>()
  for (const e of [...prev.edges, ...chapterGraph.edges]) {
    const k = `${e.fromType}:${e.fromKey}|${e.relation}|${e.toType}:${e.toKey}`
    const existing = edgeMap.get(k)
    if (existing) {
      existing.weight += 1
    } else {
      edgeMap.set(k, { ...e, weight: 1 })
    }
  }

  return {
    nodes: Array.from(nodeMap.values()),
    edges: Array.from(edgeMap.values()),
    timestamp: now
  }
}
