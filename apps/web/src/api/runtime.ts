import { api } from '../utils/api'

export interface RuntimeProfileCreate {
  storyId?: string | null
  name: string
  identity: string
  settings?: { language?: string; uncensored?: boolean; repeat?: boolean; speciality?: string }
  behavior: string
  jailbreak?: string
  isDefault?: boolean
}

export interface RuntimeProfileUpdate {
  name?: string
  identity?: string
  settings?: { language?: string; uncensored?: boolean; repeat?: boolean; speciality?: string }
  behavior?: string
  jailbreak?: string
  isDefault?: boolean
}

export const runtimeApi = {
  list: (storyId?: string) => api.get('/api/runtime-profiles', { params: { storyId } }),
  get: (id: string) => api.get(`/api/runtime-profiles/${id}`),
  create: (data: RuntimeProfileCreate) => api.post('/api/runtime-profiles', data),
  update: (id: string, data: RuntimeProfileUpdate) => api.put(`/api/runtime-profiles/${id}`, data),
  remove: (id: string) => api.delete(`/api/runtime-profiles/${id}`)
}
