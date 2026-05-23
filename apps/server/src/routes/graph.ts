import type { FastifyInstance } from 'fastify'
import { GraphService } from '@novel-runtime/knowledge-graph'

export async function graphRoutes(app: FastifyInstance) {
  // GET /api/stories/:storyId/graph
  app.get('/api/stories/:storyId/graph', async (request, reply) => {
    const { storyId } = request.params as any
    const nodes = await app.prisma.graphNode.findMany({ where: { storyId } })
    const edges = await app.prisma.graphEdge.findMany({ where: { storyId } })
    const gs = new GraphService()
    gs.import({ nodes: nodes.map(n => ({ id: n.id, type: n.type, key: n.key, label: n.label, ...JSON.parse(n.data) })), edges: edges.map(e => ({ source: e.fromId, target: e.toId, relation: e.relation, weight: e.weight })) })
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
    return { success: true, data: node }
  })

  // POST /api/stories/:storyId/graph/edges
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
    return { success: true, data: edge }
  })
}
