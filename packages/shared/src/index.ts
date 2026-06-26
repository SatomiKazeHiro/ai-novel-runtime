// Shared types and constants across the monorepo

export const ChapterStatus = {
  DRAFT: 'draft',
  GENERATING: 'generating',
  GENERATED: 'generated',
  SCORED: 'scored',
  SELECTED: 'selected',
  REVIEWING: 'reviewing',
  ARCHIVED: 'archived',
  REJECTED: 'rejected'
} as const

export type ChapterStatusType = typeof ChapterStatus[keyof typeof ChapterStatus]

export const MemoryLayer = {
  GLOBAL: 'global',
  CHAPTER: 'chapter',
  SCENE: 'scene',
  TEMPORARY: 'temporary'
} as const

export type MemoryLayerType = typeof MemoryLayer[keyof typeof MemoryLayer]

export const LoreCategory = {
  RANK: 'rank',
  MAP: 'map',
  SKILL: 'skill',
  FACTION: 'faction',
  ITEM: 'item',
  RULE: 'rule'
} as const

export type LoreCategoryType = typeof LoreCategory[keyof typeof LoreCategory]

export const GraphNodeType = {
  CHARACTER: 'character',
  FACTION: 'faction',
  EVENT: 'event',
  ITEM: 'item'
} as const

export type GraphNodeTypeType = typeof GraphNodeType[keyof typeof GraphNodeType]

export const PromptType = {
  SYSTEM: 'system',
  JAILBREAK: 'jailbreak',
  STORY: 'story',
  CHARACTER: 'character',
  LORE: 'lore',
  SCENE: 'scene',
  MEMORY: 'memory',
  STYLE: 'style',
  INSTRUCTION: 'instruction'
} as const

export type PromptTypeType = typeof PromptType[keyof typeof PromptType]

// Simple token estimator (Chinese ~1 token per char, English ~0.25 per char)
export function estimateTokens(text: string): number {
  let cn = 0
  let en = 0
  for (const ch of text) {
    if (/[\u4e00-\u9fff]/.test(ch)) cn++
    else if (/[a-zA-Z]/.test(ch)) en++
  }
  return Math.ceil(cn + en * 0.25)
}

export function formatCharacterSnapshot(characters: any[]): string {
  if (characters.length === 0) return '无角色信息'
  return characters.map(c => {
    const status = safeJsonParse(c.status, {})
    const rels = safeJsonParse(c.relationships, {})
    const personality = safeJsonParse<string[]>(c.personality, [])
    const speechStyle = safeJsonParse<string[]>(c.speechStyle, [])
    const identity = safeJsonParse<string[]>(c.identity, [])
    const appearance = safeJsonParse<string[]>(c.appearance, [])
    const temperament = safeJsonParse<string[]>(c.temperament, [])

    const statusStr = Object.entries(status).map(([k, v]) => `${k}:${v}`).join(', ')
    const relStr = Object.entries(rels).slice(0, 2).map(([k, v]) => `${k}-${v}`).join(', ')

    const parts = [`【${c.name}】`]
    if (identity.length) parts.push(`身份[${identity.join(', ')}]`)
    if (appearance.length) parts.push(`外貌[${appearance.join(', ')}]`)
    if (temperament.length) parts.push(`气质[${temperament.join(', ')}]`)
    if (personality.length) parts.push(`性格[${personality.join(', ')}]`)
    if (speechStyle.length) parts.push(`说话风格[${speechStyle.join(', ')}]`)
    if (statusStr) parts.push(`状态[${statusStr}]`)
    if (relStr) parts.push(`关系[${relStr}]`)
    return parts.join(' ')
  }).join('\n')
}

