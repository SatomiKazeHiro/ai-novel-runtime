// V2 Prompt 组装器 — 阶段 6 实现

export interface V2AssemblePromptInput {
  config: Record<string, unknown>
  outline?: string
}

export interface V2AssemblePromptResult {
  systemMessage: string
  userMessage: string
}

export function assemblePrompt(_input: V2AssemblePromptInput): V2AssemblePromptResult {
  throw new Error('Not implemented: assemblePrompt — 阶段 6 实现')
}
