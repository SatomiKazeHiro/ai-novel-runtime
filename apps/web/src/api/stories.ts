import { api } from '../utils/api'

export interface StoryCreate {
  title: string
  description?: string
  runtimeProfileId?: string | null
}

export interface StoryUpdate {
  title?: string
  description?: string
  status?: string
  runtimeProfileId?: string | null
}

export const storiesApi = {
  list: () => api.get('/api/stories'),
  get: (id: string) => api.get(`/api/stories/${id}`),
  create: (data: StoryCreate) => api.post('/api/stories', data),
  update: (id: string, data: StoryUpdate) => api.put(`/api/stories/${id}`, data),
  remove: (id: string) => api.delete(`/api/stories/${id}`)
}
