import { api } from '../utils/api'

export interface LoreCreate {
  category: string
  slug: string
  name: string
  content: string
  metadata?: Record<string, any>
}

export interface LoreUpdate {
  name?: string
  content?: string
  metadata?: Record<string, any>
}

export const loreApi = {
  list: (storyId: string, category?: string) => api.get(`/api/stories/${storyId}/lore`, { params: { category } }),
  create: (storyId: string, data: LoreCreate) => api.post(`/api/stories/${storyId}/lore`, data),
  update: (itemId: string, data: LoreUpdate) => api.put(`/api/lore/${itemId}`, data),
  remove: (itemId: string) => api.delete(`/api/lore/${itemId}`)
}
