import { v2Api } from './index'

export const v2PlotArcsApi = {
  list: (storyId: string, status?: string) => {
    const params: any = { storyId }
    if (status) params.status = status
    return v2Api.get<any[]>('/plot-arcs', params)
  },
  detail: (arcId: string) => v2Api.get<any>(`/plot-arcs/${arcId}`)
}
