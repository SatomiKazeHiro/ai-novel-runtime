import { v2Api } from './index'

export interface V2CharacterCreate {
  storyId: string
  slug: string
  name: string
  isProtagonist?: boolean
  identity?: string[]
  appearance?: string[]
  temperament?: string[]
  personality?: string[]
  speechStyle?: string[]
}

export interface V2CharacterUpdate {
  name?: string
  isProtagonist?: boolean
  identity?: string[]
  appearance?: string[]
  temperament?: string[]
  personality?: string[]
  speechStyle?: string[]
}

export const v2CharactersApi = {
  list: (storyId: string) => v2Api.get<any[]>('/characters', { storyId }),
  detail: (charId: string) => v2Api.get<any>(`/characters/${charId}`),
  create: (data: V2CharacterCreate) => v2Api.post<any>('/characters', data),
  update: (charId: string, data: V2CharacterUpdate) => v2Api.put<any>(`/characters/${charId}`, data),
  remove: (charId: string) => v2Api.delete(`/characters/${charId}`)
}
