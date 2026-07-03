import { v2Api } from './index'

export interface V2LoreCreate {
  storyId: string
  category: string
  slug: string
  name: string
  content?: string
}

export interface V2LoreUpdate {
  category?: string
  slug?: string
  name?: string
  content?: string
}

export const v2LoreApi = {
  list: (storyId: string) => v2Api.get<any[]>('/lore', { storyId }),
  create: (data: V2LoreCreate) => v2Api.post<any>('/lore', data),
  update: (loreId: string, data: V2LoreUpdate) => v2Api.put<any>(`/lore/${loreId}`, data),
  remove: (loreId: string) => v2Api.delete(`/lore/${loreId}`)
}
