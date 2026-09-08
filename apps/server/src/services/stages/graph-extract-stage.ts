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
1. type 必须是 character / faction / event / item 之一，其他值（如 weapon/prop/realm/object）一律收敛为 item
2. character/faction/item 类型节点：
   - 若在【已有 graph key 列表】中，复用对应 type:key
   - 若对应【已有角色名】，type=character，key 用角色英文拼音小写下划线
   - 否则 key 用拼音小写下划线
3. event 类型节点 key 用英文小写下划线
4. importance >= 6 才提取（过滤路人/环境）
5. relation 简洁（2-6 字），如 隶属 / 对抗 / 师徒 / 配偶 / 兄弟

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

    const filtered = nodes.filter((n: any) => (n.importance ?? 0) >= 6)

    const chapterGraph: GraphSnapshot = {
      nodes: filtered.map((n: any) => ({
        type: n.type,
        key: n.key,
        label: n.label,
        data: n.data || {}
      })),
      edges: edges.map((e: any) => ({
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
