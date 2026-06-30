import { v2Api } from './index'

export interface V2ChapterCreate {
  storyId: string
  title: string
  number?: number
  content?: string
}

export interface V2ChapterUpdate {
  title?: string
  content?: string
  config?: any
}

export const v2ChaptersApi = {
  list: (storyId: string) => v2Api.get<any[]>('/chapters', { storyId }),
  detail: (chapterId: string) => v2Api.get<any>(`/chapters/${chapterId}`),
  create: (data: V2ChapterCreate) => v2Api.post<any>('/chapters', data),
  update: (chapterId: string, data: V2ChapterUpdate) => v2Api.put<any>(`/chapters/${chapterId}`, data),
  remove: (chapterId: string) => v2Api.delete(`/chapters/${chapterId}`),
  generateConfig: (chapterId: string) => v2Api.post<any>(`/chapters/${chapterId}/config`),
  listDrafts: (chapterId: string) => v2Api.get<any[]>(`/chapters/${chapterId}/drafts`),
  deleteDraft: (draftId: string) => v2Api.delete(`/drafts/${draftId}`),
  // 返回原生 fetch Response，用于 SSE 流式读取
  generateStream: (chapterId: string, signal?: AbortSignal): Promise<Response> =>
    fetch(`/api/v2/chapters/${chapterId}/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal
    }),
  // 分析
  getAnalysis: (chapterId: string) => v2Api.get<any>(`/chapters/${chapterId}/analysis`),
  analyzeCharacters: (chapterId: string) => v2Api.post<any>(`/chapters/${chapterId}/analyze/characters`),
  analyzeMemories: (chapterId: string) => v2Api.post<any>(`/chapters/${chapterId}/analyze/memories`),
  analyzePlotArcs: (chapterId: string) => v2Api.post<any>(`/chapters/${chapterId}/analyze/plot-arcs`),
  analyzeTimeline: (chapterId: string) => v2Api.post<any>(`/chapters/${chapterId}/analyze/timeline`),
  analyzeGraph: (chapterId: string) => v2Api.post<any>(`/chapters/${chapterId}/analyze/graph`),
  saveAnalysis: (chapterId: string) => v2Api.post<any>(`/chapters/${chapterId}/save-analysis`),
  // 归档
  preArchive: (chapterId: string) => v2Api.get<any>(`/chapters/${chapterId}/pre-archive`),
  archive: (chapterId: string) => v2Api.post<any>(`/chapters/${chapterId}/archive`)
}
