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
  outline?: string
}

export interface V2GenerateConfig {
  providerConfigId?: string
  temperature?: number
  maxTokens?: number
  characterIds?: string[]
  memoryTypeIds?: { type: string; category: string; id: string }[]
  plotArcIds?: string[]
  loreIds?: string[]
  outline?: string
  _useBodyConfig?: boolean
}

export const v2ChaptersApi = {
  list: (storyId: string) => v2Api.get<any[]>('/chapters', { storyId }),
  detail: (chapterId: string) => v2Api.get<any>(`/chapters/${chapterId}`),
  create: (data: V2ChapterCreate) => v2Api.post<any>('/chapters', data),
  update: (chapterId: string, data: V2ChapterUpdate) => v2Api.put<any>(`/chapters/${chapterId}`, data),
  remove: (chapterId: string) => v2Api.delete(`/chapters/${chapterId}`),
  generateConfig: (chapterId: string) => v2Api.post<any>(`/chapters/${chapterId}/config`),
  /** 组装 prompt 预览（不调用 AI） */
  preview: (chapterId: string, config: V2GenerateConfig) =>
    v2Api.post<any>(`/chapters/${chapterId}/preview`, config),
  /** 语义搜索记忆 — "系统分配"按钮，query 为大纲文本 */
  memorySearch: (chapterId: string, query: string) =>
    v2Api.post<any>(`/chapters/${chapterId}/memory-search`, { query }),
  listDrafts: (chapterId: string) => v2Api.get<any[]>(`/chapters/${chapterId}/drafts`),
  deleteDraft: (draftId: string) => v2Api.delete(`/drafts/${draftId}`),
  providerConfigs: () => v2Api.get<any[]>('/provider-configs'),
  // 返回原生 fetch Response，用于 SSE 流式读取
  generateStream: (chapterId: string, config: V2GenerateConfig = {}, signal?: AbortSignal): Promise<Response> =>
    fetch(`/api/v2/chapters/${chapterId}/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(config),
      signal
    }),
  // 分析 — 使用 fetch 避免 axios 30s 超时（5 个 AI 调用并行，耗时较长）
  getAnalysis: (chapterId: string) => v2Api.get<any>(`/chapters/${chapterId}/analysis`),
  analyze: (chapterId: string) =>
    fetch(`/api/v2/chapters/${chapterId}/analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}'
    }).then(r => r.json()),
  analyzeSingle: (chapterId: string, key: string) =>
    fetch(`/api/v2/chapters/${chapterId}/analyze/${key}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}'
    }).then(r => r.json()),
  revertAnalysis: (chapterId: string) => v2Api.post<any>(`/chapters/${chapterId}/revert-analysis`),
  savePendingAnalysis: (chapterId: string, data: any) => v2Api.put<any>(`/chapters/${chapterId}/pending-analysis`, data),
  // 归档
  preArchive: (chapterId: string) => v2Api.get<any>(`/chapters/${chapterId}/pre-archive`),
  archive: (chapterId: string) => v2Api.post<any>(`/chapters/${chapterId}/archive`)
}
