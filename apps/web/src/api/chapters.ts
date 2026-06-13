import { api } from '../utils/api'

export interface ChapterCreate {
  title: string
  outline?: string
  isSideStory?: boolean
  number?: number
}

export interface ChapterUpdate {
  title?: string
  outline?: string
  content?: string
  status?: string
  sceneLocation?: string
  sceneMood?: string
  sceneGoal?: string
  aiProviderConfigId?: string | null
}

export const chaptersApi = {
  list: (storyId: string) => api.get(`/api/stories/${storyId}/chapters`),
  get: (chapterId: string) => api.get(`/api/chapters/${chapterId}`),
  create: (storyId: string, data: ChapterCreate) => api.post(`/api/stories/${storyId}/chapters`, data),
  update: (chapterId: string, data: ChapterUpdate) => api.put(`/api/chapters/${chapterId}`, data),
  remove: (chapterId: string) => api.delete(`/api/chapters/${chapterId}`),
  preview: (chapterId: string, data: any) => api.post(`/api/chapters/${chapterId}/preview`, data),
  generate: (chapterId: string, data: any) => api.post(`/api/chapters/${chapterId}/generate`, data, { timeout: 0 }),
  selectDraft: (chapterId: string, draftId: string) => api.post(`/api/chapters/${chapterId}/select`, { draftId }),
  archive: (chapterId: string) => api.post(`/api/chapters/${chapterId}/archive`, {}, { timeout: 0 }),
  develop: (chapterId: string, data: any) => api.post(`/api/chapters/${chapterId}/develop`, data),
  getTree: (storyId: string) => api.get(`/api/stories/${storyId}/chapter-tree`)
}

export const draftsApi = {
  list: (chapterId: string) => api.get(`/api/chapters/${chapterId}/drafts`),
  get: (draftId: string) => api.get(`/api/drafts/${draftId}`),
  score: (draftId: string) => api.post(`/api/drafts/${draftId}/score`),
  update: (draftId: string, data: { content: string }) => api.put(`/api/drafts/${draftId}`, data),
  remove: (draftId: string) => api.delete(`/api/drafts/${draftId}`)
}
