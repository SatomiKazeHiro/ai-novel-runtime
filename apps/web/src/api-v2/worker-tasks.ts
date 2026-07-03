import { v2Api } from './index'

export interface V2WorkerBindingUpdate {
  workerType: string
  workerTaskId: string
}

export const v2WorkerTaskApi = {
  list: (workerType?: string) => v2Api.get<any[]>('/worker-tasks', workerType ? { workerType } : undefined),
  getBindings: (storyId: string) => v2Api.get<any[]>(`/worker-tasks/${storyId}/bindings`),
  updateBinding: (storyId: string, data: V2WorkerBindingUpdate) =>
    v2Api.put<any>(`/worker-tasks/${storyId}/bindings`, data)
}
