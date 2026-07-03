import { v2Api } from './index'

export interface GraphNodeData {
  type: 'character' | 'faction' | 'event' | 'item' | 'location' | 'other'
  key: string
  label: string
  importance?: number
  data?: Record<string, any>
}

export interface GraphEdgeData {
  fromKey: string
  toKey: string
  relation: string
}

export interface GraphData {
  nodes: GraphNodeData[]
  edges: GraphEdgeData[]
}

export const GRAPH_NODE_COLORS_V2: Record<string, string> = {
  character: '#e07b5a',
  faction:   '#5a8fd4',
  event:     '#4caf7d',
  item:      '#8d6e9e',
  location:  '#d4a843',
  other:     '#8899aa'
}

export const GRAPH_NODE_LABELS: Record<string, string> = {
  character: '角色',
  faction: '势力',
  event: '事件',
  item: '物品',
  location: '地点',
  other: '其他'
}

export const v2GraphApi = {
  /** 获取故事最新合并图谱 */
  get: (storyId: string) =>
    v2Api.get<GraphData & { sourceChapterNumber: number | null }>('/graph', { storyId }),

  /** 获取指定章节的图谱（chapterGraph + mergedGraph） */
  getByChapter: (chapterId: string) =>
    v2Api.get<{ chapterNumber: number; chapterGraph: GraphData; mergedGraph: GraphData }>(
      `/graph/${chapterId}`
    ),

  /** AI 从正文提取本章图谱 */
  extract: (storyId: string, content: string) =>
    v2Api.post<GraphData>('/graph/extract', { storyId, content }),

  /** AI 合并本章图谱与总图谱 */
  merge: (storyId: string, chapterGraph: GraphData, previousMergedGraph?: GraphData | null) =>
    v2Api.post<GraphData>('/graph/merge', { storyId, chapterGraph, previousMergedGraph }),

  /** 保存编辑后的图谱到章节 */
  save: (chapterId: string, chapterGraph?: GraphData | null, mergedGraph?: GraphData | null) =>
    v2Api.put<void>(`/graph/${chapterId}`, { chapterGraph, mergedGraph })
}
