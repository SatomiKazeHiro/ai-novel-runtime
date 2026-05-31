import { api } from '../utils/api'

export interface TimelineEventCreate {
  day: number
  events: string[]
  versionBranchId?: string
}

export interface TimelineEventUpdate {
  day?: number
  events?: string[]
}

export const timelineApi = {
  list: (storyId: string, versionBranchId?: string) => api.get(`/api/stories/${storyId}/timeline`, { params: { versionBranchId } }),
  create: (storyId: string, data: TimelineEventCreate) => api.post(`/api/stories/${storyId}/timeline`, data),
  update: (eventId: string, data: TimelineEventUpdate) => api.put(`/api/timeline/${eventId}`, data),
  remove: (eventId: string) => api.delete(`/api/timeline/${eventId}`)
}
