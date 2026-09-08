import type { CharacterStateRow } from './stages/character-stage.js'

export interface ConflictInfo {
  writeIndex: number
  reason: 'missing_key' | 'slug_name_mismatch'
  existingCharacter?: { id: string; slug: string; name: string }
  aiWrite?: CharacterStateRow
}

export class ConflictError extends Error {
  constructor(public conflicts: ConflictInfo[]) {
    super(`character write conflict: ${conflicts.length} issues`)
    this.name = 'ConflictError'
  }
}

/**
 * Code-level slug+name 双匹配,把 AI 返回的 characterStates 解析为可写库的两类:
 * - effectiveWrites: 直接可入库的(已匹配现有角色或新角色待建档)
 * - conflicts: slug 命中但 name 不匹配(待 ReviewingPanel 纠正)或 key 缺失
 *
 * 该函数本身不写 DB;由调用方决定后续 commit 行为。
 */
export async function resolveAndCommitCharacterWrites(
  tx: any,
  storyId: string,
  chapterNumber: number,
  writes: CharacterStateRow[],
  allExistingCharacters: Array<{ id: string; slug: string; name: string }>,
  log?: { info: (msg: string) => void; warn: (msg: string) => void }
): Promise<{ effectiveWrites: CharacterStateRow[]; conflicts: ConflictInfo[] }> {
  const safeLog = log ?? { info: () => {}, warn: () => {} }
  const effectiveWrites: CharacterStateRow[] = []
  const conflicts: ConflictInfo[] = []

  for (let i = 0; i < writes.length; i++) {
    const w = writes[i]
    if (!w.key || !w.key.trim()) {
      conflicts.push({ writeIndex: i, reason: 'missing_key', aiWrite: w })
      continue
    }
    // 短路: ReviewingPanel 已纠正(characterId 非空 + isNew=false),信任前端选的 characterId,跳过 slug 校验
    if (w.characterId && !w.isNew) {
      effectiveWrites.push(w)
      continue
    }
    const existing = allExistingCharacters.find(c => c.slug === w.key)
    if (existing) {
      if (existing.name === w.name) {
        effectiveWrites.push({ ...w, characterId: existing.id, isNew: false })
      } else {
        conflicts.push({
          writeIndex: i,
          reason: 'slug_name_mismatch',
          existingCharacter: existing,
          aiWrite: w
        })
        safeLog.warn(
          `[CharacterResolve] slug conflict: AI returned name="${w.name}" for slug="${w.key}", but existing character has name="${existing.name}"`
        )
      }
    } else {
      effectiveWrites.push({ ...w, characterId: null, isNew: true })
    }
  }

  return { effectiveWrites, conflicts }
}

/**
 * 在事务中提交角色分支状态写入 + 自动建档 isNew 角色。
 *
 * 行为:
 * - isNew=false + characterId 有效 → 直接 create branchState 行
 * - isNew=true 或 characterId=null → 先 CREATE Character 行(slug=key, base 关系/状态 留空),
 *   再用新 characterId CREATE branchState 行
 * - costume 非空字符串才入库;空字符串/null 视同未描写
 *
 * 失败行为: 任一 create 抛错 → 异常向上冒泡, $transaction rollback,
 * 章节保持 reviewing, 用户可重试。
 */
export async function commitCharacterBranchStateWrites(
  tx: any,
  storyId: string,
  chapterNumber: number,
  writes: CharacterStateRow[],
  log?: { info: (msg: string) => void; warn: (msg: string) => void }
): Promise<void> {
  const safeLog = log ?? { info: () => {}, warn: () => {} }
  for (const w of writes) {
    let characterId = w.characterId
    if (w.isNew || !characterId) {
      // 自动建 Character 行: slug=key, base 关系/状态 留空
      const newChar = await tx.character.create({
        data: {
          storyId,
          slug: w.key,
          name: w.name,
          protagonist: false,
          personality: '[]',
          speechStyle: '[]',
          identity: '[]',
          appearance: '[]',
          temperament: '[]',
          relationships: null,
          status: null
        }
      })
      characterId = newChar.id
    }
    // status / relationships 边界序列化 (与 v3 P0 fix 一致)
    const statusValue = typeof w.status === 'string' ? w.status : JSON.stringify(w.status)
    const relationshipsValue = typeof w.relationships === 'string' ? w.relationships : JSON.stringify(w.relationships)
    const costumeValue = w.costume && w.costume.trim() ? w.costume : null
    await tx.characterBranchState.create({
      data: {
        characterId,
        fromChapterNumber: chapterNumber,
        status: statusValue,
        relationships: relationshipsValue,
        costume: costumeValue
      }
    })
  }
}