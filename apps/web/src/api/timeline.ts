import { api } from '../utils/api'

/**
 * TimelineEventCreate — Timeline.vue 右上角"+ 添加事件"用。
 *
 * `fromChapterNumber` 必填 — 事件必须绑定到一个已归档章节 (主线 1/2/3... 或
 * 番外 1.01/1.02), 章节删除时随 cascade 一起清理 (chapters-crud.ts:176-178)。
 * 服务端 zod schema 校验 + 业务校验双层防御 (apps/server/src/routes/timeline.ts)。
 *
 * 设计动机 (2026-06-27):
 *   历史 bug: Timeline.vue 之前只发 {position, events}, 服务端未校验
 *   fromChapterNumber 必填, DB 落 null, 这类事件在章节删除时幸存,
 *   与 archive 流程写入的有 fromChapterNumber 事件行为不一致。
 *   修复: server 强制 + UI 章节选择器, 强一致; 跨章节事件走 PlotArc。
 */
export interface TimelineEventCreate {
  fromChapterNumber: number
  position: number
  events: string[]
}

export interface TimelineEventUpdate {
  position?: number
  events?: string[]
}

export const timelineApi = {
  list: (storyId: string) => api.get(`/api/stories/${storyId}/timeline`),
  create: (storyId: string, data: TimelineEventCreate) => api.post(`/api/stories/${storyId}/timeline`, data),
  update: (eventId: string, data: TimelineEventUpdate) => api.put(`/api/timeline/${eventId}`, data),
  remove: (eventId: string) => api.delete(`/api/timeline/${eventId}`)
}
