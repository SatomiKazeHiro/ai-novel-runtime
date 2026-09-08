import { api } from '../utils/api'

export interface CharacterCreate {
  slug: string
  name: string
  protagonist?: boolean
  personality?: string[]
  speechStyle?: string[]
  identity?: string[]
  appearance?: string[]
  temperament?: string[]
  relationships?: Record<string, any>
  status?: Record<string, any>
}

export interface CharacterUpdate {
  name?: string
  protagonist?: boolean
  personality?: string[]
  speechStyle?: string[]
  identity?: string[]
  appearance?: string[]
  temperament?: string[]
  relationships?: Record<string, any>
  status?: Record<string, any>
}

export interface FieldDisplay<T> {
  value: T
  sourceChapterNumber: number | null
}

export interface CharacterDisplayRow {
  id: string
  name: string
  slug: string
  protagonist: boolean
  identity: string[]
  appearance: string[]
  temperament: string[]
  personality: string[]
  speechStyle: string[]
  relationships: FieldDisplay<Record<string, any>> | null
  status: FieldDisplay<Record<string, any>> | null
  costume: FieldDisplay<string> | null
}

export const charactersApi = {
  list: (storyId: string) => api.get(`/api/stories/${storyId}/characters`),
  create: (storyId: string, data: CharacterCreate) => api.post(`/api/stories/${storyId}/characters`, data),
  update: (charId: string, data: CharacterUpdate) => api.put(`/api/characters/${charId}`, data),
  remove: (charId: string) => api.delete(`/api/characters/${charId}`),
  display: (storyId: string, chapter: number | null) =>
    api.get(`/api/stories/${storyId}/characters/display`, { params: { chapter } })
}
