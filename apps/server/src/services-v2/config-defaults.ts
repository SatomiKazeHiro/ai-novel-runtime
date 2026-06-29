// V2 Prompt 配置默认值 — 阶段 6 实现

export interface V2PromptConfig {
  characterIds: string[]
  memoryTypeIds: { type: string; category: string; id: string }[]
  plotArcIds: string[]
  loreIds: string[]
  outline?: string
  styleNotes?: string
}

export function getDefaultConfig(_storyId: string): V2PromptConfig {
  throw new Error('Not implemented: getDefaultConfig — 阶段 6 实现')
}
