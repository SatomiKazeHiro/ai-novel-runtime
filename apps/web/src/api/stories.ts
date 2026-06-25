import { api } from '../utils/api'

export interface StoryCreate {
  title: string
  description?: string
  runtimeProfileId?: string | null
  aiProviderConfigId?: string | null
}

export interface StoryUpdate {
  title?: string
  description?: string
  status?: string
  runtimeProfileId?: string | null
  aiProviderConfigId?: string | null
}

export interface Story {
  id: string
  title: string
  description: string | null
  status: string
  coverUrl?: string | null
  [key: string]: any
}

export const storiesApi = {
  list: () => api.get<{ success: true; data: Story[] }>('/api/stories'),
  get: (id: string) => api.get<{ success: true; data: Story }>(`/api/stories/${id}`),
  create: (data: StoryCreate) => api.post<{ success: true; data: Story }>('/api/stories', data),
  update: (id: string, data: StoryUpdate | FormData) =>
    api.put<{ success: true; data: Story }>(`/api/stories/${id}`, data),
  remove: (id: string) => api.delete<{ success: true }>(`/api/stories/${id}`),
  removeCover: (id: string) => api.delete<{ success: true }>(`/api/stories/${id}/cover`)
}
