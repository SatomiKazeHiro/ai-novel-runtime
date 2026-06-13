import type { FastifyInstance } from 'fastify'

export interface GraphNodeSnapshot {
  type: string
  key: string
  label: string
  data: Record<string, any>
}

export interface GraphEdgeSnapshot {
  fromType: string
  fromKey: string
  toType: string
  toKey: string
  relation: string
  weight: number
}

export interface GraphSnapshot {
  nodes: GraphNodeSnapshot[]
  edges: GraphEdgeSnapshot[]
  timestamp: string
}

/**
 * 保存 graphSnapshot 和 graphDelta
 * graphSnapshot = B+ (AI 合并后的全局大图)
 * graphDelta = A (AI 整理后的本章范围图谱)
 */
export async function saveGraphSnapshotAndDelta(
  prisma: any,
  chapterId: string,
  storyId: string,
  graphResult: { mergedGraph: GraphSnapshot; chapterGraph: GraphSnapshot }
): Promise<{ snapshot: GraphSnapshot; delta: GraphSnapshot } | null> {
  try {
    // 1. 清空当前工作表
    await prisma.graphEdge.deleteMany({ where: { storyId } })
    await prisma.graphNode.deleteMany({ where: { storyId } })

    // 2. 从 mergedGraph 重建工作表
    const nodeIdMap = new Map<string, string>() // type:key -> id
    for (const node of graphResult.mergedGraph.nodes) {
      const created = await prisma.graphNode.create({
        data: {
          storyId,
          type: node.type,
          key: node.key,
          label: node.label,
          data: JSON.stringify(node.data || {})
        }
      })
      nodeIdMap.set(`${node.type}:${node.key}`, created.id)
    }

    // 创建关系边，同时做去重兜底（防止 AI 返回的 mergedGraph 中有完全重复的边）
    const seenEdges = new Set<string>()
    for (const edge of graphResult.mergedGraph.edges) {
      const fromId = nodeIdMap.get(`${edge.fromType}:${edge.fromKey}`)
      const toId = nodeIdMap.get(`${edge.toType}:${edge.toKey}`)
      if (!fromId || !toId) continue

      const edgeKey = `${fromId}:${toId}:${edge.relation}`
      if (seenEdges.has(edgeKey)) continue
      seenEdges.add(edgeKey)

      await prisma.graphEdge.create({
        data: {
          storyId,
          fromId,
          toId,
          relation: edge.relation,
          weight: edge.weight || 1
        }
      })
    }

    // 3. 保存到章节
    await prisma.chapter.update({
      where: { id: chapterId },
      data: {
        graphSnapshot: JSON.stringify(graphResult.mergedGraph),
        graphDelta: JSON.stringify(graphResult.chapterGraph)
      }
    })

    return { snapshot: graphResult.mergedGraph, delta: graphResult.chapterGraph }
  } catch (err: any) {
    console.error(`[GraphSnapshot] Failed: ${err.message}`)
    return null
  }
}

/**
 * 从 snapshot 重建 GraphNode/GraphEdge（删除章节后回退用）
 */
export async function rebuildGraphFromSnapshot(
  prisma: any,
  storyId: string,
  snapshot: GraphSnapshot
) {
  // 1. 清空
  await prisma.graphEdge.deleteMany({ where: { storyId } })
  await prisma.graphNode.deleteMany({ where: { storyId } })

  // 2. 重建
  const nodeIdMap = new Map<string, string>()
  for (const node of snapshot.nodes) {
    const created = await prisma.graphNode.create({
      data: {
        storyId,
        type: node.type,
        key: node.key,
        label: node.label,
        data: JSON.stringify(node.data || {})
      }
    })
    nodeIdMap.set(`${node.type}:${node.key}`, created.id)
  }

  for (const edge of snapshot.edges) {
    const fromId = nodeIdMap.get(`${edge.fromType}:${edge.fromKey}`)
    const toId = nodeIdMap.get(`${edge.toType}:${edge.toKey}`)
    if (fromId && toId) {
      await prisma.graphEdge.create({
        data: {
          storyId,
          fromId,
          toId,
          relation: edge.relation,
          weight: edge.weight || 1
        }
      })
    }
  }
}
