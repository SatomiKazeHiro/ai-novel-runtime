import { api } from '../utils/api'

export interface GraphSnapshot {
  nodes: Array<{ type: string; key: string; label: string; data?: any; [k: string]: any }>
  edges: Array<{ fromType: string; fromKey: string; toType: string; toKey: string; relation: string; weight?: number; [k: string]: any }>
  timestamp?: string
}

// get: 知识图谱页面调用, 读 archived 章节的 Chapter 三列 (chapterGraph / cumulativeGraph / cumulativeGraphGeneratedAt)。
// build: ReviewingPanel 调用, AI 生成累计图谱, 后端写入 pendingArchiveData。
// 注意: PATCH save 端点已删除 — 累计图谱编辑后保存走 chaptersApi.update({ pendingArchiveData }) 通路。
export const cumulativeGraphApi = {
  get:   (chapterId: string) =>
           api.get(`/api/chapters/${chapterId}/cumulative-graph`),
  build: (chapterId: string, chapterGraph: GraphSnapshot) =>
           api.post(`/api/chapters/${chapterId}/cumulative-graph/build`, { chapterGraph }, { timeout: 0 }),
}
