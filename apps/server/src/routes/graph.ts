import type { FastifyInstance } from 'fastify'
import { GraphService } from '@novel-runtime/knowledge-graph'

export async function graphRoutes(app: FastifyInstance) {
  // GET /api/stories/:storyId/graph
  // 返回最新归档章节的 graphSnapshot（B+ 全局大图）
  app.get('/api/stories/:storyId/graph', async (request, reply) => {
    const { storyId } = request.params as any
    const lastArchived = await app.prisma.chapter.findFirst({
      where: { storyId, status: 'archived' },
      orderBy: { number: 'desc' },
      select: { graphSnapshot: true }
    })
    if (!lastArchived || !lastArchived.graphSnapshot) {
      return { success: true, data: { nodes: [], edges: [] } }
    }
    const snapshot = JSON.parse(lastArchived.graphSnapshot)
    const gs = new GraphService()
    gs.import({
      nodes: (snapshot.nodes || []).map((n: any) => ({ id: `${n.type}:${n.key}`, type: n.type, key: n.key, label: n.label, ...n.data })),
      edges: (snapshot.edges || []).map((e: any) => ({ source: `${e.fromType}:${e.fromKey}`, target: `${e.toType}:${e.toKey}`, relation: e.relation, weight: e.weight }))
    })
    return { success: true, data: gs.export() }
  })

  // GET /api/chapters/:chapterId/graph-snapshot
  app.get('/api/chapters/:chapterId/graph-snapshot', async (request, reply) => {
    const { chapterId } = request.params as any
    const chapter = await app.prisma.chapter.findUnique({
      where: { id: chapterId },
      select: { graphSnapshot: true, graphDelta: true, title: true, number: true, status: true }
    })
    if (!chapter) return reply.status(404).send({ success: false, error: 'Chapter not found' })
    let snapshot = null
    let delta = null
    try { if (chapter.graphSnapshot) snapshot = JSON.parse(chapter.graphSnapshot) } catch {}
    try { if (chapter.graphDelta) delta = JSON.parse(chapter.graphDelta) } catch {}
    return { success: true, data: { chapter: { title: chapter.title, number: chapter.number, status: chapter.status }, snapshot, delta } }
  })

  // POST /api/stories/:storyId/graph/nodes
  // 手动添加节点：写入工作表 + 同步更新最新归档章节的 snapshot
  app.post('/api/stories/:storyId/graph/nodes', async (request, reply) => {
    const { storyId } = request.params as any
    const body = request.body as any
    const node = await app.prisma.graphNode.create({
      data: {
        storyId,
        type: body.type,
        key: body.key,
        label: body.label,
        data: JSON.stringify(body.data || {})
      }
    })

    // 同步更新最新归档章节的 snapshot
    const lastArchived = await app.prisma.chapter.findFirst({
      where: { storyId, status: 'archived' },
      orderBy: { number: 'desc' }
    })
    if (lastArchived?.graphSnapshot) {
      const snapshot = JSON.parse(lastArchived.graphSnapshot)
      const exists = snapshot.nodes.some((n: any) => n.type === body.type && n.key === body.key)
      if (!exists) {
        snapshot.nodes.push({ type: body.type, key: body.key, label: body.label, data: body.data || {} })
        await app.prisma.chapter.update({
          where: { id: lastArchived.id },
          data: { graphSnapshot: JSON.stringify(snapshot) }
        })
      }
    }

    return { success: true, data: node }
  })

  // POST /api/stories/:storyId/graph/edges
  // 手动添加边：写入工作表 + 同步更新最新归档章节的 snapshot
  app.post('/api/stories/:storyId/graph/edges', async (request, reply) => {
    const { storyId } = request.params as any
    const body = request.body as any
    const edge = await app.prisma.graphEdge.create({
      data: {
        storyId,
        fromId: body.fromId,
        toId: body.toId,
        relation: body.relation,
        weight: body.weight || 1
      }
    })

    // 同步更新最新归档章节的 snapshot
    const lastArchived = await app.prisma.chapter.findFirst({
      where: { storyId, status: 'archived' },
      orderBy: { number: 'desc' }
    })
    if (lastArchived?.graphSnapshot) {
      const snapshot = JSON.parse(lastArchived.graphSnapshot)
      const fromNode = await app.prisma.graphNode.findUnique({ where: { id: body.fromId } })
      const toNode = await app.prisma.graphNode.findUnique({ where: { id: body.toId } })
      if (fromNode && toNode) {
        const exists = snapshot.edges.some((e: any) =>
          e.fromType === fromNode.type && e.fromKey === fromNode.key &&
          e.toType === toNode.type && e.toKey === toNode.key &&
          e.relation === body.relation
        )
        if (!exists) {
          snapshot.edges.push({
            fromType: fromNode.type, fromKey: fromNode.key,
            toType: toNode.type, toKey: toNode.key,
            relation: body.relation, weight: body.weight || 1
          })
          await app.prisma.chapter.update({
            where: { id: lastArchived.id },
            data: { graphSnapshot: JSON.stringify(snapshot) }
          })
        }
      }
    }

    return { success: true, data: edge }
  })
}
