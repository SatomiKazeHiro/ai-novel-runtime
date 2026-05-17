import { api } from '../utils/api'

export interface WorkerTaskCreate {
  storyId?: string | null
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

export const workerTaskApi = {
  list: (params?: { storyId?: string; workerType?: string }) => api.get('/api/worker-tasks', { params }),
  get: (id: string) => api.get(`/api/worker-tasks/${id}`),
  create: (data: WorkerTaskCreate) => api.post('/api/worker-tasks', data),
  update: (id: string, data: WorkerTaskUpdate) => api.put(`/api/worker-tasks/${id}`, data),
  remove: (id: string) => api.delete(`/api/worker-tasks/${id}`)
}
