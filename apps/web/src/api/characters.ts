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
  baseRelationships: Record<string, any> | null
  baseStatus: Record<string, any> | null
  costume: FieldDisplay<string> | null
}

export const charactersApi = {
  list: (storyId: string) => api.get(`/api/stories/${storyId}/characters`),
  create: (storyId: string, data: CharacterCreate) => api.post(`/api/stories/${storyId}/characters`, data),
  update: (charId: string, data: CharacterUpdate) => api.put(`/api/characters/${charId}`, data),
  remove: (charId: string) => api.delete(`/api/characters/${charId}`),
  display: (storyId: string, chapter: number | null) =>
    api.get(`/api/stories/${storyId}/characters/display`, { params: { chapter } }),

  /** 单角色单章节快照:编辑弹窗切章节时用,只回传一个角色,避免拉全部角色 */
  getSnapshot: (storyId: string, charId: string, chapter: number | null) =>
    api.get(`/api/stories/${storyId}/characters/${charId}/snapshot`, { params: { chapter } }),

  /** 手动编辑已归档快照（快照纠错入口） */
  updateSnapshot: (
    storyId: string,
    charId: string,
    chapter: number,
    data: { status: Record<string, any>; relationships: Record<string, any>; costume: string | null }
  ) => api.put(`/api/stories/${storyId}/characters/${charId}/snapshot/${chapter}`, data)
}
