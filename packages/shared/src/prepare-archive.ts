import { z } from 'zod'

/**
 * POST /api/chapters/:chapterId/prepare-archive 的请求体 schema。
 * chapters.ts:553-555 — endpoint 不读 body,只读 :chapterId path param。
 * schema 仍定义(空对象),用于 P2b wire-up 时显式"无 body"语义。
 */
export const PrepareArchiveRequestSchema = z.object({}).strict()

export type PrepareArchiveRequest = z.infer<typeof PrepareArchiveRequestSchema>
