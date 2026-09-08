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

  const prompt = `你是小说知识图谱抽取助手。质量优先，宁缺毋滥。

【任务】基于章节内容，抽取本章涉及的实体节点和关系边。只看本章正文，不要混入历史上下文。

【严格过滤 — 不合格直接丢弃，不上 graph】
1. **一次性物品不上 graph**：刀/剑/镖/杯/伞等没有专属名字的物品（如"长剑""铁镖""一把伞"）。除非是贯穿多章的专属神器（"屠龙刀""九阴真经"），否则一律不输出。
2. **路人配角不上 graph**：店小二/路人甲/某老妪等只出现一次、没有具体关系链的，过滤。
3. **场景描写不上 graph**：灵华宗大殿/山脚小镇/某客栈（地点走 scene 字段）；电视被毁/点了外卖/打了个哈欠（场景动作不是实体事件）。

【类型 — 只允许 3 类】
- character（角色）：本章有动作/对话/思想活动的有名角色
- faction（组织/门派/阵营）：有专属名字的组织
- event（事件）：本章发生的可命名核心剧情点（**必须是章节标题级别**，不是场景动作）

【faction 抽取 — 容易漏，必须执行】
- 角色自报家门时提到的组织（"盐帮弟子""灵华宗内门""朝廷命官"）→ **必须作为 faction 节点保留**
- 角色隶属该 faction → 必须输出 隶属 边
- faction 节点的 importance 给 8 或更高（角色身份定义性的）
- 例：原文"盐帮弟子，姜禾" → 必须输出 faction 节点「盐帮」+ 边「姜禾 隶属 盐帮」

【event 抽取 — 严格】
- 只有当事件在本章有具体角色参与，且会延续到后续章节，才保留 event 节点
- 一次性场景动作（电视被毁、点了外卖、打了个哈欠）→ 丢弃
- 抽象暗示而非具体事件（"时代真相揭露"如果本章只是暗示没揭示）→ 丢弃
- 仅作为章节标题或开场悬念、未真正落地的事件 → 丢弃

【节点命名】
- character/faction 类型 key 用角色/组织名英文拼音小写下划线
- 若在【已有 graph key 列表】中，复用对应 type:key
- event 类型 key 用英文小写下划线，命名要概括事件本身（如 encounter_in_rain）

【关系 — 必须从以下词表选，不允许自由发挥】
隶属 / 对抗 / 师徒 / 配偶 / 兄弟 / 朋友 / 敌对 / 亲属 / 师门 / 同门 / 敌师 / 盟友

【关系方向规则 — 必读】
- "A 隶属 B" 表示 A 是 B 的成员（A=角色，B=组织）
- **双向关系（配偶/朋友/兄弟/亲属）只输出一条边**，不要画 A→B 和 B→A 两条
- 有方向关系（隶属/对抗/师徒/师门/同门/敌师/敌对/盟友）按语义方向输出
- **不要输出语义不通的关系**（如"姜禾 隶属 长剑"——人不能隶属物品）
- **不要用"关联"逃避选词**——如果找不到合适的关系词，**直接不输出这条边**

【权重】
- weight=1 普通关系
- weight=2 紧密关系（师徒/配偶/隶属）
- 其他值收敛到 1

【典型丢弃示例（不要上 graph）】
- 店小二/路人甲/某老妪（一次性无名配角）
- 长剑/铁镖/扫帚/雨伞/酒杯（一次性无名字物品）
- 灵华宗大殿/山脚小镇/某客栈（场景地名）
- 电视被毁/点了外卖/打了个哈欠（场景动作）

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

    const normalized = nodes.map((n: any) => {
      const t = (n.type || '').toLowerCase()
      if (ALLOWED_TYPES.has(t)) return { ...n, type: t }
      // 非白名单 → 收敛为 item
      return { ...n, type: 'item' }
    })

    const filtered = normalized.filter((n: any) => (n.importance ?? 0) >= 8)

    const nodeKeySet = new Set(filtered.map((n: any) => `${n.type}:${n.key}`))

    // 丢边策略：orphan / 非白名单 relation / 端点缺失 → 全部丢弃
    // （宁可少输出，也不输出"关联"这种语义垃圾）
    const cleanedEdges = edges
      .filter((e: any) =>
        nodeKeySet.has(`${e?.fromType}:${e?.fromKey}`) &&
        nodeKeySet.has(`${e?.toType}:${e?.toKey}`)
      )
      .filter((e: any) => {
        const rel = typeof e?.relation === 'string' ? e.relation : ''
        return ALLOWED_RELATIONS.has(rel)
      })
      .map((e: any) => {
        const rawWeight = typeof e.weight === 'number' ? e.weight : 1
        const weight = Math.min(Math.max(rawWeight, 1), 2)
        return {
          fromType: e.fromType,
          fromKey: e.fromKey,
          toType: e.toType,
          toKey: e.toKey,
          relation: e.relation,
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
