/**
 * YAML loader — 通用, 包一层 Zod 校验 + 友好错误信息.
 *
 * Reason:
 *   docs/profiles/*.yaml 和 docs/worker-tasks/*.yaml 是 runtime 启动 init 的
 *   单一源. 任何字段缺失 / 类型错都会让 DB 写入 silently skip 或抛模糊错误,
 *   fail-fast 要求我们把 schema 校验前置, 错误信息精确到文件名 + 路径.
 *
 * 用法:
 *   const profile = loadYaml({
 *     text: readFileSync(path, 'utf-8'),
 *     schema: RuntimeProfileYaml,
 *     source: path  // 错误信息会带上
 *   })
 */

import YAML from 'yaml'
import { ZodError, ZodTypeAny, z } from 'zod'

export interface LoadYamlOptions<T extends ZodTypeAny> {
  text: string
  schema: T
  source: string
}

/**
 * 加载 + 校验 YAML, 返回 schema 推导的类型. 失败抛 YamlLoadError.
 *
 * 与 safeJsonParse 的区别: fail-fast (抛错), 错误信息包含:
 *   - source (文件名)
 *   - YAML 解析错误位置 (line / column)
 *   - Zod 字段路径 (path: settings.language)
 */
export function loadYaml<T extends ZodTypeAny>(
  options: LoadYamlOptions<T>
): z.infer<T> {
  const { text, schema, source } = options

  let parsed: unknown
  try {
    parsed = YAML.parse(text)
  } catch (err: any) {
    const pos = err.linePos?.[0]
    const loc = pos ? ` at line ${pos.line}, column ${pos.col}` : ''
    throw new YamlLoadError(
      `YAML parse failed for ${source}${loc}: ${err.message}`,
      source,
      undefined,
      err
    )
  }

  if (parsed === null || parsed === undefined) {
    throw new YamlLoadError(`YAML is empty: ${source}`, source)
  }

  const result = schema.safeParse(parsed)
  if (!result.success) {
    throw new YamlLoadError(
      formatZodError(result.error, source),
      source,
      result.error
    )
  }
  return result.data
}

/**
 * 扫描目录下所有 *.yaml 文件, 用同一个 schema 校验, 返回 [filename, data] 对.
 * 任何一个文件校验失败都抛错, 不部分应用.
 */
export function loadYamlDir<T extends ZodTypeAny>(
  files: { name: string; text: string }[],
  schema: T
): Array<{ name: string; data: z.infer<T> }> {
  return files.map(({ name, text }) => ({
    name,
    data: loadYaml({ text, schema, source: name })
  }))
}

export class YamlLoadError extends Error {
  public readonly source: string
  public readonly zodError?: ZodError
  public readonly cause?: unknown

  constructor(
    message: string,
    source: string,
    zodError?: ZodError,
    cause?: unknown
  ) {
    super(message)
    this.name = 'YamlLoadError'
    this.source = source
    this.zodError = zodError
    this.cause = cause
  }
}

function formatZodError(err: ZodError, source: string): string {
  const issues = err.issues.map(issue => {
    const path = issue.path.length > 0 ? issue.path.join('.') : '<root>'
    return `  - ${path}: ${issue.message}`
  })
  return `Schema validation failed for ${source}:\n${issues.join('\n')}`
}
