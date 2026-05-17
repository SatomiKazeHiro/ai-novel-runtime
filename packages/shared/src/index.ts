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
  REALM: 'realm',
  MAP: 'map',
  TECHNIQUE: 'technique',
  FACTION: 'faction',
  ITEM: 'item',
  RULE: 'rule'
} as const

export type LoreCategoryType = typeof LoreCategory[keyof typeof LoreCategory]

export const GraphNodeType = {
  CHARACTER: 'character',
  FACTION: 'faction',
  EVENT: 'event',
  REALM: 'realm',
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
