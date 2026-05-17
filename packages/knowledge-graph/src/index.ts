import GraphConstructor from 'graphology'

const Graph = GraphConstructor as any

export class GraphService {
  private graph: any
  constructor() { this.graph = new Graph() }

  addNode(id: string, type: string, label: string, data?: any) {
    if (!this.graph.hasNode(id)) {
      this.graph.addNode(id, { type, label, ...data })
    }
  }

  addEdge(from: string, to: string, relation: string, weight = 1) {
    const edgeId = `${from}->${to}`
    if (!this.graph.hasEdge(edgeId)) {
      this.graph.addEdgeWithKey(edgeId, from, to, { relation, weight })
    }
  }

  getNeighbors(nodeId: string) {
    if (!this.graph.hasNode(nodeId)) return []
    return this.graph.neighbors(nodeId).map((n: string) => ({
      id: n,
      ...this.graph.getNodeAttributes(n)
    }))
  }

  getEdges(nodeId: string) {
    if (!this.graph.hasNode(nodeId)) return []
    const edges: any[] = []
    this.graph.forEachEdge((edge: string, attr: any, source: string, target: string) => {
      if (source === nodeId || target === nodeId) edges.push({ source, target, ...attr })
    })
    return edges
  }

  export() {
    const nodes: any[] = []
    const edges: any[] = []
    this.graph.forEachNode((id: string, attr: any) => nodes.push({ id, ...attr }))
    this.graph.forEachEdge((_edge: string, attr: any, source: string, target: string) => {
      edges.push({ source, target, ...attr })
    })
    return { nodes, edges }
  }

  import(data: { nodes: any[], edges: any[] }) {
    this.graph.clear()
    data.nodes.forEach(n => this.addNode(n.id, n.type, n.label, n))
    data.edges.forEach(e => this.addEdge(e.source, e.target, e.relation, e.weight))
  }
}
