import { api } from '../utils/api'

export interface WorkerTaskCreate {
  storyId?: string | null
  type?: string
  name?: string
  workerType: string
  taskPrompt: string
  enabled?: boolean
}

export interface WorkerTaskUpdate {
  name?: string
  workerType?: string
  taskPrompt?: string
  enabled?: boolean
}

export interface WorkerBindingUpdate {
  workerType: string
  workerTaskId: string
}

export const workerTaskApi = {
  list: (params?: { storyId?: string; workerType?: string }) => api.get('/api/worker-tasks', { params }),
  listByType: (workerType: string) => api.get(`/api/worker-tasks/by-type/${workerType}`),
  get: (id: string) => api.get(`/api/worker-tasks/${id}`),
  create: (data: WorkerTaskCreate) => api.post('/api/worker-tasks', data),
  update: (id: string, data: WorkerTaskUpdate) => api.put(`/api/worker-tasks/${id}`, data),
  remove: (id: string) => api.delete(`/api/worker-tasks/${id}`),
  getBindings: (storyId: string) => api.get(`/api/worker-tasks/stories/${storyId}/bindings`),
  updateBinding: (storyId: string, data: WorkerBindingUpdate) => api.put(`/api/worker-tasks/stories/${storyId}/bindings`, data)
}
