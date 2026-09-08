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

/**
 * AI JSON 字段名短→长映射。prompt 用短名省 token, 代码内部仍用长名。
 * 取值时优先短名, fallback 长名 —— 老数据 / AI 偶尔写长名也接受。
 */
const FIELD_ALIASES = {
  nodes: 'n',
  edges: 'e',
  type: 't',
  key: 'k',
  label: 'l',
  data: 'd',
  fromType: 'ft',
  fromKey: 'fk',
  toType: 'tt',
  toKey: 'tk',
  relation: 'r'
} as const

function aliasKey<T = any>(obj: any, long: keyof typeof FIELD_ALIASES): T | undefined {
  if (!obj || typeof obj !== 'object') return undefined
  const short = FIELD_ALIASES[long]
  return (obj[short] ?? obj[long]) as T | undefined
}

/**
 * 把 AI 返回的短名 JSON 归一化为内部结构（长名）。
 * 不读 importance —— 上一轮实验证明 AI 自评 -1 / 配角 > 主角 等范式不可靠，
 * 改由【主线事件合并 / 支线独立 / 角色优先】三原则让 AI 按剧情作用判定。
 */
function normalizeGraph(parsed: any): { nodes: any[]; edges: any[] } {
  const rawNodes = Array.isArray(aliasKey(parsed, 'nodes')) ? aliasKey<any[]>(parsed, 'nodes')! : []
  const rawEdges = Array.isArray(aliasKey(parsed, 'edges')) ? aliasKey<any[]>(parsed, 'edges')! : []

  return {
    nodes: rawNodes
      .filter((n: any) => {
        const t = aliasKey<string>(n, 'type')
        const k = aliasKey<string>(n, 'key')
        return n && typeof n === 'object' && typeof t === 'string' && typeof k === 'string'
      })
      .map((n: any) => ({
        type: aliasKey<string>(n, 'type')!,
        key: aliasKey<string>(n, 'key')!,
        label: (() => {
          const l = aliasKey<string>(n, 'label')
          return typeof l === 'string' ? l : aliasKey<string>(n, 'key')!
        })(),
        data: (() => {
          const d = aliasKey<Record<string, unknown>>(n, 'data')
          return d && typeof d === 'object' ? d : {}
        })()
      })),
    edges: rawEdges.map((e: any) => ({
      fromType: aliasKey<string>(e, 'fromType'),
      fromKey: aliasKey<string>(e, 'fromKey'),
      toType: aliasKey<string>(e, 'toType'),
      toKey: aliasKey<string>(e, 'toKey'),
      relation: (() => {
        const r = aliasKey<string>(e, 'relation')
        return typeof r === 'string' ? r : ''
      })(),
      // extract 阶段永远是新增边, weight 由 cumulative-graph.ts codeMerge 累加
      weight: 1
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

  const prompt = `【任务】
分析章节内容，提取对剧情有实质推动作用的核心实体和它们之间的关系。

【实体与关系定义】
- type 可选值：character(角色), faction(势力/组织), event(事件), item(物品/道具)
- relation 建议值：隶属、对抗、师徒、配偶、兄弟、持有、发生地点、涉及
- relation 应是简洁的核心词或短语（2-6字为佳），直接表达两实体间的核心联系，不要带状语、从句或补充说明

【提取规则】
1. 【主线事件合并】同一主线剧情链的连续事件必须合并为一个整体事件节点。例如"许青找食材→下厨炒菜→姜禾品尝→指点厨艺"应合并为一个事件节点"许青教姜禾厨艺"，而不是拆成多个事件。
2. 【支线独立】与主线并行的独立支线（如第三方暗中观察、配角个人线）可以作为独立事件节点。
3. 【角色优先】主角和重要配角必须提取；路人、一次性提及的次要角色不要提取。
4. 【物品克制】只提取对剧情有实质推动的关键物品（主角佩剑/关键道具/信物），日常用品（餐具/衣物/家电/家具/书籍）不要提取，即便主角日常使用也不算关键物品。
5. 【事件 label 简短】label 只给图谱节点显示用, 4-8 字概括核心动作, 不堆叠人名; 不要写"许青收留姜禾并安置起居"这类含多动作的复合句, 详细情节放 data.desc。

【已有实体】（不要重复提取，但可补充新属性）：${keyList}

【章节内容】
${input.content}

【输出格式】
返回严格 JSON 格式，不要 markdown 代码块。**严格用下方短名**，不要用长名：

字段映射：n=nodes, e=edges, t=type, k=key, l=label, d=data, ft=fromType, fk=fromKey, tt=toType, tk=toKey, r=relation

{
  "n": [
    { "t": "character", "k": "xu_qing", "l": "许青", "d": { "role": "本章主角,应届毕业生" } },
    { "t": "faction", "k": "yan_bang", "l": "盐帮", "d": { "location": "古代江湖" } },
    { "t": "event", "k": "jiang_he_chuan_yue", "l": "姜禾穿越", "d": { "desc": "姜禾从古代穿越到现代,出现在许青家中,持有盐帮佩剑" } }
  ],
  "e": [
    { "ft": "character", "fk": "xu_qing", "tt": "character", "tk": "jiang_he", "r": "收留" }
  ]
}`

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
