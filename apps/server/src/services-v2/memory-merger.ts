// V2 记忆合并器 — 阶段 4 实现

export interface V2MemoryMergeInput {
  newMemories: { type: string; category: string; content: string; importance: number }[]
  oldGlobalMemories: { id: string; type: string; category: string; content: string; importance: number }[]
}

export interface V2MemoryMergeResult {
  mergedMemories: { type: string; category: string; content: string; importance: number }[]
  deactivatedIds: string[]
}

export async function mergeMemories(_input: V2MemoryMergeInput): Promise<V2MemoryMergeResult> {
  throw new Error('Not implemented: mergeMemories — 阶段 4 实现')
}
