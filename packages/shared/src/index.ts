// Shared types and constants across the monorepo

export const ChapterStatus = {
  DRAFT: 'draft',
  GENERATED: 'generated',
  SCORED: 'scored',
  SELECTED: 'selected',
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
    const status = JSON.parse(c.status || '{}')
    const rels = JSON.parse(c.relationships || '{}')
    const statusStr = Object.entries(status).map(([k, v]) => `${k}:${v}`).join(', ')
    const relStr = Object.entries(rels).slice(0, 2).map(([k, v]) => `${k}-${v}`).join(', ')
    const parts = [`【${c.name}】`]
    if (statusStr) parts.push(`状态[${statusStr}]`)
    if (relStr) parts.push(`关系[${relStr}]`)
    return parts.join(' ')
  }).join('\n')
}

export function cleanJsonBlock(raw: string): string {
  return raw.replace(/```json\s*/g, '').replace(/```\s*$/g, '').trim()
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
