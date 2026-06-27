// Shared timeline API contracts (web ↔ server)
//
// TimelineEvent 在 DB 里存为 TimelineEvent row (prisma/schema.prisma:213),
// `fromChapterNumber` 是 Float? — nullable 表示「跨章节/全局」事件,
// 非空则跟随该章节的 cascade 生命周期 (chapters-crud.ts:176-178 在章节删除
// 时按 fromChapterNumber 清空)。
//
// 设计动机 (2026-06-27):
//   历史 bug — Timeline.vue 右上角"+ 添加事件"只发 {position, events},
//   server 直接 body.fromChapterNumber (undefined) 落库,DB 行 fromChapterNumber=NULL,
//   这类事件在章节删除时幸存,与 archive 流程写入的有 fromChapterNumber
//   事件行为不一致。
//   修复方案:server 强制要求 fromChapterNumber 必填且必须对应已归档章节,
//   前端 UI 增加章节选择器,UI 入口和 API 入口双层防御。
//
//   - 跨章节事件:本接口**不接受** fromChapterNumber=null (强一致);
//     真有跨章节叙事需求走剧情弧线 (PlotArc)。
//   - 历史 fromChapterNumber=NULL 行:保留不动,见 docs/ISSUES.md (向前兼容)。

import { z } from 'zod'
import { validateTimelinePosition } from './timeline-encoding.js'

/**
 * POST /api/stories/:storyId/timeline 的请求体 schema。
 *
 * 字段:
 *   - fromChapterNumber: 必填,事件归属章节的 number (主线整数 1/2/3... / 番外小数 1.01/1.02)
 *   - position: 必填,Y.DDDHH 实数编码 (用 validateTimelinePosition 二次兜底)
 *   - events: 必填,非空字符串数组 (前端 DynamicTags 输入,后端 JSON.stringify 存)
 *
 * 服务端二次校验 (在 routes/timeline.ts POST 处理里):
 *   - fromChapterNumber 必须在 storyId 范围内
 *   - 对应 Chapter.status === 'archived'
 *   - position 通过 validateTimelinePosition
 */
export const CreateTimelineEventRequestSchema = z.object({
  fromChapterNumber: z.number()
    .refine((n) => Number.isFinite(n), { message: 'fromChapterNumber 必须是有限数' }),
  position: z.number()
    .refine(
      (n) => validateTimelinePosition(n).ok,
      { message: 'position 必须是合法的 Y.DDDHH 编码' }
    ),
  events: z.array(z.string().min(1))
    .min(1, { message: 'events 至少需要 1 条描述' })
})

export type CreateTimelineEventRequest = z.infer<typeof CreateTimelineEventRequestSchema>
