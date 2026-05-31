import { api } from '../utils/api'

export interface CharacterCreate {
  slug: string
  name: string
  personality?: string[]
  speechStyle?: string[]
  identity?: string[]
  appearance?: string[]
  temperament?: string[]
  relationships?: Record<string, any>
  status?: Record<string, any>
  versionBranchId?: string
}

export interface CharacterUpdate {
  name?: string
  personality?: string[]
  speechStyle?: string[]
  identity?: string[]
  appearance?: string[]
  temperament?: string[]
  relationships?: Record<string, any>
  status?: Record<string, any>
  versionBranchId?: string
}

export const charactersApi = {
  list: (storyId: string) => api.get(`/api/stories/${storyId}/characters`),
  create: (storyId: string, data: CharacterCreate) => api.post(`/api/stories/${storyId}/characters`, data),
  update: (charId: string, data: CharacterUpdate) => api.put(`/api/characters/${charId}`, data),
  remove: (charId: string) => api.delete(`/api/characters/${charId}`)
}
