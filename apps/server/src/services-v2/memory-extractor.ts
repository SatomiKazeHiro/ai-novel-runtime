// V2 记忆提取器 — 阶段 4 实现

export interface V2ExtractedMemory {
  type: 'global' | 'chapter' | 'scene' | 'temporary'
  category: 'relationship_change' | 'foreshadowing' | 'emotional_change' | 'event_memory'
  content: string
  importance: number
  participants?: string
}

export interface V2MemoryExtractResult {
  chapterMemories: V2ExtractedMemory[]
  globalMemories: V2ExtractedMemory[]
  sceneMemories: V2ExtractedMemory[]
}

export async function extractMemories(_content: string): Promise<V2MemoryExtractResult> {
  throw new Error('Not implemented: extractMemories — 阶段 4 实现')
}
