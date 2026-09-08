import { api } from '../utils/api'

export interface GraphSnapshot {
  nodes: Array<{ type: string; key: string; label: string; data?: any; [k: string]: any }>
  edges: Array<{ fromType: string; fromKey: string; toType: string; toKey: string; relation: string; weight?: number; [k: string]: any }>
  timestamp?: string
}

export const cumulativeGraphApi = {
  get:   (chapterId: string) =>
           api.get(`/api/chapters/${chapterId}/cumulative-graph`),
  build: (chapterId: string, chapterGraph: GraphSnapshot) =>
           api.post(`/api/chapters/${chapterId}/cumulative-graph/build`, { chapterGraph }, { timeout: 0 }),
  save:  (chapterId: string, graph: GraphSnapshot) =>
           api.patch(`/api/chapters/${chapterId}/cumulative-graph`, { graph }),
}
