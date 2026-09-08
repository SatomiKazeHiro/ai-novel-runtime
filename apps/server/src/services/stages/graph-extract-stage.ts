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

  const prompt = `抽取本章实体节点和关系边。

type 仅限 character / faction / event / item。
复用【已有 graph key】中的 key；新 key 用拼音小写下划线。
importance >= 6 才提取。
relation 简洁。

已有 key：${keyList}
已有角色名：${charList}

章节大纲：${input.outline}
章节内容：${input.content.slice(0, 8000)}

输出 JSON：
{"nodes":[{"type":"character","key":"zhangsan","label":"张三","importance":8,"data":{}}],"edges":[{"fromType":"character","fromKey":"zhangsan","toType":"faction","toKey":"mingjiao","relation":"隶属"}]}`

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
