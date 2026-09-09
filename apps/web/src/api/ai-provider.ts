import { api } from '../utils/api'

// 三态 thinking 配置：auto 跟模型名启发式决定；enabled/disabled 显式覆盖。
// 与 DeepSeek /v1/chat/completions 的 `thinking.type` 字段对应。
export type ThinkingMode = 'auto' | 'enabled' | 'disabled'

export interface AiProviderCreate {
  name: string
  apiKey?: string
  baseUrl?: string
  model: string
  contextLength?: number
  maxTokens?: number
  temperature?: number
  thinking?: ThinkingMode
  isDefault?: boolean
  remarks?: string
}

export interface AiProviderUpdate {
  name?: string
  apiKey?: string
  baseUrl?: string
  model?: string
  contextLength?: number
  maxTokens?: number
  temperature?: number
  thinking?: ThinkingMode
  isDefault?: boolean
  remarks?: string
}

export interface AiProviderTest {
  name: string
  apiKey?: string
  baseUrl?: string
  model: string
  thinking?: ThinkingMode
  id?: string
}

export const aiProviderApi = {
  list: () => api.get('/api/ai-providers'),
  getDefault: () => api.get('/api/ai-providers/default'),
  create: (data: AiProviderCreate) => api.post('/api/ai-providers', data),
  update: (id: string, data: AiProviderUpdate) => api.put(`/api/ai-providers/${id}`, data),
  remove: (id: string) => api.delete(`/api/ai-providers/${id}`),
  setDefault: (id: string) => api.post(`/api/ai-providers/${id}/default`),
  test: (data: AiProviderTest) => api.post('/api/ai-providers/test', data)
}
