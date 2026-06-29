// V2 角色提取器 — 阶段 4 实现

export interface V2ExtractedCharacter {
  name: string
  identity?: string
  appearance?: string
  temperament?: string
  personality?: string
  speechStyle?: string
  relationships?: string
  status?: string
  matchedCharacterId?: string
  isNew: boolean
}

export interface V2CharacterExtractResult {
  characters: V2ExtractedCharacter[]
}

export async function extractCharacters(_content: string): Promise<V2CharacterExtractResult> {
  throw new Error('Not implemented: extractCharacters — 阶段 4 实现')
}
