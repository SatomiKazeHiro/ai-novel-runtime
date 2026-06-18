import { z } from 'zod'

/**
 * POST /api/chapters/:chapterId/develop 的请求体 schema。
 * chapters.ts:776-839 — 所有字段 optional(isSideStory 控制走主线还是番外,
 * number 仅在 isSideStory 时生效,title/outline 留空时由服务端默认,
 * runtimeProfileId 留空时回退到 parentChapter 的配置)。
 */
export const DevelopRequestSchema = z.object({
  isSideStory: z.boolean().optional(),
  number: z.number().optional(),
  title: z.string().optional(),
  outline: z.string().optional(),
  runtimeProfileId: z.string().optional()
})

export type DevelopRequest = z.infer<typeof DevelopRequestSchema>
