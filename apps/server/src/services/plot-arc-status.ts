export type PlotArcStatus = 'active' | 'inactive' | 'completed' | 'closed'

export interface PlotArcStatusInput {
  closedBy: string | null
  /** 最新推进点（chapterNumber 最大）*/
  latestPoint: { chapterNumber: number; isEnd: boolean } | null
  firstChapterNumber: number
  currentChapter: number
}

/**
 * 剧情弧线状态推导（纯函数）。
 *
 * - closedBy 有值 → closed（终态，优先）
 * - 最新推进点 isEnd 且 >5 章无更新 → completed（AI 软判断 + 代码硬验证）
 * - >5 章无更新（无 isEnd）→ inactive
 * - 否则 → active
 *
 * 「完成」与「待激活」都是「5 章无更新」，唯一区别是「最新推进点有没有 isEnd」。
 */
export function derivePlotArcStatus(input: PlotArcStatusInput): PlotArcStatus {
  if (input.closedBy) return 'closed'
  const refChapter = input.latestPoint?.chapterNumber ?? input.firstChapterNumber
  const isEnd = input.latestPoint?.isEnd ?? false
  if (isEnd && input.currentChapter - refChapter > 5) return 'completed'
  if (input.currentChapter - refChapter > 5) return 'inactive'
  return 'active'
}
