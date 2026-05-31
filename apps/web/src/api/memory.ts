import { api } from '../utils/api'

export const memoryApi = {
  list: (storyId: string, layer?: string) => api.get(`/api/stories/${storyId}/memory`, { params: { layer } }),
  create: (storyId: string, data: any) => api.post(`/api/stories/${storyId}/memory`, data)
}
