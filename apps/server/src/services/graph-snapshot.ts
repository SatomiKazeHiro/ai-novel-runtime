import type { FastifyInstance } from 'fastify'

interface GraphNodeSnapshot {
  type: string
  key: string
  label: string
  data: Record<string, any>
}

interface GraphEdgeSnapshot {
  fromType: string
  fromKey: string
  toType: string
  toKey: string
  relation: string
  weight: number
}

interface GraphSnapshot {
  nodes: GraphNodeSnapshot[]
  edges: GraphEdgeSnapshot[]
  timestamp: string
}

interface GraphDelta {
  addedNodes: GraphNodeSnapshot[]
  updatedNodes: { node: GraphNodeSnapshot; changes: string[] }[]
  addedEdges: GraphEdgeSnapshot[]
  summary: string
}

/**
 * 获取当前 story 的完整图谱快照
 */
export async function buildGraphSnapshot(
  prisma: any,
  storyId: string
): Promise<GraphSnapshot> {
  const nodes = await prisma.graphNode.findMany({
    where: { storyId }
  })
  const edges = await prisma.graphEdge.findMany({
    where: { storyId },
    include: { fromNode: true, toNode: true }
  })

  return {
    nodes: nodes.map((n: any) => ({
      type: n.type,
      key: n.key,
      label: n.label,
      data: JSON.parse(n.data || '{}')
    })),
    edges: edges.map((e: any) => ({
      fromType: e.fromNode.type,
      fromKey: e.fromNode.key,
      toType: e.toNode.type,
      toKey: e.toNode.key,
      relation: e.relation,
      weight: e.weight
    })),
    timestamp: new Date().toISOString()
  }
}

/**
 * 计算当前图谱与上一快照的差异
 */
export function computeGraphDelta(
  current: GraphSnapshot,
  previous: GraphSnapshot | null
): GraphDelta {
  if (!previous) {
    return {
      addedNodes: current.nodes,
      updatedNodes: [],
      addedEdges: current.edges,
      summary: `初始归档：新增 ${current.nodes.length} 个节点，${current.edges.length} 条边`
    }
  }

  // 建立索引
  const prevNodeMap = new Map(previous.nodes.map(n => [`${n.type}:${n.key}`, n]))
  const prevEdgeMap = new Map(previous.edges.map(e =>
    [`${e.fromType}:${e.fromKey}-${e.relation}-${e.toType}:${e.toKey}`, e]
  ))
  const currNodeMap = new Map(current.nodes.map(n => [`${n.type}:${n.key}`, n]))
  const currEdgeMap = new Map(current.edges.map(e =>
    [`${e.fromType}:${e.fromKey}-${e.relation}-${e.toType}:${e.toKey}`, e]
  ))

  // 新增节点
  const addedNodes = current.nodes.filter(n => !prevNodeMap.has(`${n.type}:${n.key}`))

  // 更新节点（key 相同但 data 不同）
  const updatedNodes: { node: GraphNodeSnapshot; changes: string[] }[] = []
  for (const currNode of current.nodes) {
    const prevNode = prevNodeMap.get(`${currNode.type}:${currNode.key}`)
    if (prevNode) {
      const changes: string[] = []
      if (prevNode.label !== currNode.label) changes.push(`label: "${prevNode.label}" → "${currNode.label}"`)
      const prevKeys = Object.keys(prevNode.data)
      const currKeys = Object.keys(currNode.data)
      for (const k of currKeys) {
        if (JSON.stringify(prevNode.data[k]) !== JSON.stringify(currNode.data[k])) {
          changes.push(`${k}: ${JSON.stringify(prevNode.data[k])} → ${JSON.stringify(currNode.data[k])}`)
        }
      }
      for (const k of prevKeys) {
        if (!currKeys.includes(k)) changes.push(`移除 ${k}`)
      }
      if (changes.length > 0) {
        updatedNodes.push({ node: currNode, changes })
      }
    }
  }

  // 新增边
  const addedEdges = current.edges.filter(e =>
    !prevEdgeMap.has(`${e.fromType}:${e.fromKey}-${e.relation}-${e.toType}:${e.toKey}`)
  )

  const summaryParts: string[] = []
  if (addedNodes.length > 0) summaryParts.push(`新增 ${addedNodes.length} 个节点`)
  if (updatedNodes.length > 0) summaryParts.push(`更新 ${updatedNodes.length} 个节点`)
  if (addedEdges.length > 0) summaryParts.push(`新增 ${addedEdges.length} 条边`)
  const summary = summaryParts.length > 0 ? summaryParts.join('，') : '图谱无变化'

  return { addedNodes, updatedNodes, addedEdges, summary }
}

/**
 * 归档时计算并保存 graphSnapshot 和 graphDelta
 */
export async function saveGraphSnapshotAndDelta(
  app: FastifyInstance,
  chapterId: string,
  storyId: string
): Promise<{ snapshot: GraphSnapshot; delta: GraphDelta } | null> {
  const prisma = app.prisma

  try {
    // 1. 获取当前章节
    const chapter = await prisma.chapter.findUnique({ where: { id: chapterId } })
    if (!chapter) return null

    // 2. 构建当前图谱快照
    const currentSnapshot = await buildGraphSnapshot(prisma, storyId)

    // 3. 获取上一章节的快照（父章节优先，否则取最近归档的）
    let previousSnapshot: GraphSnapshot | null = null
    if (chapter.parentChapterId) {
      const parent = await prisma.chapter.findUnique({
        where: { id: chapter.parentChapterId },
        select: { graphSnapshot: true }
      })
      if (parent?.graphSnapshot) {
        previousSnapshot = JSON.parse(parent.graphSnapshot)
      }
    }
    // 如果父章节没有快照，尝试取最近归档的
    if (!previousSnapshot) {
      const lastArchived = await prisma.chapter.findFirst({
        where: { storyId, status: 'archived', id: { not: chapterId } },
        orderBy: { number: 'desc' },
        select: { graphSnapshot: true }
      })
      if (lastArchived?.graphSnapshot) {
        previousSnapshot = JSON.parse(lastArchived.graphSnapshot)
      }
    }

    // 4. 计算 Delta
    const delta = computeGraphDelta(currentSnapshot, previousSnapshot)

    // 5. 保存到章节
    await prisma.chapter.update({
      where: { id: chapterId },
      data: {
        graphSnapshot: JSON.stringify(currentSnapshot),
        graphDelta: JSON.stringify(delta)
      }
    })

    app.log.info(`[GraphSnapshot] Chapter ${chapterId}: ${delta.summary}`)

    return { snapshot: currentSnapshot, delta }
  } catch (err: any) {
    app.log.error(`[GraphSnapshot] Failed: ${err.message}`)
    return null
  }
}
