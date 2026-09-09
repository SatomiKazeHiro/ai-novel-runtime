import { getEncoding } from 'js-tiktoken'
import { safeJsonParse } from '@novel-runtime/shared'

const enc = getEncoding('cl100k_base')

export interface MemoryEntry {
  layer: 'global' | 'chapter' | 'scene' | 'temporary'
  content: string
  importance: number
  tags: string[]
  createdAt?: Date
  chapterNumber?: number // 该记忆所属章节的序号
  originUid?: string     // 事件起始UID
  category?: string
  participants?: string
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
      tags: safeJsonParse<string[]>(m.tags, []),
      createdAt: m.createdAt,
      chapterNumber: undefined,
      originUid: m.originUid
    }))
  }

  async extractChapter(storyId: string, chapterId: string, prisma: any): Promise<MemoryEntry[]> {
    const chapter = await prisma.chapter.findUnique({
      where: { id: chapterId },
      select: { number: true }
    })
    const items = await prisma.memory.findMany({
      where: { storyId, chapterId, layer: 'chapter' },
      orderBy: { importance: 'desc' }
    })
    return items
      .filter((m: any) => {
        const tags = safeJsonParse<string[]>(m.tags, [])
        return !tags.includes('compressed')
      })
      .map((m: any) => ({
        layer: m.layer,
        content: m.content,
        importance: m.importance,
        tags: safeJsonParse<string[]>(m.tags, []),
        createdAt: m.createdAt,
        chapterNumber: chapter?.number,
        originUid: m.originUid
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
   * @param beforeChapterNumber 只检索该章节号之前的记忆（checkpoint 机制）
   *
   * v3 调整 (2026-07-30 spec D14):
   *   - layer='global' 按 originUid 分组, 每个 UID 只取 fromChapterNumber 最大的那条(最新版本)
   *   - layer='chapter' 不参与 UID 收缩(章节内 raw 提取独立, 不同章可有同 content)
   *   - 旧版本仍按章节 checkpoint 过滤 + 番外排除保留
   */
  async searchRelevant(
    storyId: string,
    query: string,
    prisma: any,
    limit: number = 15,
    beforeChapterNumber?: number
  ): Promise<MemoryEntry[]> {
    const allMemories = await prisma.memory.findMany({
      where: { storyId, layer: { in: ['global', 'chapter'] } },
      include: { chapter: { select: { number: true, isSideStory: true } } },
      orderBy: { createdAt: 'desc' }
    })

    // checkpoint 过滤 + 番外排除
    const filtered = beforeChapterNumber !== undefined
      ? allMemories.filter((m: any) => {
          if (m.layer === 'global') return true
          if (m.chapter?.isSideStory) return false // 番外记忆不纳入主线上下文
          return !m.chapter?.number || m.chapter.number <= beforeChapterNumber
        })
      : allMemories.filter((m: any) => {
          if (m.layer === 'global') return true
          return !m.chapter?.isSideStory
        })

    // v3 spec D14: 仅对 layer='global' 按 originUid 收缩到最新版本
    //   同一 UID 多个历史版本只保留 fromChapterNumber 最大(且有 originUid 字段)那条
    //   - originUid 为空(如老数据)保留, 视为无 UID 行不参与收缩
    //   - chapter 层不收缩
    const latestGlobalByUid = new Map<string, any>()
    const noUidGlobal: any[] = []
    for (const m of filtered) {
      if (m.layer !== 'global') continue
      if (!m.originUid) { noUidGlobal.push(m); continue }
      const cur = latestGlobalByUid.get(m.originUid)
      const curNum = cur?.fromChapterNumber ?? -Infinity
      const mNum = m.fromChapterNumber ?? -Infinity
      if (!cur || mNum > curNum) latestGlobalByUid.set(m.originUid, m)
    }
    const chapterRows = filtered.filter((m: any) => m.layer === 'chapter')
    const memories = [...Array.from(latestGlobalByUid.values()), ...noUidGlobal, ...chapterRows]

    if (memories.length === 0) return []

    const queryTokens = tokenize(query)
    const queryVec = buildFreqVector(queryTokens)

    const scored = memories.map((m: any) => {
      const memTokens = tokenize(m.content)
      const memVec = buildFreqVector(memTokens)
      const sim = cosineSimilarity(queryVec, memVec)

      // 综合得分 = 语义相似度 * 0.7 + 归一化 importance * 0.3
      const importanceScore = (m.importance || 5) / 10
      const score = sim * 0.7 + importanceScore * 0.3

      return {
        entry: {
          layer: m.layer,
          content: m.content,
          importance: m.importance,
          tags: safeJsonParse<string[]>(m.tags, []),
          createdAt: m.createdAt,
          chapterNumber: m.chapter?.number,
          originUid: m.originUid,
          category: m.category,
          participants: m.participants
        } as MemoryEntry,
        score
      }
    })

    scored.sort((a: any, b: any) => b.score - a.score)

    // 近似去重：相似度 > 0.82 的记忆只保留得分更高的一条
    const deduped: typeof scored = []
    for (const item of scored) {
      const itemTokens = new Set(tokenize(item.entry.content))
      let isDup = false
      for (const kept of deduped) {
        const keptTokens = new Set(tokenize(kept.entry.content))
        const intersection = new Set([...itemTokens].filter(x => keptTokens.has(x)))
        const union = new Set([...itemTokens, ...keptTokens])
        if (intersection.size / union.size >= 0.82) {
          isDup = true
          break
        }
      }
      if (!isDup) deduped.push(item)
      if (deduped.length >= limit) break
    }

    return deduped.map((s: any) => s.entry)
  }

  /**
   * 智能格式化记忆，用于注入 Prompt
   * - 按章节号升序排列（时间线清晰）
   * - 去重（相同内容只保留 importance 最高的一条）
   * - 章节距离衰减（>5章 -1，>10章 -2，>20章 -3）
   * - global 记忆不衰减
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

    // 2. 同一 originUid 只取最新(最大 chapterNumber)
    //    备注: searchRelevant 已对 layer='global' 按 UID 收缩到最新版本(2026-07-30 spec D14),
    //    此处保留冗余是防御性 — 调用方如果直接调 formatForPrompt (不经 searchRelevant),仍能正确去重。
    //    ⚠️ 字段说明: 这里用 chapterNumber(= chapter?.number) 而非 fromChapterNumber，两者当前等价——
    //    global 记忆的 chapterId 也关联到归档章(非 null，见 chapters-archive.ts 写 globalRows 时
    //    chapterId 取当前章 id)，所以 chapter.number === fromChapterNumber。勿误报为
    //    "global 记忆 chapterId 为 null 导致去重失效"(已核实 v4 数据 global 层 chapterId 非空)。
    const uidMap = new Map<string, MemoryEntry>()
    const withoutUid: MemoryEntry[] = []
    for (const entry of uniqueEntries) {
      if (!entry.originUid) {
        withoutUid.push(entry)
        continue
      }
      const existing = uidMap.get(entry.originUid)
      if (!existing || (entry.chapterNumber || 0) > (existing.chapterNumber || 0)) {
        uidMap.set(entry.originUid, entry)
      }
    }
    uniqueEntries = [...Array.from(uidMap.values()), ...withoutUid]

    // 3. 推断当前章节号（取 entries 中最大的 chapterNumber）
    const currentChapterNumber = Math.max(0, ...entries.map(e => e.chapterNumber || 0))

    // 4. 章节距离衰减：global 记忆不衰减
    for (const entry of uniqueEntries) {
      if (entry.chapterNumber !== undefined && currentChapterNumber > 0) {
        const dist = currentChapterNumber - entry.chapterNumber
        if (dist > 20) {
          entry.importance = Math.max(1, entry.importance - 3)
        } else if (dist > 10) {
          entry.importance = Math.max(1, entry.importance - 2)
        } else if (dist > 5) {
          entry.importance = Math.max(1, entry.importance - 1)
        }
      }
    }

    // 5. 主线优先：带 main-plot 标签的 +2 importance（已取消，importance 由 AI 在提取时直接评定）
    // for (const entry of uniqueEntries) {
    //   if (entry.tags.includes('main-plot')) {
    //     entry.importance += 2
    //   }
    // }

    // 6. 截断：只保留重要性 >= 5 的前 30 条
    const filtered = uniqueEntries.filter(e => e.importance >= 5).slice(0, 30)

    if (filtered.length === 0) return '无记忆信息'

    // 7. 按章节号升序排列（global 无 chapterNumber 的放最后）
    filtered.sort((a, b) => {
      const aNum = a.chapterNumber ?? Infinity
      const bNum = b.chapterNumber ?? Infinity
      if (aNum !== bNum) return aNum - bNum
      return b.importance - a.importance
    })

    // 8. 格式化输出：(第X章·Y章前·重要度Z) 或 (第X章·重要度Z)
    const lines = filtered.map(e => {
      const dist = e.chapterNumber !== undefined && currentChapterNumber > 0
        ? currentChapterNumber - e.chapterNumber
        : null
      const distText = dist !== null && dist > 0 ? `·${dist}章前` : ''
      const importanceText = `·重要度${e.importance}`
      const chapterText = e.chapterNumber !== undefined
        ? `(第${e.chapterNumber}章${distText}${importanceText})`
        : `(全局${importanceText})`
      return `- [${e.layer}]${chapterText} ${e.content}`
    })

    return lines.join('\n')
  }
}
