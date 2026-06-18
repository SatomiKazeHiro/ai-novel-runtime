import { z } from 'zod'

/**
 * POST /api/chapters/:chapterId/select 的请求体 schema。
 * chapters.ts:505-507 — body 必须有 draftId(选哪个候选)。
 */
export const SelectDraftRequestSchema = z.object({
  draftId: z.string().trim().min(1)
})

export type SelectDraftRequest = z.infer<typeof SelectDraftRequestSchema>
