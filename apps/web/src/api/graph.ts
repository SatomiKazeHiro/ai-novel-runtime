import { api } from '../utils/api'

export const graphApi = {
  get: (storyId: string) => api.get(`/api/stories/${storyId}/graph`),
  createNode: (storyId: string, data: any) => api.post(`/api/stories/${storyId}/graph/nodes`, data),
  createEdge: (storyId: string, data: any) => api.post(`/api/stories/${storyId}/graph/edges`, data),
  getSnapshot: (chapterId: string) => api.get(`/api/chapters/${chapterId}/graph-snapshot`)
}
