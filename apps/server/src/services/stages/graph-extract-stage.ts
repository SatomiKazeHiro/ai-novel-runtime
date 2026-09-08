import type { FastifyInstance } from 'fastify'
import { RuntimePromptCompiler } from '@novel-runtime/ai-provider'
import { cleanJsonBlock, aliasKey, GRAPH_NODE_EDGES_ALIASES } from '@novel-runtime/shared'
import { loadRuntimeBase, loadWorkerTask } from '../runtime-loader.js'
import { callAIWithStageRetry, type StageContext, type StageState } from './types.js'
import type { GraphSnapshot } from '../graph-snapshot.js'
import { buildGraphExtractPrompt } from './graph-extract.prompt.js'

export interface GraphExtractStageInput extends StageContext {
  characterNames: string[]
  prevCumulativeGraphNodes: Array<{ type: string; key: string; label: string }>
  prevCumulativeGraphEdges: Array<{ fromType: string; fromKey: string; toType: string; toKey: string; relation: string }>
  latestBranchStates: Array<{ characterId: string; name: string; status: string }>
}

export interface GraphExtractStageResult {
  chapterGraph: GraphSnapshot
}

/**
 * 把 AI 返回的短名 JSON 归一化为内部结构（长名）。
 * 不读 importance —— 上一轮实验证明 AI 自评 -1 / 配角 > 主角 等范式不可靠，
 * 改由【主线事件合并 / 支线独立 / 角色优先】三原则让 AI 按剧情作用判定。
 */
export function parseGraphResponse(parsed: any): { nodes: any[]; edges: any[] } {
  const rawNodes = Array.isArray(aliasKey(parsed, GRAPH_NODE_EDGES_ALIASES, 'nodes')) ? aliasKey<any[]>(parsed, GRAPH_NODE_EDGES_ALIASES, 'nodes')! : []
  const rawEdges = Array.isArray(aliasKey(parsed, GRAPH_NODE_EDGES_ALIASES, 'edges')) ? aliasKey<any[]>(parsed, GRAPH_NODE_EDGES_ALIASES, 'edges')! : []

  return {
    nodes: rawNodes
      .filter((n: any) => {
        const t = aliasKey<string>(n, GRAPH_NODE_EDGES_ALIASES, 'type')
        const k = aliasKey<string>(n, GRAPH_NODE_EDGES_ALIASES, 'key')
        return n && typeof n === 'object' && typeof t === 'string' && typeof k === 'string'
      })
      .map((n: any) => ({
        type: aliasKey<string>(n, GRAPH_NODE_EDGES_ALIASES, 'type')!,
        key: aliasKey<string>(n, GRAPH_NODE_EDGES_ALIASES, 'key')!,
        label: aliasKey<string>(n, GRAPH_NODE_EDGES_ALIASES, 'label') || aliasKey<string>(n, GRAPH_NODE_EDGES_ALIASES, 'key')!,
        data: (() => {
          const d = aliasKey<Record<string, unknown>>(n, GRAPH_NODE_EDGES_ALIASES, 'data')
          return d && typeof d === 'object' ? d : {}
        })()
      })),
    edges: rawEdges
      .filter((e: any) => {
        const ft = aliasKey<string>(e, GRAPH_NODE_EDGES_ALIASES, 'fromType')
        const fk = aliasKey<string>(e, GRAPH_NODE_EDGES_ALIASES, 'fromKey')
        const tt = aliasKey<string>(e, GRAPH_NODE_EDGES_ALIASES, 'toType')
        const tk = aliasKey<string>(e, GRAPH_NODE_EDGES_ALIASES, 'toKey')
        return typeof ft === 'string' && typeof fk === 'string' && typeof tt === 'string' && typeof tk === 'string'
      })
      .map((e: any) => ({
        fromType: aliasKey<string>(e, GRAPH_NODE_EDGES_ALIASES, 'fromType')!,
        fromKey: aliasKey<string>(e, GRAPH_NODE_EDGES_ALIASES, 'fromKey')!,
        toType: aliasKey<string>(e, GRAPH_NODE_EDGES_ALIASES, 'toType')!,
        toKey: aliasKey<string>(e, GRAPH_NODE_EDGES_ALIASES, 'toKey')!,
        relation: aliasKey<string>(e, GRAPH_NODE_EDGES_ALIASES, 'relation') || '',
        // extract 阶段永远是新增边, weight 由 cumulative-graph.ts codeMerge 累加
        weight: 1
      }))
  }
}

/**
 * drop orphan edges (endpoints not in node list)
 */
