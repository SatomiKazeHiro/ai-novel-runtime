import { v2Api } from './index'

export const v2PromptLogApi = {
  list: (storyId: string, params?: { callType?: string; page?: number; pageSize?: number }) =>
    v2Api.get<{ items: any[]; total: number; page: number; pageSize: number }>('/prompt-logs', {
      storyId,
      ...params
    }),
  detail: (logId: string) => v2Api.get<any>(`/prompt-logs/${logId}`)
}
