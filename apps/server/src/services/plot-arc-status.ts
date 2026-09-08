export type PlotArcStatus = 'active' | 'inactive' | 'completed' | 'closed'

/** 「最近 N 个推进点内存在 isEnd」的软判断粘滞窗口 */
export const RECENT_END_WINDOW = 5

export interface PlotArcStatusInput {
  closedBy: string | null
  /** 最新推进点（chapterNumber 最大），用于算「最近 5 章无更新」的 refChapter */
  latestPoint: { chapterNumber: number; isEnd: boolean } | null
  /** 最近 RECENT_END_WINDOW 个推进点里是否存在 isEnd=true（调用方从 progressPoints.slice(0,N) 算出） */
  recentIsEnd: boolean
  firstChapterNumber: number
  currentChapter: number
}

/**
 * 剧情弧线状态推导（纯函数）。
 *
 * - closedBy 有值 → closed（终态，优先）
 * - 最近 RECENT_END_WINDOW 个推进点内存在 isEnd 且 >5 章无更新 → completed
 *   （AI 软判断不要求「最后一次」恰好标 isEnd，允许窗口内粘滞，避免 AI 漏标导致永远无法 completed）
 * - >5 章无更新（窗口内无 isEnd）→ inactive
 * - 否则 → active
 *
 * 「完成」与「待激活」都是「5 章无更新」，唯一区别是「最近窗口内有没有 isEnd」。
 */
export function derivePlotArcStatus(input: PlotArcStatusInput): PlotArcStatus {
  if (input.closedBy) return 'closed'
  const refChapter = input.latestPoint?.chapterNumber ?? input.firstChapterNumber
  const isEnd = input.recentIsEnd
  if (isEnd && input.currentChapter - refChapter > 5) return 'completed'
  if (input.currentChapter - refChapter > 5) return 'inactive'
  return 'active'
}
