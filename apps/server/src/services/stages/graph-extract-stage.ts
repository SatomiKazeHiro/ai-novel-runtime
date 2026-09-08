import type { FastifyInstance } from 'fastify'
import { RuntimePromptCompiler } from '@novel-runtime/ai-provider'
import { cleanJsonBlock } from '@novel-runtime/shared'
import { loadRuntimeBase, loadWorkerTask } from '../runtime-loader.js'
import { callAIWithStageRetry, type StageContext, type StageState } from './types.js'
import type { GraphSnapshot } from '../graph-snapshot.js'

export interface GraphExtractStageInput extends StageContext {
  characterNames: string[]
  prevCumulativeGraphNodes: Array<{ type: string; key: string; label: string }>
  latestBranchStates: Array<{ characterId: string; name: string; status: string }>
}

export interface GraphExtractStageResult {
  chapterGraph: GraphSnapshot
}

/** 短字段名 → 长字段名映射（prompt 用短名省 token，代码内部仍用长名） */
const FIELD_ALIASES = {
  type: 't',
  key: 'k',
  label: 'l',
  importance: 'i',
  data: 'd',
  fromType: 'ft',
  fromKey: 'fk',
  toType: 'tt',
  toKey: 'tk',
  relation: 'r',
  weight: 'w'
} as const

/** 取字段：优先短名，回退长名 */
function aliasKey<T = any>(obj: any, long: keyof typeof FIELD_ALIASES): T | undefined {
  if (!obj || typeof obj !== 'object') return undefined
  const short = FIELD_ALIASES[long]
  return (obj[short] ?? obj[long]) as T | undefined
}