export function cleanJsonBlock(raw: string): string {
  const trimmed = raw.trim()

  // 不完整 fence 配对 → 响应被截断（例如 AI 输出超 maxTokens 被砍掉尾部）。
  // 直接抛错让上游透传到前端，比静默吃掉再让 JSON.parse 抛 SyntaxError 强。
  const fenceCount = (trimmed.match(/```/g) || []).length
  if (fenceCount > 0 && fenceCount % 2 !== 0) {
    throw new Error(
      'AI 响应被 markdown 代码块包裹但未闭合（响应可能被截断）。请尝试在模型配置中增大 maxTokens，或减小章节长度后重试。'
    )
  }

  // 单对 fence → 边界剥离（兼容 ```json 和裸 ``` 两种）
  if (fenceCount === 2) {
    return trimmed
      .replace(/^```[a-zA-Z]*\s*\n?/, '')
      .replace(/\n?```$/, '')
      .trim()
      // 同样修复 AI 在值位置写的"裸 &"（见下方注释）
      .replace(/([:,\[]\s*?)&(\s*?[,\]}])/g, '$1"&"$2')
      // 修复 value 位置的 HTML entity (e.g. &nbsp; / &amp; / &nbsp;7)
      .replace(/([:,\[]\s*?)&([a-zA-Z][a-zA-Z0-9;]*)/g, '$1"&$2"')
  }

  // 多对 fence / 无 fence → 兼容旧实现语义：全局剥 ```json，尾部剥 ```
  const cleaned = trimmed.replace(/```json\s*/g, '').replace(/```\s*$/g, '').trim()

  // 修复 AI 把 "&" 当作"等等"占位符写入值位置的非法 JSON。
  // 用户真实 bug：AI 返回 {"importance": &, ...}（value 位置出现裸 &），
  // JSON.parse 直接抛 Unexpected token '&'。这里把值位置的"裸 &"（& 前面
  // 是 : 或 , 或 [ 加空白，& 后面是 , 或 } 或 ] 加空白）包裹成字符串 "&"，
  // 让 JSON 仍可解析。字符串内部的 &（如 "Tom & Jerry"）前后是字母/数字，
  // 不在正则范围内，不会被破坏；合法 HTML entity（&amp; &lt; 等）也保留原样。
  //
  // 扩展：覆盖 value 位置的多字符 HTML entity（e.g. "&nbsp;" / "&amp;" /
  // "&amp" / "&nbsp;7" — LLM 把 entity 当作数字的格式化前缀）。正则扩展为
  // `&` 后跟字母开头、含字母数字分号的整段 entity（含 entity 后的数字
  // 当作 entity 的一部分），包裹成字符串。字符串内的 entity 前面是引号
  // 不是 : / , / [，不在范围，安全。
  return cleaned
    .replace(/([:,\[]\s*?)&(\s*?[,\]}])/g, '$1"&"$2')
    .replace(/([:,\[]\s*?)&([a-zA-Z][a-zA-Z0-9;]*)/g, '$1"&$2"')
}

/**
 * 安全的 JSON.parse，失败时返回 fallback
 */
export function safeJsonParse<T>(str: string | null | undefined, fallback: T): T {
  if (!str) return fallback
  try {
    return JSON.parse(str) as T
  } catch {
    return fallback
  }
}

/**
 * 安全的 JSON.stringify，失败时返回 fallback
 */
export function safeJsonStringify(obj: any, fallback = '{}'): string {
  try {
    return JSON.stringify(obj)
  } catch {
    return fallback
  }
}

import { getEncoding } from 'js-tiktoken'
const _enc = getEncoding('cl100k_base')

/**
 * 将文本转为 token ID 数组
 */
export function tokenize(text: string): number[] {
  return _enc.encode(text)
}

/**
 * 将文本转为 token ID 的 Set
 */
export function tokenSet(text: string): Set<number> {
  return new Set(tokenize(text))
}

/**
 * 计算两个 token Set 的 Jaccard 相似度
 */
export function jaccardSimilarity(a: Set<number>, b: Set<number>): number {
  if (a.size === 0 || b.size === 0) return 0
  const intersection = new Set([...a].filter(x => b.has(x)))
  const union = new Set([...a, ...b])
  return intersection.size / union.size
}

export function generateFallbackContent(chapter: any, index: number, reason?: string): string {
  const styles = ['克制冷静', '情绪充沛', '戏剧化']
  const style = styles[index] || '默认'
  const prefix = reason ? `（生成失败：${reason}）` : ''
  const variant = index === 0
    ? '他一贯冷静克制，即使局势紧张，面上也不见波澜。'
    : index === 1
      ? '情绪翻涌，难以自抑，眼中竟有泪光闪动。'
      : '命运转折的时刻，风云突变，局势急转直下。'

  return `【候选 ${String.fromCharCode(97 + index)} — ${style}风格】${prefix}

${chapter.title}

${chapter.outline || '暂无大纲'}

夜风掠过窗台，城市的灯火在远处明明灭灭。他独自站在天台上，思绪如潮水般涌动。${variant}

远处，警笛声隐约传来……

【注：以上为降级模拟内容${reason ? '，真实 AI 生成失败原因：' + reason : ''}】`
}

export const DEFAULT_PIPELINE_BUDGET = {
  total: 64000,
  identity: 0,
  behavior: 0,
  jailbreak: 0,
  style: 2000,
  story: 12000,
  lore: 10000,
  character: 12000,
  scene: 12000,
  memory: 8000,
  timeline: 4000,
  plotArc: 3000,
  output: 16000
} as const

export type BudgetConfig = {
  total: number
  identity: number
  behavior: number
  jailbreak: number
  style: number
  story: number
  lore: number
  character: number
  scene: number
  memory: number
  timeline: number
  plotArc: number
  output: number
}

/**
 * 根据模型的 contextLength 动态缩放 Pipeline 预算。
 * 保留 DEFAULT_PIPELINE_BUDGET 各层的比率，按实际 contextLength 线性缩放。
 * 总预算留 5% 余量给系统开销（system message 等）。
 */
export function scaleBudget(contextLength: number): BudgetConfig {
  const ratio = contextLength / DEFAULT_PIPELINE_BUDGET.total
  return {
    total: Math.floor(contextLength * 0.95),
    identity: 0,
    behavior: 0,
    jailbreak: 0,
    style: Math.floor(DEFAULT_PIPELINE_BUDGET.style * ratio),
    story: Math.floor(DEFAULT_PIPELINE_BUDGET.story * ratio),
    lore: Math.floor(DEFAULT_PIPELINE_BUDGET.lore * ratio),
    character: Math.floor(DEFAULT_PIPELINE_BUDGET.character * ratio),
    scene: Math.floor(DEFAULT_PIPELINE_BUDGET.scene * ratio),
    memory: Math.floor(DEFAULT_PIPELINE_BUDGET.memory * ratio),
    timeline: Math.floor(DEFAULT_PIPELINE_BUDGET.timeline * ratio),
    plotArc: Math.floor(DEFAULT_PIPELINE_BUDGET.plotArc * ratio),
    output: Math.floor(DEFAULT_PIPELINE_BUDGET.output * ratio)
  }
}

export * from './archive.js'
export * from './chapter-prompt.js'
export * from './timeline-encoding.js'
export * from './chapter.js'
export * from './develop.js'
export * from './prepare-archive.js'
export * from './select-draft.js'
export * from './yaml.js'
export * from './schemas/profile.js'
export * from './schemas/worker-task.js'
export * from './extract-prompt.js'
