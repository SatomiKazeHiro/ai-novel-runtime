// V2 Prompt 配置默认值

export interface V2PromptConfig {
  characterIds: string[]
  memoryTypeIds: { type: string; category: string; id: string }[]
  plotArcIds: string[]
  loreIds: string[]
  outline?: string
  styleNotes?: string
  scene?: string
}

// —— 记忆语义搜索（参考 V1 MemoryManager.searchRelevant） ——

/** 字符 bigram 频率向量（适合中文文本相似度计算） */
function buildFreqVector(text: string): Map<string, number> {
  const vec = new Map<string, number>()
  for (let i = 0; i < text.length - 1; i++) {
    const bigram = text.slice(i, i + 2)
    vec.set(bigram, (vec.get(bigram) || 0) + 1)
  }
  for (const ch of text) {
    vec.set(ch, (vec.get(ch) || 0) + 1)
  }
  return vec
}

function cosineSimilarity(a: Map<string, number>, b: Map<string, number>): number {
  let dot = 0
  let normA = 0
  let normB = 0
  for (const [key, count] of a) {
    normA += count * count
    dot += count * (b.get(key) || 0)
  }
  for (const count of b.values()) {
    normB += count * count
  }
  if (normA === 0 || normB === 0) return 0
  return dot / (Math.sqrt(normA) * Math.sqrt(normB))
}

function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1
  let intersection = 0
  for (const item of a) {
    if (b.has(item)) intersection++
  }
  const union = a.size + b.size - intersection
  return intersection / union
}

interface ScoredMemory {
  id: string
  type: string
  category: string
  score: number
}

export async function searchRelevantMemories(
  prisma: any,
  storyId: string,
  query: string,
  beforeChapterNumber?: number,
  limit: number = 15
): Promise<{ type: string; category: string; id: string }[]> {
  const allMemories = await prisma.v2Memory.findMany({
    where: {
      storyId,
      type: { in: ['global', 'chapter'] },
      isActive: true
    },
    orderBy: { createdAt: 'desc' }
  })

  // checkpoint 过滤：只取当前章节之前的记忆
  const memories = beforeChapterNumber !== undefined
    ? allMemories.filter((m: any) => {
        if (m.type === 'global') return true
        return !m.originChapterNumber || m.originChapterNumber <= beforeChapterNumber
      })
    : allMemories

  if (memories.length === 0) return []

  const queryVec = buildFreqVector(query)

  const scored: ScoredMemory[] = memories.map((m: any) => {
    const memVec = buildFreqVector(m.content)
    const sim = cosineSimilarity(queryVec, memVec)
    // 综合得分 = 语义相似度 * 0.7 + 归一化 importance * 0.3
    const importanceScore = (m.importance || 5) / 10
    const score = sim * 0.7 + importanceScore * 0.3
    return { id: m.id, type: m.type, category: m.category, score }
  })

  scored.sort((a, b) => b.score - a.score)

  // Jaccard 去重：相似度 > 0.82 的记忆只保留得分更高的一条
  const deduped: ScoredMemory[] = []
  for (const item of scored) {
    const mem = memories.find((m: any) => m.id === item.id)
    if (!mem) continue
    const itemBigrams = new Set<string>()
    for (let i = 0; i < mem.content.length - 1; i++) {
      itemBigrams.add(mem.content.slice(i, i + 2))
    }
    for (const ch of mem.content) {
      itemBigrams.add(ch)
    }

    let isDup = false
    for (const kept of deduped) {
      const keptMem = memories.find((m: any) => m.id === kept.id)
      if (!keptMem) continue
      const keptBigrams = new Set<string>()
      for (let i = 0; i < keptMem.content.length - 1; i++) {
        keptBigrams.add(keptMem.content.slice(i, i + 2))
      }
      for (const ch of keptMem.content) {
        keptBigrams.add(ch)
      }
      if (jaccardSimilarity(itemBigrams, keptBigrams) >= 0.82) {
        isDup = true
        break
      }
    }
    if (!isDup) {
      deduped.push(item)
      if (deduped.length >= limit) break
    }
  }

  return deduped.map(s => ({ type: s.type, category: s.category, id: s.id }))
}

// —— 主入口 ——

export async function getDefaultConfig(
  prisma: any,
  storyId: string
): Promise<V2PromptConfig> {
  const [characters, plotArcs, loreItems] = await Promise.all([
    prisma.v2Character.findMany({
      where: { storyId },
      select: { id: true }
    }),
    prisma.v2PlotArc.findMany({
      where: {
        storyId,
        status: { in: ['active', 'interrupted'] }
      },
      orderBy: [
        { isMainline: 'desc' },
        { updatedAt: 'desc' }
      ],
      select: { id: true }
    }),
    prisma.loreItem.findMany({
      where: { storyId },
      select: { id: true }
    })
  ])

  return {
    characterIds: characters.map((c: { id: string }) => c.id),
    memoryTypeIds: [], // 记忆由"系统分配"按钮触发语义搜索
    plotArcIds: plotArcs.map((a: { id: string }) => a.id),
    loreIds: loreItems.map((l: { id: string }) => l.id),
    styleNotes: undefined
  }
}
