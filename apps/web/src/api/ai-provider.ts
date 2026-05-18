import { api } from '../utils/api'

export interface AiProviderCreate {
  name: string
  apiKey?: string
  baseUrl?: string
  model: string
  contextLength?: number
  maxTokens?: number
  temperature?: number
  isDefault?: boolean
}

export interface AiProviderUpdate {
  name?: string
  apiKey?: string
  baseUrl?: string
  model?: string
  contextLength?: number
  maxTokens?: number
  temperature?: number
  isDefault?: boolean
}

export const aiProviderApi = {
  list: () => api.get('/api/ai-providers'),
  create: (data: AiProviderCreate) => api.post('/api/ai-providers', data),
  update: (id: string, data: AiProviderUpdate) => api.put(`/api/ai-providers/${id}`, data),
  remove: (id: string) => api.delete(`/api/ai-providers/${id}`),
  setDefault: (id: string) => api.post(`/api/ai-providers/${id}/default`)
}
