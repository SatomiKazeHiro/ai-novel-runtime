// V2 API 封装 — 复用 V1 axios 实例，对接 /api/v2/*
import { api } from '../utils/api'

const V2_PREFIX = '/api/v2'

export const v2Api = {
  get<T = any>(path: string, params?: Record<string, any>) {
    return api.get<{ success: boolean; data: T; message?: string }>(
      `${V2_PREFIX}${path}`,
      { params }
    )
  },

  post<T = any>(path: string, body?: any) {
    return api.post<{ success: boolean; data: T; message?: string }>(
      `${V2_PREFIX}${path}`,
      body
    )
  },

  put<T = any>(path: string, body?: any) {
    return api.put<{ success: boolean; data: T; message?: string }>(
      `${V2_PREFIX}${path}`,
      body
    )
  },

  delete<T = any>(path: string) {
    return api.delete<{ success: boolean; data: T; message?: string }>(
      `${V2_PREFIX}${path}`
    )
  }
}
