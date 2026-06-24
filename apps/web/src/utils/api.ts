import axios from 'axios'

const baseURL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000'

export const api = axios.create({
  baseURL,
  timeout: 30000,
  headers: {
    'Content-Type': 'application/json'
  }
})

// FormData 透传: 删除默认 Content-Type,让浏览器/XHR 自行加 multipart boundary
api.interceptors.request.use((config) => {
  if (config.data instanceof FormData) {
    if (config.headers) {
      delete (config.headers as any)['Content-Type']
      delete (config.headers as any)['content-type']
    }
  }
  return config
})

api.interceptors.response.use(
  (response) => response,
  (error) => {
    const message = error.response?.data?.error || error.message || '请求失败'
    console.error('[API Error]', message)
    return Promise.reject(error)
  }
)
