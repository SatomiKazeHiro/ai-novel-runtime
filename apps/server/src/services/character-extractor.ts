import type { CharacterStateRow } from './stages/character-stage.js'

/**
 * 在事务中提交角色分支状态写入 (P0 fix: 修 v3 archive 不写 CharacterBranchState 表)
 *
 * 数据来源: character-stage 输出 characterStates[], AI 给出本章结束时
 * 每个 matched character 的 status / relationships JSON 字符串。
 *
 * 这里只负责把 writes 落到 CharacterBranchState 表:
 * - isNew=false + characterId 有效 → create 新 branchState 行, fromChapterNumber=本章号
 * - isNew=true 或 characterId=null/空 → 跳过 (Character 是手动 CRUD 模型,
 *   AI 抽到新角色没有 Character 行可挂 branchState, 静默跳过 + 一行 log 让用户可见)
 *
 * 失败行为: 任一 create 抛错 → 异常向上冒泡, $transaction rollback,
 * 章节保持 reviewing, 用户可重试。
 */
export async function commitCharacterBranchStateWrites(
  tx: any,
  chapterNumber: number,
  writes: CharacterStateRow[],
  log?: { info: (msg: string) => void }
): Promise<void> {
  const safeLog = log ?? { info: (msg: string) => console.log(msg) }
  for (const w of writes) {
    if (w.isNew || !w.characterId) {
      // Character 表里没有这个角色 (isNew=true 或 characterId=null/空),
      // 没法挂 branchState。静默跳过 + 一行 info log。
      // 不抛错: 用户可能在 reviewing 阶段手动删过 Character, 不该阻塞归档。
      safeLog.info(
        `[CharacterBranchState] skip isNew character: ${w.name} (no Character row to attach)`
      )
      continue
    }
    await tx.characterBranchState.create({
      data: {
        characterId: w.characterId,
        fromChapterNumber: chapterNumber,
        status: w.status,
        relationships: w.relationships
      }
    })
  }
}
