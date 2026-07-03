// V2 图谱共享类型

export interface GraphNodeData {
  type: 'character' | 'faction' | 'event' | 'item' | 'location' | 'other'
  key: string   // 唯一标识（如 "zhangwuji"，英文小写）
  label: string  // 显示名称（如 "张无忌"）
  importance?: number  // 1-10
  data?: Record<string, any>
}

export interface GraphEdgeData {
  fromKey: string
  toKey: string
  relation: string  // 2-8 个中文字符
}

export interface GraphData {
  nodes: GraphNodeData[]
  edges: GraphEdgeData[]
}

/** 标准节点类型色板 */
export const GRAPH_NODE_COLORS: Record<string, string> = {
  character: '#e07b5a',
  faction:   '#5a8fd4',
  event:     '#4caf7d',
  item:      '#8d6e9e',
  location:  '#d4a843',
  other:     '#8899aa'
}
