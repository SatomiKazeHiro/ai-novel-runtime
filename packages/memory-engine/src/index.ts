import { getEncoding } from 'js-tiktoken'

const enc = getEncoding('cl100k_base')

export interface MemoryEntry {
  layer: 'global' | 'chapter' | 'scene' | 'temporary'
  content: string
  importance: number
  tags: string[]
  createdAt?: Date
}

function tokenize(text: string): number[] {
  return enc.encode(text)
}

function cosineSimilarity(a: Map<number, number>, b: Map<number, number>): number {
  let dot = 0
  let normA = 0
  let normB = 0
  for (const [id, count] of a) {
    normA += count * count
    const bCount = b.get(id) || 0
    dot += count * bCount
  }
  for (const count of b.values()) {
    normB += count * count
  }
  if (normA === 0 || normB === 0) return 0
  return dot / (Math.sqrt(normA) * Math.sqrt(normB))
}

function buildFreqVector(tokens: number[]): Map<number, number> {
  const vec = new Map<number, number>()
  for (const t of tokens) {
    vec.set(t, (vec.get(t) || 0) + 1)
  }
  return vec
}

export class MemoryManager {
  async extractGlobal(storyId: string, prisma: any): Promise<MemoryEntry[]> {
    const items = await prisma.memory.findMany({
      where: { storyId, layer: 'global' },
      orderBy: { importance: 'desc' }
    })
    return items.map((m: any) => ({
      layer: m.layer,
      content: m.content,
      importance: m.importance,
      tags: JSON.parse(m.tags),
      createdAt: m.createdAt
    }))
  }

  async extractChapter(storyId: string, chapterId: string, prisma: any): Promise<MemoryEntry[]> {
    const items = await prisma.memory.findMany({
      where: { storyId, chapterId, layer: 'chapter' },
      orderBy: { importance: 'desc' }
    })
    return items
      .filter((m: any) => {
        const tags = JSON.parse(m.tags || '[]')
        return !tags.includes('compressed')
      })
      .map((m: any) => ({
        layer: m.layer,
        content: m.content,
        importance: m.importance,
        tags: JSON.parse(m.tags),
        createdAt: m.createdAt
      }))
  }

  async updateFromChapter(storyId: string, chapterId: string, summary: string, prisma: any) {
    await prisma.memory.create({
      data: {
        storyId,
        chapterId,
        layer: 'chapter',
        content: summary,
        tags: JSON.stringify(['auto']),
        importance: 7
      }
    })
  }

  /**
   * 语义检索：根据查询文本（如章节大纲）找到最相关的记忆
   * 使用 tiktoken token 频率向量的余弦相似度
   */
  async searchRelevant(
    storyId: string,
    query: string,
    prisma: any,
    limit: number = 15
  ): Promise<MemoryEntry[]> {
    const allMemories = await prisma.memory.findMany({
      where: { storyId, layer: { in: ['global', 'chapter'] } },
      orderBy: { createdAt: 'desc' }
    })

    if (allMemories.length === 0) return []

    const queryTokens = tokenize(query)
    const queryVec = buildFreqVector(queryTokens)

    const scored = allMemories.map((m: any) => {
      const memTokens = tokenize(m.content)
      const memVec = buildFreqVector(memTokens)
      const sim = cosineSimilarity(queryVec, memVec)

      // 综合得分 = 语义相似度 * 0.6 + 归一化 importance * 0.3 + 时间新鲜度 * 0.1
      const importanceScore = (m.importance || 5) / 10
      const daysOld = m.createdAt
        ? (Date.now() - new Date(m.createdAt).getTime()) / (1000 * 60 * 60 * 24)
        : 30
      const freshnessScore = Math.max(0, 1 - daysOld / 30)

      const score = sim * 0.6 + importanceScore * 0.3 + freshnessScore * 0.1

      return {
        entry: {
          layer: m.layer,
          content: m.content,
          importance: m.importance,
          tags: JSON.parse(m.tags || '[]'),
          createdAt: m.createdAt
        } as MemoryEntry,
        score
      }
    })

    scored.sort((a: any, b: any) => b.score - a.score)
    return scored.slice(0, limit).map((s: any) => s.entry)
  }

  /**
   * 智能格式化记忆，用于注入 Prompt
   * - 按重要性降序排列
   * - 去重（相同内容只保留最新）
   * - 时间衰减（30天前的记忆 importance -2）
   * - 主线优先（main-plot 标签 +2 importance）
   * - 截断到预算内（优先保留主线、高重要性记忆）
   */
  formatForPrompt(entries: MemoryEntry[]): string {
    // 1. 去重：相同内容只保留 importance 最高的一条
    const contentMap = new Map<string, MemoryEntry>()
    for (const entry of entries) {
      const existing = contentMap.get(entry.content)
      if (!existing || entry.importance > existing.importance) {
        contentMap.set(entry.content, entry)
      }
    }
    let uniqueEntries = Array.from(contentMap.values())

    // 2. 时间衰减：30天前的记忆 importance -2
    const now = new Date()
    for (const entry of uniqueEntries) {
      if (entry.createdAt) {
        const daysOld = (now.getTime() - new Date(entry.createdAt).getTime()) / (1000 * 60 * 60 * 24)
        if (daysOld > 30) {
          entry.importance = Math.max(1, entry.importance - 2)
        }
      }
    }

    // 3. 主线优先：带 main-plot 标签的 +2 importance
    for (const entry of uniqueEntries) {
      if (entry.tags.includes('main-plot')) {
        entry.importance += 2
      }
    }

    // 4. 按 importance 降序排列
    uniqueEntries.sort((a, b) => b.importance - a.importance)

    // 5. 截断：只保留重要性 >= 5 的前 30 条
    const filtered = uniqueEntries.filter(e => e.importance >= 5).slice(0, 30)

    if (filtered.length === 0) return '无记忆信息'

    // 6. 格式化输出
    const lines = filtered.map(e => {
      const marker = e.tags.includes('main-plot') ? '【主线】' : ''
      return `- [${e.layer}]${marker} ${e.content}`
    })

    return lines.join('\n')
  }
}
