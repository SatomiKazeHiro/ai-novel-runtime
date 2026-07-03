import { resolveProvider } from '../services/ai-provider-init.js'
import { fail, ok, type ExtractorResult } from './extractor-types.js'

export interface RunAiExtractionParams<T> {
  prisma: any
  storyId: string
  system: string
  prompt: string
  temperature?: number
  /** 各 extractor 自带的 schema 校验 + 字段归一化; 返回 null = 形状不对, 触发 fail. */
  validate: (raw: unknown) => T | null
  /** 错误信息前缀, e.g. 'character-extractor', 方便调试 + 上层追溯. */
  context: string
}

/**
 * V2 5 个 extractor 共享的 AI 调用包装.
 *
 * 流程: resolveProvider → provider.generate → parseAIJson → validate.
 * 任一环节失败都 fail-loud, 并把 context 标签打到错误信息.
 *
 * 设计原则: 替代 5 份重复的 resolveProvider + try/catch + parseAIJson (~15 行 × 5 = 75 行);
 * prompt 模板与字段归一化逻辑仍在各自 extractor 里 — 那是领域代码不抽公共包.
 */
export async function runAiExtraction<T>(
  params: RunAiExtractionParams<T>
): Promise<ExtractorResult<T>> {
  const resolved = await resolveProvider(params.prisma, params.storyId)
  if (!resolved?.provider?.generate) {
    return fail(`[${params.context}] 未配置 AI provider`)
  }

  let raw: string
  try {
    raw = await resolved.provider.generate(params.prompt, {
      system: params.system,
      temperature: params.temperature ?? 0.3
    })
  } catch (err: any) {
    return fail(`[${params.context}] AI 调用失败: ${err?.message || '未知错误'}`)
  }

  const parsed = parseAIJson(raw)
  if (parsed == null) {
    return fail(`[${params.context}] AI 返回数据解析失败`)
  }

  const validated = params.validate(parsed)
  if (validated == null) {
    return fail(`[${params.context}] AI 返回数据格式错误`)
  }

  return ok(validated)
}

/**
 * 去掉 markdown ``` 包装, 再 JSON.parse, 失败回退到第一个完整 [...] 或 {...} 子串.
 *
 * 与历史每文件自带版的差异: 同时尝试数组和对象两种括号回退 (旧版只回退单一形状).
 * 严格更宽松, 不破坏任何旧调用方 — 因为 5 个 extractor 都在 parse 失败的罕见
 * 边界上获益, 而不是变差.
 */
export function parseAIJson(raw: string): any {
  let text = raw.trim()
  if (text.startsWith('```')) {
    text = text.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '')
  }
  try { return JSON.parse(text) } catch { /* fall through */ }

  const arrMatch = text.match(/\[[\s\S]*\]/)
  if (arrMatch) {
    try { return JSON.parse(arrMatch[0]) } catch { /* fall through */ }
  }

  const objMatch = text.match(/\{[\s\S]*\}/)
  if (objMatch) {
    try { return JSON.parse(objMatch[0]) } catch { /* fall through */ }
  }

  return null
}
