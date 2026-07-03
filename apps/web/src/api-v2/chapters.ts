import { v2Api } from './index'

// 分析端 5 路 AI 并发（max-of ≈ 120s）；前端裸 fetch 兜一个总超时防止长时间无响应
const ANALYZE_TIMEOUT_MS = 180_000

/**
 * 分析专用 fetch：180s 总超时；AbortError 转成与后端 {success,error} 同构的失败 payload，
 * 调用方不需要额外 try/catch，与现有 analyze/analyzeSingle 行为一致。
 */
async function analyzeFetch(url: string): Promise<{ success: boolean; data?: any; error?: string }> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), ANALYZE_TIMEOUT_MS)
  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
      signal: controller.signal
    })
    return await r.json()
  } catch (err: any) {
    if (err?.name === 'AbortError') {
      return { success: false, error: `分析超时（${ANALYZE_TIMEOUT_MS / 1000}s），建议关闭后重试，或单路重抽失败项` }
    }
    return { success: false, error: err?.message || '请求失败' }
  } finally {
    clearTimeout(timer)
  }
}

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
  analyze: (chapterId: string) => analyzeFetch(`/api/v2/chapters/${chapterId}/analyze`),
  analyzeSingle: (chapterId: string, key: string) =>
    analyzeFetch(`/api/v2/chapters/${chapterId}/analyze/${key}`),
  revertAnalysis: (chapterId: string) => v2Api.post<any>(`/chapters/${chapterId}/revert-analysis`),
  savePendingAnalysis: (chapterId: string, data: any) => v2Api.put<any>(`/chapters/${chapterId}/pending-analysis`, data),
  // 归档
  preArchive: (chapterId: string) => v2Api.get<any>(`/chapters/${chapterId}/pre-archive`),
  archive: (chapterId: string) => v2Api.post<any>(`/chapters/${chapterId}/archive`)
}
