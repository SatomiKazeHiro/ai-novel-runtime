import type { FastifyInstance } from 'fastify'
import { RuntimePromptCompiler } from '@novel-runtime/ai-provider'
import { cleanJsonBlock } from '@novel-runtime/shared'
import { loadRuntimeBase, loadWorkerTask } from './runtime-loader.js'
import { callAIWithLog } from './ai-call-logger.js'

export interface ExtractedNode {
  type: 'character' | 'faction' | 'realm' | 'event' | 'item'
  key: string
  label: string
  importance: number // 1-10，剧情推动作用
  data?: Record<string, any>
}

export interface ExtractedEdge {
  fromKey: string
  fromType: string
  toKey: string
  toType: string
  relation: string
}

export interface GraphExtractionResult {
  nodes: ExtractedNode[]
  edges: ExtractedEdge[]
}

export async function extractGraphFromChapter(
  app: FastifyInstance,
  chapterId: string,
  storyId: string,
  content: string
): Promise<GraphExtractionResult | null> {
  const prisma = app.prisma

  // 加载 Runtime Base + Graph Worker Task
  const base = await loadRuntimeBase(storyId, prisma)
  const task = await loadWorkerTask(storyId, 'graph', prisma)

  // 获取已有节点，用于去重提示
  const existingNodes = await prisma.graphNode.findMany({ where: { storyId } })
  const existingKeys = new Set(existingNodes.map(n => `${n.type}:${n.key}`))

  const extractPrompt = `请分析以下玄幻修仙小说章节，提取其中对剧情有实质推动作用的核心实体以及它们之间的关系。

提取原则（非常重要）：
1. 【主线事件合并】同一主线剧情链上的连续事件必须合并为一个整体事件节点。例如"明教内部分裂→成昆偷袭→六大门派围攻光明顶→张无忌出手化解恩怨"应合并为一个事件节点"六大门派围攻光明顶"，而不是拆成多个事件。
2. 【支线独立】与主线并行的独立支线（如第三方暗中观察、配角个人线）可以作为独立事件节点。
3. 【重要性过滤】只提取 importance >= 6 的实体。路人、一次性提及的角色、无剧情推动作用的环境/物品不要提取。
4. 【角色优先】主角团和重要配角必须提取，次要角色如果在本章无实质戏份不要提取。

返回严格 JSON 格式，不要 markdown 代码块：
{
  "nodes": [
    { "type": "character", "key": "zhangwuji", "label": "张无忌", "importance": 10, "data": { "rank": "先天境" } },
    { "type": "faction", "key": "mingjiao", "label": "明教", "importance": 9, "data": { "location": "光明顶" } },
    { "type": "event", "key": "guangmingding_siege", "label": "六大门派围攻光明顶", "importance": 10, "data": { "outcome": "张无忌化解恩怨" } }
  ],
  "edges": [
    { "fromKey": "zhangwuji", "fromType": "character", "toKey": "mingjiao", "toType": "faction", "relation": "隶属" }
  ]
}

type 可选值：character(角色), faction(势力/组织), event(事件), item(物品/道具)
relation 建议值：隶属、对抗、师徒、配偶、兄弟、持有、发生地点、涉及

已有实体（不要重复提取，但可补充新属性）：${Array.from(existingKeys).join(', ') || '无'}

章节内容如下：
${content.slice(0, 8000)}`

  app.log.info(`[GraphExtractor] Calling AI for chapter ${chapterId}`)

  try {
    const compiler = new RuntimePromptCompiler()
    const compiled = compiler.compile(base, task, extractPrompt)

    const raw = await callAIWithLog(app, {
      storyId, chapterId, callType: 'graph_extract',
      compiled, temperature: 0.3, maxTokens: 2048
    })
    if (!raw) return null

    const result: GraphExtractionResult = JSON.parse(cleanJsonBlock(raw))

    // 过滤低重要性实体
    const filteredNodes = (result.nodes || []).filter(n => n.importance >= 6)
    app.log.info(`[GraphExtractor] Extracted: ${filteredNodes.length} nodes (filtered from ${result.nodes?.length || 0}), ${result.edges?.length || 0} edges`)

    return { nodes: filteredNodes, edges: result.edges || [] }
  } catch (err: any) {
    app.log.error(`[GraphExtractor] Failed: ${err.message}`)
    return null
  }
}

export async function saveExtractedGraph(
  app: FastifyInstance,
  storyId: string,
  result: GraphExtractionResult
) {
  const prisma = app.prisma
  const nodeMap = new Map<string, string>() // key -> nodeId

  // 1. 加载已有节点建立 key -> id 映射
  const existingNodes = await prisma.graphNode.findMany({ where: { storyId } })
  for (const n of existingNodes) {
    nodeMap.set(`${n.type}:${n.key}`, n.id)
  }

  // 2. 创建/更新节点
  for (const node of result.nodes || []) {
    const compositeKey = `${node.type}:${node.key}`
    if (nodeMap.has(compositeKey)) {
      // 已有节点，更新 data（合并新信息）
      const existingId = nodeMap.get(compositeKey)!
      const existing = existingNodes.find(n => n.id === existingId)
      const existingData = existing ? JSON.parse(existing.data || '{}') : {}
      const mergedData = { ...existingData, ...(node.data || {}) }
      await prisma.graphNode.update({
        where: { id: existingId },
        data: { data: JSON.stringify(mergedData) }
      })
      app.log.info(`[GraphExtractor] Updated node: ${node.label} (${node.type})`)
    } else {
      // 新节点
      const created = await prisma.graphNode.create({
        data: {
          storyId,
          type: node.type,
          key: node.key,
          label: node.label,
          data: JSON.stringify(node.data || {})
        }
      })
      nodeMap.set(compositeKey, created.id)
      app.log.info(`[GraphExtractor] Created node: ${node.label} (${node.type})`)
    }
  }

  // 3. 创建关系边
  for (const edge of result.edges || []) {
    const fromId = nodeMap.get(`${edge.fromType}:${edge.fromKey}`)
    const toId = nodeMap.get(`${edge.toType}:${edge.toKey}`)
    if (!fromId || !toId) {
      app.log.warn(`[GraphExtractor] Skipping edge: missing node for ${edge.fromKey} -> ${edge.toKey}`)
      continue
    }

    // 检查是否已存在相同关系
    const existingEdge = await prisma.graphEdge.findFirst({
      where: { storyId, fromId, toId, relation: edge.relation }
    })
    if (!existingEdge) {
      await prisma.graphEdge.create({
        data: {
          storyId,
          fromId,
          toId,
          relation: edge.relation,
          weight: 1
        }
      })
      app.log.info(`[GraphExtractor] Created edge: ${edge.fromKey} -[${edge.relation}]-> ${edge.toKey}`)
    }
  }
}
