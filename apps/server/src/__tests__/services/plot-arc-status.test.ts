import { describe, it, expect } from 'vitest'
import { derivePlotArcStatus } from '../../services/plot-arc-status.js'

describe('derivePlotArcStatus', () => {
  it('closedBy 有值 → closed（优先）', () => {
    const s = derivePlotArcStatus({
      closedBy: 'user', latestPoint: { chapterNumber: 3, isEnd: false },
      firstChapterNumber: 1, currentChapter: 10
    })
    expect(s).toBe('closed')
  })

  it('最新推进点 isEnd 且 >5 章无更新 → completed', () => {
    const s = derivePlotArcStatus({
      closedBy: null, latestPoint: { chapterNumber: 3, isEnd: true },
      firstChapterNumber: 1, currentChapter: 10
    })
    expect(s).toBe('completed')
  })

  it('无 isEnd 且 >5 章无更新 → inactive', () => {
    const s = derivePlotArcStatus({
      closedBy: null, latestPoint: { chapterNumber: 3, isEnd: false },
      firstChapterNumber: 1, currentChapter: 10
    })
    expect(s).toBe('inactive')
  })

  it('5 章内有更新 → active', () => {
    const s = derivePlotArcStatus({
      closedBy: null, latestPoint: { chapterNumber: 8, isEnd: false },
      firstChapterNumber: 1, currentChapter: 10
    })
    expect(s).toBe('active')
  })

  it('isEnd 但 5 章内又有更新（AI 误判）→ 仍 active', () => {
    const s = derivePlotArcStatus({
      closedBy: null, latestPoint: { chapterNumber: 8, isEnd: true },
      firstChapterNumber: 1, currentChapter: 10
    })
    expect(s).toBe('active')
  })

  it('无推进点 → 用 firstChapterNumber 兜底', () => {
    const s = derivePlotArcStatus({
      closedBy: null, latestPoint: null,
      firstChapterNumber: 2, currentChapter: 10
    })
    expect(s).toBe('inactive')
  })
})
