import { z } from 'zod'

/**
 * POST /api/chapters/:chapterId/select 的请求体 schema。
 * body 必须有 draftId(选哪个候选)。v2 收口: 选中即写 Chapter.content,
 * 没有"只标记不覆盖"的语义。
 */
export const SelectDraftRequestSchema = z.object({
  draftId: z.string().trim().min(1)
})

export type SelectDraftRequest = z.infer<typeof SelectDraftRequestSchema>
