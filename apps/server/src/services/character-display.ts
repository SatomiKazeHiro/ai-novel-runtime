import { safeJsonParse } from '@novel-runtime/shared'

export interface FieldDisplay<T> {
  value: T
  sourceChapterNumber: number | null
}

export interface CharacterDisplayRow {
  id: string
  name: string
  slug: string
  protagonist: boolean
  identity: string[]
  appearance: string[]
  temperament: string[]
  personality: string[]
  speechStyle: string[]
  relationships: FieldDisplay<Record<string, any>> | null
  status: FieldDisplay<Record<string, any>> | null
  baseRelationships: Record<string, any> | null
  baseStatus: Record<string, any> | null
  costume: FieldDisplay<string> | null
}

interface PrismaLike {
  character: { findMany: (args: any) => Promise<any[]> }
  characterBranchState: { findMany: (args: any) => Promise<any[]> }
}

interface BranchStateRow {
  characterId: string
  fromChapterNumber: number | null
  status: string | null
  relationships: string | null
  costume: string | null
}

/**
 * 角色管理 v4 — 三字段独立查"最新有数据归档章"。
 *
 * - viewChapterNumber = null: 每个字段(costume/relationships/status)各自找"最新有数据"的 snapshot;
 *   snapshot 全无则回退 base (Character.{relationships,status});costume 字段无 base 兜底,纯 snapshot。
 * - viewChapterNumber = N: 统一显示 N 章数据;该章无字段则 null (不回退 base,因为 base 不是章节数据)
 *
 * 边界: snapshot 字段值是合法 JSON 字符串才返回;解析失败 → 该字段 null,不抛错。
 */
export async function fetchCharacterDisplay(
  prisma: PrismaLike,
  storyId: string,
  viewChapterNumber: number | null
): Promise<CharacterDisplayRow[]> {
  const characters = await prisma.character.findMany({ where: { storyId } })
  if (characters.length === 0) return []

  const branchStates = await prisma.characterBranchState.findMany({
    where: { characterId: { in: characters.map(c => c.id) } },
    orderBy: { fromChapterNumber: 'desc' }
  })

  const byChar = new Map<string, BranchStateRow[]>()
  for (const bs of branchStates) {
    if (!byChar.has(bs.characterId)) byChar.set(bs.characterId, [])
    byChar.get(bs.characterId)!.push(bs)
  }

  return characters.map((c: any): CharacterDisplayRow => {
    const states = byChar.get(c.id) || []

    const pickJson = (
      fieldName: 'relationships' | 'status',
      baseValue: string | null
    ): FieldDisplay<Record<string, any>> | null => {
      if (viewChapterNumber === null) {
        // 默认模式: 最新有数据的 snapshot(从 desc 顺序遍历)
        for (const bs of states) {
          if (bs.fromChapterNumber === null) continue
          const raw = bs[fieldName]
          if (raw === null || raw === undefined || raw === '') continue
          const parsed = safeJsonParse<Record<string, any> | null>(raw, null)
          if (parsed !== null && parsed !== undefined) {
            return { value: parsed, sourceChapterNumber: bs.fromChapterNumber }
          }
        }
        // 无 snapshot → 退到 base
        if (baseValue) {
          const parsed = safeJsonParse<Record<string, any> | null>(baseValue, null)
          if (parsed !== null && parsed !== undefined) {
            return { value: parsed, sourceChapterNumber: null }
          }
        }
        return null
      }
      // 指定 chapter 模式: 只看该章
      for (const bs of states) {
        if (bs.fromChapterNumber !== viewChapterNumber) continue
        const raw = bs[fieldName]
        if (raw === null || raw === undefined || raw === '') return null
        const parsed = safeJsonParse<Record<string, any> | null>(raw, null)
        if (parsed !== null && parsed !== undefined) {
          return { value: parsed, sourceChapterNumber: bs.fromChapterNumber }
        }
        return null
      }
      return null
    }

    const pickText = (): FieldDisplay<string> | null => {
      if (viewChapterNumber === null) {
        for (const bs of states) {
          if (bs.fromChapterNumber === null) continue
          if (bs.costume && bs.costume.trim()) {
            return { value: bs.costume, sourceChapterNumber: bs.fromChapterNumber }
          }
        }
        return null
      }
      for (const bs of states) {
        if (bs.fromChapterNumber !== viewChapterNumber) continue
        if (bs.costume && bs.costume.trim()) {
          return { value: bs.costume, sourceChapterNumber: bs.fromChapterNumber }
        }
        return null
      }
      return null
    }

    return {
      id: c.id,
      name: c.name,
      slug: c.slug,
      protagonist: c.protagonist ?? false,
      identity: safeJsonParse(c.identity, []),
      appearance: safeJsonParse(c.appearance, []),
      temperament: safeJsonParse(c.temperament, []),
      personality: safeJsonParse(c.personality, []),
      speechStyle: safeJsonParse(c.speechStyle, []),
      relationships: pickJson('relationships', c.relationships),
      status: pickJson('status', c.status),
      baseRelationships: safeJsonParse<Record<string, any> | null>(c.relationships, null),
      baseStatus: safeJsonParse<Record<string, any> | null>(c.status, null),
      costume: pickText()
    }
  })
}
