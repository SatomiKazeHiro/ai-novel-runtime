import type { FastifyInstance } from 'fastify'
import { RuntimePromptCompiler } from '@novel-runtime/ai-provider'
import { cleanJsonBlock } from '@novel-runtime/shared'
import { loadRuntimeBase, loadWorkerTask } from './runtime-loader.js'
import { callAIWithLog } from './ai-call-logger.js'
import type { GraphExtractionResult } from './graph-extractor.js'
import type { GraphSnapshot } from './graph-snapshot.js'

export async function organizeGraph(
  app: FastifyInstance,
  storyId: string,
  chapterId: string,
  previousSnapshot: GraphSnapshot | null,
  extractedGraph: GraphExtractionResult
): Promise<{ mergedGraph: GraphSnapshot; chapterGraph: GraphSnapshot }> {
  const prisma = app.prisma

  const base = await loadRuntimeBase(storyId, prisma)
  const task = await loadWorkerTask(storyId, 'graph', prisma)

  const organizePrompt = `你是小说知识图谱整理助手。

【任务】
1. 将"上一章的全局图谱"与"本章新提取的节点/边"合并为一个新的全局图谱。
2. 基于"本章新提取的节点/边"，独立生成本章的范围图谱（本章纯净视图，不被全局历史污染）。

【上一章全局图谱】
${JSON.stringify(previousSnapshot || { nodes: [], edges: [] })}

【本章新提取】
${JSON.stringify(extractedGraph)}

【全局合并规则（仅用于 mergedGraph）】
1. 节点去重：相同 type:key 的节点合并 data，label 以最新描述为准
2. 旧节点保留，不要删除

【关系合并与优化规则（核心）】
1. 同一对节点间，如果 relation 语义相同或相近（如"被收留"和"被收留并信任"），合并为一条，使用最能概括全貌的表述
2. 同一剧情线的连续经历（如"收留→教她学习→给她办理户口"），合并为一条概括性 relation，不怕长但要包含完整核心信息。例如合并为"收留并教她学习，给她办理户口"
3. 根本性不同的独立事件（如"教她武功"和"给她办理户口"），保留为多条边
4. 同一章内或时间上接近的事件，优先合并或优化
5. relation 可以是较长的概括性短语，但必须包含该关系的核心信息，不要遗漏关键内容

【边去重规则】
- 合并优化后，相同 (fromType:fromKey, relation, toType:toKey) 的边只保留一条
- 同一对节点间的不同 relation（如"师徒"和"兄弟"）保留为多条边

【type 约束】
所有 type 字段必须是以下四种之一："character"、"faction"、"event"、"item"。

【本章范围图谱规则（用于 chapterGraph）】
1. 只基于"本章新提取"的节点和边，不要从全局图谱中引入本章未提及的节点/边
2. 只对本章新提取做格式化和去重，不合并全局历史 data
3. 节点 data 和边 relation 必须严格反映本章明确提及的内容
4. 如果本章新提取的关系是"投靠"，就保持"投靠"，不要替换成全局中更复杂的历史关系
5. chapterGraph 是本章的纯净视图，不得夹带全局历史前提

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

mergedGraph 是合并后的新全局图谱（包含所有历史节点/边 + 本章新增/更新）。
chapterGraph 是本章的范围图谱（基于本章新提取独立生成，只反映本章内容，不夹带全局历史）。`

  try {
    const compiler = new RuntimePromptCompiler()
    const compiled = compiler.compile(base, task, organizePrompt)

    const raw = await callAIWithLog(app, {
      storyId, chapterId, callType: 'graph_organize',
      compiled, temperature: 0.2, maxTokens: 16384
    })
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

    app.log.info(`[GraphOrganizer] Merged: ${mergedGraph.nodes.length} nodes, ${mergedGraph.edges.length} edges. Chapter: ${chapterGraph.nodes.length} nodes, ${chapterGraph.edges.length} edges.`)

    return { mergedGraph, chapterGraph }
  } catch (err: any) {
    app.log.error(`[GraphOrganizer] Failed: ${err.message}`)
    throw err
  }
}
