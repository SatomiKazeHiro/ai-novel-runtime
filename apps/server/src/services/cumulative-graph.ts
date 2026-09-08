import type { FastifyInstance } from 'fastify'
import { RuntimePromptCompiler } from '@novel-runtime/ai-provider'
import { cleanJsonBlock } from '@novel-runtime/shared'
import { loadRuntimeBase, loadWorkerTask } from './runtime-loader.js'
import { callAIWithLog } from './ai-call-logger.js'
import { type GraphSnapshot } from './graph-snapshot.js'

/**
 * 短→长字段映射, 用于解析 AI 返回 JSON。
 * 优先短名, fallback 长名 —— 老数据 / AI 偶尔写长名也接受。
 */
const FIELD_ALIASES = {
  mappings: 'mappings',
  from: 'f',
  to: 't',
  variants: 'v',
  canonical: 'c'
} as const

function aliasKey<T = any>(obj: any, long: keyof typeof FIELD_ALIASES): T | undefined {
  if (!obj || typeof obj !== 'object') return undefined
  const short = FIELD_ALIASES[long]
  return (obj[short] ?? obj[long]) as T | undefined
}

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
 *   - 正常 → AI 做 relation 字面归一映射(同义/升级/反转归到一个字面)→
 *           程序按映射重写 prev 全部 relation → codeMerge 把 chapterGraph 按归一后字面合并进 prev
 *
 * 设计动机(2026-07-28):
 *   原 dedup 阶段让 AI 输出"去重后图谱",但 AI 在 1 跳邻域内只能压缩局部,跨章 relation 漂移
 *   (例: c1 收留/决定帮助, c2 收留并帮助, c3 收留) 累积成多条字面不同的边, codeMerge 按
 *   `${from}|${relation}|${to}` 五元组去重直接失败。改让 AI 只做"relation 字面归一映射",
 *   图谱合并完全交给程序 —— 归一后 codeMerge 的五元组 key 自然命中, weight 累加。
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

  // 3. 正常路径:AI 做 relation 归一映射 → 程序应用 → codeMerge
  const prisma = app.prisma
  const base = await loadRuntimeBase(input.storyId, prisma)
  const task = await loadWorkerTask(input.storyId, 'graph', prisma)

  const compiler = new RuntimePromptCompiler()
  const compiled = compiler.compile(base, task, buildRelationMappingPrompt(prev, chapterGraph))

  let raw: string | null
  try {
    raw = await callAIWithLog(app, {
      storyId: input.storyId, chapterId: input.chapterId, callType: 'cumulative_dedup',
      compiled, temperature: 0.2, maxTokens: 8192
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

  // 解析 AI 返回的 relation 归一映射
  const mappingRaw = Array.isArray(aliasKey(parsed, 'mappings')) ? aliasKey<any[]>(parsed, 'mappings')! : []
  const mapping = parseRelationMapping(mappingRaw)

  // 应用映射: 重写 prev 全部边 relation 字面
  const normalizedPrev = applyRelationMapping(prev, mapping)
  const normalizedChapter = applyRelationMapping(chapterGraph, mapping)

  // codeMerge 按归一后字面合并 → 五元组 key 自然命中
  const merged = codeMerge(normalizedPrev, normalizedChapter, now)

  app.log.info(
    `[CumulativeGraph] Mapping rules: ${mapping.size}. ` +
    `Prev edges: ${prev.edges.length} → ${normalizedPrev.edges.length}. ` +
    `Merged cumulative: ${merged.nodes.length} nodes, ${merged.edges.length} edges.`
  )

  return { cumulativeGraph: merged, aiCalled: true }
}

/**
 * 解析 AI 返回的 mapping:
 *   [{ from, to, variants: [...], canonical: "..." }, ...]
 * from/to 是 "type:key" 格式 (代码内部统一)
 */
function parseRelationMapping(raw: any[]): Map<string, string> {
  const map = new Map<string, string>()  // key = `${from}|${variant}`, value = canonical
  for (const m of raw) {
    if (!m || typeof m !== 'object') continue
    const from = aliasKey<string>(m, 'from')
    const to = aliasKey<string>(m, 'to')
    const canonical = aliasKey<string>(m, 'canonical')
    const variants = Array.isArray(aliasKey<any[]>(m, 'variants')) ? aliasKey<any[]>(m, 'variants')! : []
    if (typeof from !== 'string' || typeof to !== 'string' || typeof canonical !== 'string') continue
    for (const v of variants) {
      if (typeof v !== 'string') continue
      map.set(`${from}|${v}|${to}`, canonical)
    }
    // 兜底: 即使 variants 缺, from/to/canonical 自身也算一条
    map.set(`${from}|${canonical}|${to}`, canonical)
  }
  return map
}

/**
 * 应用 relation 映射到 snapshot: 重写每条边的 relation 字面
 */
function applyRelationMapping(snapshot: GraphSnapshot, mapping: Map<string, string>): GraphSnapshot {
  if (mapping.size === 0) return snapshot
  const rewrittenEdges = snapshot.edges.map(e => {
    const k = `${e.fromType}:${e.fromKey}|${e.relation}|${e.toType}:${e.toKey}`
    const canonical = mapping.get(k)
    if (canonical && canonical !== e.relation) {
      return { ...e, relation: canonical }
    }
    return e
  })
  return { ...snapshot, edges: rewrittenEdges }
}

function buildRelationMappingPrompt(prev: GraphSnapshot, chapterGraph: GraphSnapshot): string {
  return `你是小说知识图谱 relation 字面归一助手。

【任务】
基于"全局累计图(全部历史章节)边"和"本章图谱边",输出一份 relation 归一映射表(mapping)。
不输出图谱,只输出 mapping —— 程序会按 mapping 重写累计图里所有 relation 字面,再用统一字面合并。

【核心思路】
跨章节 AI 抽取的 relation 字面会漂移(同一段关系,不同章节写法不同)。例:
- ch#1: character:xu_qing -[收留/决定帮助]-> character:jiang_he
- ch#2: character:xu_qing -[收留并帮助]-> character:jiang_he
- ch#3: character:xu_qing -[收留]-> character:jiang_he
这三条字面不同,程序无法合并(按 from+relation+to 五元组去重失败)。
归一后全部映射到 "收留" 这一字面,程序自然合并, weight 累加。

【方向感知】
按 (fromType:fromKey → toType:toKey) 有序对处理,A→B 与 B→A 是两个独立关系,分别归一。
例: character:xu_qing → character:jiang_he 与 character:jiang_he → character:xu_qing 各自有自己的 variants 和 canonical。

【归一策略(同一有序对内的多条 relation)】
1. 【同义】字面或释义重复 → 合并为一个最简洁字面
   例: 收留/决定帮助 / 收留并帮助 / 决定帮助 / 收留 → 收留
2. 【升级】前后章存在阶段递进(关系强度由弱到强)→ 合并到终点状态
   例: 同事 / 恋人 / 夫妻 → 夫妻
   例: 师徒 / 仇敌 → 仇敌
3. 【反转】前后章关系性质反向 → 合并到反映剧情转折的那条
   例: 被刺 / 弃暗投明 → 弃暗投明
   例: 隶属 / 叛逃 → 叛逃
4. 字面差异明显、无法判断同义/升级/反转 → 不要输出这条 mapping,程序会保留原字面

【weight 字段】
代码内部用,不需要你处理。mapping 表里不要带 weight。

【累计图(全部历史边)】
${JSON.stringify({ edges: prev.edges })}

【本章图谱(全部边)】
${JSON.stringify({ edges: chapterGraph.edges })}

【输出格式】
返回严格 JSON,不要 markdown 代码块。

{
  "mappings": [
    {
      "from": "character:xu_qing",
      "to": "character:jiang_he",
      "variants": ["收留/决定帮助", "收留并帮助", "收留"],
      "canonical": "收留"
    },
    {
      "from": "character:jiang_he",
      "to": "character:xu_qing",
      "variants": ["被收留/戒备与初步信任", "初步信任并依赖"],
      "canonical": "依赖"
    }
  ]
}

没有需要归一的关系时, mappings 返回空数组 []。`
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
  // 关系字面漂移由 dedup 阶段 (buildRelationMappingPrompt) 处理:
  //   - AI 输出 mappings, 程序 applyRelationMapping 重写 prev/chapterGraph 的 relation 字段
  //   - 这里 codeMerge 看到的是归一后字面, 五元组 key 命中, weight 累加正确
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
