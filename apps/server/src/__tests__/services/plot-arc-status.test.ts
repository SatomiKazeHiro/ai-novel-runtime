import { describe, it, expect } from 'vitest'
import { derivePlotArcStatus, RECENT_END_WINDOW } from '../../services/plot-arc-status.js'

describe('derivePlotArcStatus', () => {
  it('closedBy 有值 → closed（优先）', () => {
    const s = derivePlotArcStatus({
      closedBy: 'user', latestPoint: { chapterNumber: 3, isEnd: false },
      recentIsEnd: false,
      firstChapterNumber: 1, currentChapter: 10
    })
    expect(s).toBe('closed')
  })

  it('最近窗口内存在 isEnd 且 >5 章无更新 → completed', () => {
    const s = derivePlotArcStatus({
      closedBy: null, latestPoint: { chapterNumber: 3, isEnd: false },
      recentIsEnd: true, // 最近 5 个推进点内有 isEnd（虽最新一条不是）
      firstChapterNumber: 1, currentChapter: 10
    })
    expect(s).toBe('completed')
  })

  it('窗口内无 isEnd 且 >5 章无更新 → inactive', () => {
    const s = derivePlotArcStatus({
      closedBy: null, latestPoint: { chapterNumber: 3, isEnd: false },
      recentIsEnd: false,
      firstChapterNumber: 1, currentChapter: 10
    })
    expect(s).toBe('inactive')
  })

  it('5 章内有更新 → active', () => {
    const s = derivePlotArcStatus({
      closedBy: null, latestPoint: { chapterNumber: 8, isEnd: false },
      recentIsEnd: false,
      firstChapterNumber: 1, currentChapter: 10
    })
    expect(s).toBe('active')
  })

  it('窗口内 isEnd 但 5 章内又有更新 → 仍 active', () => {
    const s = derivePlotArcStatus({
      closedBy: null, latestPoint: { chapterNumber: 8, isEnd: true },
      recentIsEnd: true,
      firstChapterNumber: 1, currentChapter: 10
    })
    expect(s).toBe('active')
  })

  it('无推进点 → 用 firstChapterNumber 兜底', () => {
    const s = derivePlotArcStatus({
      closedBy: null, latestPoint: null,
      recentIsEnd: false,
      firstChapterNumber: 2, currentChapter: 10
    })
    expect(s).toBe('inactive')
  })

  it('RECENT_END_WINDOW 常量存在（窗口大小）', () => {
    expect(RECENT_END_WINDOW).toBe(5)
  })
})
