import { z } from 'zod'

/**
 * POST /api/stories/:storyId/chapters 的请求体 schema。
 * 对应 apps/web/src/api/chapters.ts:ChapterCreate(interface) + chapters.ts:73-94
 * 服务端实际只读 `title` / `outline`,`isSideStory` / `number` 由服务端硬编码或计算,
 * 但 schema 仍接受这两个字段(前端可传,服务端忽略)。
 */
export const CreateChapterRequestSchema = z.object({
  title: z.string().trim().min(1),
  outline: z.string().optional(),
  isSideStory: z.boolean().optional(),
  number: z.number().optional()
})

export type CreateChapterRequest = z.infer<typeof CreateChapterRequestSchema>

/**
 * Chapter 实体响应(POST /api/stories/:storyId/chapters 返回 / GET /api/chapters/:chapterId 返回)。
 * 字段来自 Prisma `Chapter` model(prisma/schema.prisma)。
 */
export const ChapterResponseSchema = z.object({
  id: z.string(),
  storyId: z.string(),
  parentChapterId: z.string().nullable().optional(),
  number: z.number(),
  isSideStory: z.boolean(),
  title: z.string(),
  outline: z.string().nullable().optional(),
  content: z.string().nullable().optional(),
  status: z.string(),
  sceneLocation: z.string().nullable().optional(),
  sceneMood: z.string().nullable().optional(),
  sceneGoal: z.string().nullable().optional(),
  summary: z.string().nullable().optional(),
  aiProviderConfigId: z.string().nullable().optional(),
  pendingArchiveData: z.string().nullable().optional(),
  compiledPrompt: z.string().nullable().optional(),
  graphSnapshot: z.string().nullable().optional(),
  graphDelta: z.string().nullable().optional(),
  runtimeProfileId: z.string().nullable().optional(),
  createdAt: z.union([z.string(), z.date()]).optional(),
  updatedAt: z.union([z.string(), z.date()]).optional()
})

export type ChapterResponse = z.infer<typeof ChapterResponseSchema>
