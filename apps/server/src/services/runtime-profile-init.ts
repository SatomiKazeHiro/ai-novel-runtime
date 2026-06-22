import { readdirSync, readFileSync } from 'fs'
import { resolve } from 'path'
import type { FastifyInstance } from 'fastify'
import { loadYaml, RuntimeProfileYamlSchema, safeJsonStringify } from '@novel-runtime/shared'

const PROFILES_DIR = resolve(process.cwd(), '../../seeds/profiles')

/**
 * 从 docs/profiles/*.yaml 启动导入 RuntimeProfile 到 DB.
 *
 * 单文件 schema 错误 (缺字段 / 类型错 / workerType 不在枚举) 直接抛错退出,
 * 不允许 silent skip — fail-fast 强迫模板维护者修.
 *
 * 已存在同名 Profile 会 skip (DB 已经存了一份, 不会被覆盖),
 * 改模板后必须手动删 DB 行才能重新导入 — 这是有意的: 防止 DB 编辑被 YAML 静默覆盖.
 */
export async function initRuntimeProfile(app: FastifyInstance): Promise<void> {
  let files: string[]

  try {
    files = readdirSync(PROFILES_DIR).filter(f => f.endsWith('.yaml'))
  } catch (err: any) {
    throw new Error(
      `Profiles directory not found: ${PROFILES_DIR}. ` +
      `Create seeds/profiles/*.yaml first.`
    )
  }

  if (files.length === 0) {
    throw new Error(
      `No profile YAML files found in ${PROFILES_DIR}. ` +
      `At least one seeds/profiles/*.yaml is required.`
    )
  }

  for (const file of files) {
    const filePath = resolve(PROFILES_DIR, file)
    const raw = readFileSync(filePath, 'utf-8')

    // Zod 校验 + 解析 — 失败抛 YamlLoadError, fail-fast
    const profile = loadYaml({
      text: raw,
      schema: RuntimeProfileYamlSchema,
      source: file
    })

    const existing = await app.prisma.runtimeProfile.findFirst({
      where: { name: profile.name }
    })

    if (existing) {
      app.log.info(`Runtime Profile "${profile.name}" already exists, skipping`)
      continue
    }

    await app.prisma.runtimeProfile.create({
      data: {
        name: profile.name,
        identity: profile.identity,
        settings: safeJsonStringify(profile.settings),
        behavior: profile.behavior,
        jailbreak: profile.jailbreak,
        isDefault: profile.isDefault
      }
    })

    app.log.info(`Runtime Profile "${profile.name}" initialized from ${file}`)
  }
}