export function dropOrphanEdges(
  nodes: any[],
  edges: any[],
  log: { info: (msg: string) => void } = { info: () => {} }
): any[] {
  const nodeKeySet = new Set(nodes.map((n: any) => `${n.type}:${n.key}`))
  const valid = edges.filter((e: any) =>
    nodeKeySet.has(`${e.fromType}:${e.fromKey}`) &&
    nodeKeySet.has(`${e.toType}:${e.toKey}`)
  )
  if (edges.length !== valid.length) {
    log.info(
      `[GraphExtractStage] orphan edges dropped: ${edges.length - valid.length} (endpoints not in node list)`
    )
  }
  return valid
}

/**
 * dedup by unordered pair, keep top 2 by weight (distinct relation, per prompt spec)
 */
export function dedupEdgesByPair(
  edges: any[],
  log: { info: (msg: string) => void } = { info: () => {} },
  maxPerPair = 2
): any[] {
  const grouped = new Map<string, any[]>()
  for (const e of edges) {
    const a = `${e.fromType}:${e.fromKey}`
    const b = `${e.toType}:${e.toKey}`
    const pairKey = a < b ? `${a}|${b}` : `${b}|${a}`
    if (!grouped.has(pairKey)) grouped.set(pairKey, [])
    grouped.get(pairKey)!.push(e)
  }

  const deduped: any[] = []
  for (const [, group] of grouped) {
    const sorted = [...group].sort((x, y) => (y.weight ?? 1) - (x.weight ?? 1))
    const seenRels = new Set<string>()
    const kept: any[] = []
    for (const e of sorted) {
      if (kept.length >= maxPerPair) break
      if (seenRels.has(e.relation)) continue
      seenRels.add(e.relation)
      kept.push(e)
    }
    deduped.push(...kept)
  }
  if (edges.length !== deduped.length) {
    log.info(
      `[GraphExtractStage] edge dedup: ${edges.length} → ${deduped.length} (keep top ${maxPerPair} per unordered pair, distinct relation)`
    )
  }
  return deduped
}

/**
 * 本章图谱 stage：AI 单次抽取本章实体和关系，**不与历史合并**（gacha 语义）。
 * 传给 AI 的 keyList 已按 chapter content 预过滤（仅 label 出现在正文的实体），
 * AI 必须复用其 type:key（锚定历史），否则不能引入新 key；character/faction/item
 * 类型节点优先复用 characterNames。
 */
export async function runGraphExtractStage(
  app: FastifyInstance,
  input: GraphExtractStageInput
): Promise<StageState<GraphExtractStageResult>> {
  const completedAt = new Date().toISOString()
  const content = input.content || ''

  // keyList 预过滤: 只把本章正文里出现过的实体塞进 prompt, 避免污染 AI 抽取
  const matchedNodes = input.prevCumulativeGraphNodes.filter(
    (n) => n.label && content.includes(n.label)
  )
  if (input.prevCumulativeGraphNodes.length > 0) {
    app.log.info(
      `[GraphExtractStage] keyList pre-filter: ${input.prevCumulativeGraphNodes.length} → ${matchedNodes.length} (matched labels in content)`
    )
  }

  try {
    const prisma = app.prisma
    const base = await loadRuntimeBase(input.storyId, prisma)
    const task = await loadWorkerTask(input.storyId, 'graph', prisma)
    const compiler = new RuntimePromptCompiler()

    const prompt = buildGraphExtractPrompt({
      content: input.content,
      characterNames: input.characterNames,
      prevCumulativeGraphNodes: input.prevCumulativeGraphNodes,
      prevCumulativeGraphEdges: input.prevCumulativeGraphEdges
    })
    const compiled = compiler.compile(base, task, prompt)

    const raw = await callAIWithStageRetry(app, {
      storyId: input.storyId,
      chapterId: input.chapterId,
      callType: 'graph_extract_stage',
      compiled,
      maxTokens: 4096
    })

    const parsed = JSON.parse(cleanJsonBlock(raw))
    const { nodes, edges } = parseGraphResponse(parsed)
    const validEdges = dropOrphanEdges(nodes, edges, app.log)
    const dedupedEdges = dedupEdgesByPair(validEdges, app.log)

    const chapterGraph: GraphSnapshot = {
      nodes: nodes.map((n: any) => ({
        type: n.type,
        key: n.key,
        label: n.label,
        data: n.data || {}
      })),
      edges: dedupedEdges.map((e: any) => ({
        fromType: e.fromType,
        fromKey: e.fromKey,
        toType: e.toType,
        toKey: e.toKey,
        relation: e.relation,
        weight: 1
      })),
      timestamp: new Date().toISOString()
    }

    return { status: 'success', result: { chapterGraph }, completedAt }
  } catch (err: any) {
    app.log.error(`[GraphExtractStage] ${err.message}`)
    return { status: 'failed', errorMessage: err.message, completedAt }
  }
}
