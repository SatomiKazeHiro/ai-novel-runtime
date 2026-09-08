import type { FastifyInstance } from 'fastify'
import { RuntimePromptCompiler } from '@novel-runtime/ai-provider'
import { cleanJsonBlock } from '@novel-runtime/shared'
import { loadRuntimeBase, loadWorkerTask } from '../runtime-loader.js'
import { callAIWithStageRetry, type StageContext, type StageState } from './types.js'
import type { GraphSnapshot } from '../graph-snapshot.js'

export interface GraphExtractStageInput extends StageContext {
  characterNames: string[]
  prevCumulativeGraphKeys: string[]
  latestBranchStates: Array<{ characterId: string; name: string; status: string }>
}

export interface GraphExtractStageResult {
  chapterGraph: GraphSnapshot
}

/**
 * 本章图谱 stage：AI 单次抽取本章实体和关系，**不与历史合并**（gacha 语义）。
 * AI 必须复用 prevCumulativeGraphKeys 列表里的 type:key（锚定历史），
 * 否则不能引入新 key；character/faction/item 类型节点复用 characterNames。
 */
export async function runGraphExtractStage(
  app: FastifyInstance,
  input: GraphExtractStageInput
): Promise<StageState<GraphExtractStageResult>> {
  const completedAt = new Date().toISOString()
  const charList = input.characterNames.join('、') || '（无）'
  const keyList = input.prevCumulativeGraphKeys.length
    ? input.prevCumulativeGraphKeys.join(', ')
    : '（空，本章可自由起 key）'

  const prompt = `你是小说知识图谱抽取助手。

【任务】基于章节内容，抽取本章涉及的实体节点和关系边。只看本章正文，不要混入历史上下文。

【约束】
1. type 必须是以下 4 类之一，其他一律丢弃或收敛：
   - character（角色，有名字或代词指代）
   - faction（组织/门派/阵营）
   - event（本章发生的可命名事件）
   - item（关键物品/法器/秘笈，**只保留对剧情有直接作用的**）
   非上述类型（如 weapon / prop / realm / object / location）一律收敛为 item；若属于一次性场景描写则直接丢弃。
2. character/faction/item 类型节点：
   - 若在【已有 graph key 列表】中，复用对应 type:key
   - 若对应【已有角色名】，type=character，key 用角色英文拼音小写下划线
   - 否则 key 用拼音小写下划线
3. event 类型节点 key 用英文小写下划线
4. importance >= 8 才提取（过滤路人/环境/场景/物品）；任何只出现一次且无具体关系链的实体跳过
5. relation 必须从以下词表选，不允许自由发挥：
   隶属 / 对抗 / 师徒 / 配偶 / 兄弟 / 朋友 / 敌对 / 亲属 / 师门 / 同门 / 敌师 / 盟友
6. 同名实体必须复用已有 graph key，不允许另起 key
7. weight 取 1 或 2（1=普通关系，2=紧密关系），其他值收敛到 1

【典型丢弃示例（不要上 graph）】
- 店小二 / 路人甲 / 某老妪（一次性无名配角，无具体关系链）
- 某碗面 / 某壶酒 / 一把扫帚（一次性物品，无剧情作用）
- 灵华宗大殿 / 山脚小镇（场景地名，不是独立实体）
理由：只出现一次 + 无关系链 = 噪音节点，污染关系图。

【已有 graph key 列表（必须复用）】
${keyList}

【已有角色名（锚定命名）】
${charList}

【输出严格 JSON】
{
  "nodes": [{ "type": "character", "key": "zhangsan", "label": "张三", "importance": 8, "data": {} }],
  "edges": [{ "fromType": "character", "fromKey": "zhangsan", "toType": "faction", "toKey": "mingjiao", "relation": "隶属" }]
}

【章节大纲】${input.outline}
【章节内容】${input.content.slice(0, 8000)}`

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
      maxTokens: 2048
    })

    const parsed = JSON.parse(cleanJsonBlock(raw))
    const nodes = Array.isArray(parsed.nodes) ? parsed.nodes : []
    const edges = Array.isArray(parsed.edges) ? parsed.edges : []

    const ALLOWED_TYPES = new Set(['character', 'faction', 'event', 'item'])
    const ALLOWED_RELATIONS = new Set([
      '隶属', '对抗', '师徒', '配偶', '兄弟',
      '朋友', '敌对', '亲属', '师门', '同门',
      '敌师', '盟友'
    ])
    const RELATION_FALLBACK = '关联'

    const normalized = nodes.map((n: any) => {
      const t = (n.type || '').toLowerCase()
      if (ALLOWED_TYPES.has(t)) return { ...n, type: t }
      // 非白名单 → 收敛为 item
      return { ...n, type: 'item' }
    })

    const filtered = normalized.filter((n: any) => (n.importance ?? 0) >= 8)

    const nodeKeySet = new Set(filtered.map((n: any) => `${n.type}:${n.key}`))

    const cleanedEdges = edges
      .filter((e: any) =>
        nodeKeySet.has(`${e?.fromType}:${e?.fromKey}`) &&
        nodeKeySet.has(`${e?.toType}:${e?.toKey}`)
      )
      .map((e: any) => {
        const rel = typeof e.relation === 'string' ? e.relation : ''
        const relation = ALLOWED_RELATIONS.has(rel) ? rel : RELATION_FALLBACK
        const rawWeight = typeof e.weight === 'number' ? e.weight : 1
        const weight = Math.min(Math.max(rawWeight, 1), 2)
        return {
          fromType: e.fromType,
          fromKey: e.fromKey,
          toType: e.toType,
          toKey: e.toKey,
          relation,
          weight
        }
      })

    const chapterGraph: GraphSnapshot = {
      nodes: filtered.map((n: any) => ({
        type: n.type,
        key: n.key,
        label: n.label,
        data: n.data || {}
      })),
      edges: cleanedEdges,
      timestamp: new Date().toISOString()
    }

    return { status: 'success', result: { chapterGraph }, completedAt }
  } catch (err: any) {
    app.log.error(`[GraphExtractStage] ${err.message}`)
    return { status: 'failed', errorMessage: err.message, completedAt }
  }
}