/** 把 AI 返回的短名 JSON 归一化成长名结构 */
function normalizeGraph(parsed: any): { nodes: any[]; edges: any[] } {
  const rawNodes = Array.isArray(parsed?.n)
    ? parsed.n
    : Array.isArray(parsed?.nodes)
      ? parsed.nodes
      : []
  const rawEdges = Array.isArray(parsed?.e)
    ? parsed.e
    : Array.isArray(parsed?.edges)
      ? parsed.edges
      : []

  return {
    nodes: rawNodes.map((n: any) => ({
      type: aliasKey<string>(n, 'type'),
      key: aliasKey<string>(n, 'key'),
      label: aliasKey<string>(n, 'label'),
      data: aliasKey<Record<string, unknown>>(n, 'data') || {}
    })),
    edges: rawEdges.map((e: any) => ({
      fromType: aliasKey<string>(e, 'fromType'),
      fromKey: aliasKey<string>(e, 'fromKey'),
      toType: aliasKey<string>(e, 'toType'),
      toKey: aliasKey<string>(e, 'toKey'),
      relation: aliasKey<string>(e, 'relation'),
      weight: aliasKey<number>(e, 'weight') ?? 1
    }))
  }
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
  const charList = input.characterNames.join('、') || '（无）'
  // keyList 预过滤: 只把本章正文里出现过的实体塞进 prompt, 避免污染 AI 抽取
  const content = input.content || ''
  const matchedNodes = input.prevCumulativeGraphNodes.filter(
    (n) => n.label && content.includes(n.label)
  )
  if (input.prevCumulativeGraphNodes.length > 0) {
    app.log.info(
      `[GraphExtractStage] keyList pre-filter: ${input.prevCumulativeGraphNodes.length} → ${matchedNodes.length} (matched labels in content)`
    )
  }
  const keyList = matchedNodes.length
    ? matchedNodes.map((n) => `${n.type}:${n.key}`).join(', ')
    : '（空，本章可自由起 key）'

  const prompt = `你是知识图谱抽取助手 — 从单章抽取对剧情有实质推动作用的核心实体和关系。

## 提取原则
- 【主线事件合并】同一主线剧情链的连续事件合并为 1 个事件节点;若本章含 2 条以上独立主线线索(剧情转折/重大决策/外部冲突),每条线索至少 1 个独立 event,不要全部归并到"主线"1 个
- 【角色优先】主角和重要配角必须提取;次要角色无实质戏份不提取
- 【物品克制】只提取反复出现或推动剧情的关键物品(主角佩剑、关键道具、信物、关键文书);常规环境不抽(餐具/衣物/家具/家电/书籍/车辆/日用品),即便主角日常使用也不算关键物品
- 【关系精炼】同一对实体间最多 2 条不同关系(如"师徒"+"对手"并存),按权重/代表性选 2 条

## 约束
- type 仅 4 类: character / faction / event / item
- 节点 key 复用已有列表;新 key 用拼音小写下划线
- 已有 key 列表里的实体默认满足门槛, 必须输出
- relation 默认 2 字能概括用 2 字, 否则 4-8 字;"A 隶属 B" 中 A=角色 B=组织,不输出人隶属物品

## 上下文
- 已有 key: ${keyList}
- 已知角色: ${charList}

## 输入
章节正文: ${input.content}

## 输出
严格 JSON,字段用短名 (t=type, k=key, l=label, d=data, ft=fromType, fk=fromKey, tt=toType, tk=toKey, r=relation, w=weight):
{"n":[{"t":"character","k":"xu_qing","l":"许青","d":{"role":"本章主角,应届毕业生"}},{"t":"character","k":"jiang_he","l":"姜禾","d":{"role":"穿越而来的古代女侠"}},{"t":"event","k":"xu_qing_shou_liu_jiang_he","l":"许青收留姜禾","d":{"desc":"本章主线: 许青收留穿越的姜禾,提供衣食住行"}}],"e":[{"ft":"character","fk":"xu_qing","tt":"character","tk":"jiang_he","r":"收留","w":10},{"ft":"character","fk":"xu_qing","tt":"event","tk":"xu_qing_shou_liu_jiang_he","r":"主导","w":10}]}`

  try {
    const prisma = app.prisma
    const base = await loadRuntimeBase(input.storyId, prisma)
    const task = await loadWorkerTask(input.storyId, 'graph', prisma)
    const compiler = new RuntimePromptCompiler()
    const compiled = compiler.compile(base, task, prompt)

    const raw = await callAIWithStageRetry(app, {
      storyId: input.storyId,
      chapterId: input.chapterId,
      callType: 'graph_extract_stage',
      compiled,
      maxTokens: 4096
    })

    const parsed = JSON.parse(cleanJsonBlock(raw))
    const { nodes, edges } = normalizeGraph(parsed)

    const nodeKeySet = new Set(nodes.map((n: any) => `${n.type}:${n.key}`))

    // drop orphan edges (endpoints not in node list)
    const validEdges = edges.filter((e: any) =>
      nodeKeySet.has(`${e.fromType}:${e.fromKey}`) &&
      nodeKeySet.has(`${e.toType}:${e.toKey}`)
    )
    if (edges.length !== validEdges.length) {
      app.log.info(
        `[GraphExtractStage] orphan edges dropped: ${edges.length - validEdges.length} (endpoints not in node list)`
      )
    }

    // dedup by unordered pair, keep top 2 by weight (distinct relation, per prompt spec)
    const MAX_EDGES_PER_PAIR = 2
    const grouped = new Map<string, any[]>()
    for (const e of validEdges) {
      const a = `${e.fromType}:${e.fromKey}`
      const b = `${e.toType}:${e.toKey}`
      const pairKey = a < b ? `${a}|${b}` : `${b}|${a}`
      if (!grouped.has(pairKey)) grouped.set(pairKey, [])
      grouped.get(pairKey)!.push(e)
    }

    const dedupedEdges: any[] = []
    for (const [, edges] of grouped) {
      // sort by weight desc
      const sorted = [...edges].sort((x, y) => (y.weight ?? 1) - (x.weight ?? 1))
      const seenRels = new Set<string>()
      const kept: any[] = []
      for (const e of sorted) {
        if (kept.length >= MAX_EDGES_PER_PAIR) break
        if (seenRels.has(e.relation)) continue
        seenRels.add(e.relation)
        kept.push(e)
      }
      dedupedEdges.push(...kept)
    }
    if (validEdges.length !== dedupedEdges.length) {
      app.log.info(
        `[GraphExtractStage] edge dedup: ${validEdges.length} → ${dedupedEdges.length} (keep top ${MAX_EDGES_PER_PAIR} per unordered pair, distinct relation)`
      )
    }

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
        weight: e.weight ?? 1
      })),
      timestamp: new Date().toISOString()
    }

    return { status: 'success', result: { chapterGraph }, completedAt }
  } catch (err: any) {
    app.log.error(`[GraphExtractStage] ${err.message}`)
    return { status: 'failed', errorMessage: err.message, completedAt }
  }
}
