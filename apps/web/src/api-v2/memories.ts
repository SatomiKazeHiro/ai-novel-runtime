import { v2Api } from './index'

export interface V2MemoryQuery {
  storyId: string
  type?: string
  category?: string
  isActive?: boolean
}

export interface V2TemporaryMemoryCreate {
  storyId: string
  category: string
  content: string
  importance?: number
  participants?: string
}

export interface V2TemporaryMemoryUpdate {
  category?: string
  content?: string
  importance?: number
  participants?: string
}

export const v2MemoriesApi = {
  list: (query: V2MemoryQuery) => {
    const params: any = { storyId: query.storyId }
    if (query.type) params.type = query.type
    if (query.category) params.category = query.category
    if (query.isActive !== undefined) params.isActive = query.isActive
    return v2Api.get<any[]>('/memories', params)
  },
  createTemporary: (data: V2TemporaryMemoryCreate) =>
    v2Api.post<any>('/memories/temporary', data),
  updateTemporary: (memId: string, data: V2TemporaryMemoryUpdate) =>
    v2Api.put<any>(`/memories/temporary/${memId}`, data),
  removeTemporary: (memId: string) =>
    v2Api.delete(`/memories/temporary/${memId}`)
}
