import { api } from '../utils/api'

export const plotArcApi = {
  list: (storyId: string) => api.get(`/api/stories/${storyId}/plot-arcs`)
}
