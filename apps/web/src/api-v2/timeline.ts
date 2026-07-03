import { v2Api } from './index'

export const v2TimelineApi = {
  list: (storyId: string) => v2Api.get<any[]>('/timeline', { storyId })
}
