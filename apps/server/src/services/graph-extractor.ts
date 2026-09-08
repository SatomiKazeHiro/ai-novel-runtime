/**
 * GraphExtractionResult — v3 active path 用的纯数据结构。
 * 由 `combined-extractor.ts` 从 AI 响应解析得到，外部写入由调用方决定。
 */

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
