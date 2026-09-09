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
