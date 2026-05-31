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
): Promise<{ mergedGraph: GraphSnapshot; chapterGraph: GraphSnapshot } | null> {
  const prisma = app.prisma

  const base = await loadRuntimeBase(storyId, prisma)
  const task = await loadWorkerTask(storyId, 'graph', prisma)

  const organizePrompt = `你是小说知识图谱整理助手。

【任务】
将"上一章的全局图谱"与"本章新提取的节点/边"合并为一个新的全局图谱，同时生成本章的范围图谱。

【上一章全局图谱】
${JSON.stringify(previousSnapshot || { nodes: [], edges: [] })}

【本章新提取】
${JSON.stringify(extractedGraph)}

【合并规则】
1. 节点去重：相同 type:key 的节点合并 data，label 以最新描述为准
2. 边去重：相同 (fromType:fromKey, relation, toType:toKey) 的边只保留一条
3. 同一对节点间的不同 relation 保留为多条边
4. 新节点/边加入全局图谱
5. 旧节点保留，不要删除

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
chapterGraph 是本章实际涉及的范围图谱（去重精炼后的，只包含本章相关的节点和边）。`

  try {
    const compiler = new RuntimePromptCompiler()
    const compiled = compiler.compile(base, task, organizePrompt)

    const raw = await callAIWithLog(app, {
      storyId, chapterId, callType: 'graph_organize',
      compiled, temperature: 0.2, maxTokens: 4096
    })
    if (!raw) return null

    const result = JSON.parse(cleanJsonBlock(raw))

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
    return null
  }
}
