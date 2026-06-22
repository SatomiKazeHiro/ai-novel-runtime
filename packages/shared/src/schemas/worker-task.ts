/**
 * WorkerTask YAML schema.
 *
 * 这是 docs/worker-tasks/*.yaml 文件的单一类型源.
 *
 * 字段映射 Prisma model WorkerTask (apps/server/prisma/schema.prisma):
 *   - name        -> TEXT
 *   - workerType  -> TEXT (枚举值之一)
 *   - taskPrompt  -> TEXT
 *   - enabled     -> boolean (DB 默认 true; YAML 可省略, 默认 true)
 *
 * workerType 枚举的字符串值要和 runtime-compiler 的 WorkerTask.workerType
 * (packages/ai-provider/src/runtime-compiler.ts) 保持一致, 这里用 z.enum
 * 钉死, YAML 写错就 fail-fast.
 */

import { z } from 'zod'

/** Worker 类型枚举 — 加新类型时同步更新 runtime-compiler. */
export const WORKER_TYPES = [
  'generation',
  'scoring',
  'memory',
  'graph',
  'timeline',
  'rewrite',
  'memory_organize'
] as const

export const WorkerTypeSchema = z.enum(WORKER_TYPES)

export const WorkerTaskYamlSchema = z.object({
  name: z.string().min(1, 'name 不能为空'),
  workerType: WorkerTypeSchema,
  taskPrompt: z.string().min(1, 'taskPrompt 不能为空'),
  enabled: z.boolean().default(true)
}).strict()

export type WorkerType = z.infer<typeof WorkerTypeSchema>
export type WorkerTaskYaml = z.infer<typeof WorkerTaskYamlSchema>
