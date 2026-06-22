/**
 * RuntimeProfile YAML schema.
 *
 * 这是 docs/profiles/*.yaml 文件的单一类型源 — Zod schema 推导出的 TS 类型
 * 同时给 TS 编译期校验和启动期 fail-fast 校验用.
 *
 * 字段映射 Prisma model RuntimeProfile (apps/server/prisma/schema.prisma):
 *   - identity  -> TEXT
 *   - settings  -> JSON string ({language, uncensored, repeat, speciality})
 *   - behavior  -> TEXT
 *   - jailbreak -> nullable TEXT
 *   - isDefault -> boolean
 *
 * 加新字段时: 这里加 + docs/profiles/*.yaml 同步改 + Prisma schema 改 + DB migrate.
 */

import { z } from 'zod'

export const ProfileSettingsSchema = z.object({
  language: z.enum(['CN', 'EN']).default('CN'),
  uncensored: z.boolean().default(true),
  repeat: z.boolean().default(false),
  speciality: z.string().default('')
}).strict()

/** settings 整体缺省时的兜底 (用户写最简 profile). */
const DEFAULT_SETTINGS: ProfileSettings = {
  language: 'CN',
  uncensored: true,
  repeat: false,
  speciality: ''
}

export const RuntimeProfileYamlSchema = z.object({
  /** 显示名, 唯一标识. 如果和 DB 已存在的 name 冲突, init 会 skip */
  name: z.string().min(1, 'name 不能为空'),
  identity: z.string().min(1, 'identity 不能为空 — 写作人格必须有自我描述'),
  settings: ProfileSettingsSchema.default(DEFAULT_SETTINGS),
  behavior: z.string().min(1, 'behavior 不能为空'),
  jailbreak: z.string().nullable().default(null),
  isDefault: z.boolean().default(false)
}).strict()

export type ProfileSettings = z.infer<typeof ProfileSettingsSchema>
export type RuntimeProfileYaml = z.infer<typeof RuntimeProfileYamlSchema>
