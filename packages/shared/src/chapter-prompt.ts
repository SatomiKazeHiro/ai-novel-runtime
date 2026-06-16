import { z } from 'zod'

/**
 * 客户端可注入的 prompt 包络结构体（generate 路由用）。
 * 与 packages/ai-provider 的 CompiledPrompt 保持一致，前后端共享一份 schema。
 */
export const CompiledPromptSchema = z.object({
  systemMessage: z.string().min(1),
  userMessage: z.string().min(1),
  meta: z.object({
    systemTokens: z.number().nonnegative(),
    userTokens: z.number().nonnegative(),
    totalTokens: z.number().nonnegative()
  }).optional()
})

export type CompiledPrompt = z.infer<typeof CompiledPromptSchema>
