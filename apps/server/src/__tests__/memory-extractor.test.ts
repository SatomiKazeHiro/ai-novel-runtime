import { describe, it, expect, vi, beforeEach } from 'vitest'
import { prepareMemoryWrites, type MemoryExtractionResult } from '../services/memory-extractor.js'

/**
 * prepareMemoryWrites — importance clamp 兜底
 *
 * 背景: 2026-06-26 用户故事 9f5c... 的章节归档, AI 在 mainEvents[*].importance
 * 返回 -1 (原因: prompt 里出现"严禁 -1"提示, LLM 反而把 -1 当成占位符用)。
 * prompt 那一句已回滚并改成正向范围约束, 但代码层还需要兜底:
 * AI 即使再抽风返回 -1 / 0 / 11 / NaN, prepareMemoryWrites 也要写出合法范围。
 *
 * 范围约定:
 *   - events (mainEvents / sideEvents): prompt 期望 5-8 (主角+1 后),
 *     但 schema 允许 1-10; clamp 时 <1 → 5, >10 → 10
 *   - scenes: prompt 期望 7-10 (核心) / 4-6 (中等) / 1-3 (路人); 同样 <1→5, >10→10
 *   - emotions/foreshadowing/relationships/characterStatusChanges: 代码硬编码
 *     5/5/5/8, 不走 clamp 路径 (但万一未来改成 AI 给值, 也要兜底)
 *
 * 设计: sanitizeImportance 是纯函数, prepareMemoryWrites 在写入前调一次。
 */

const STORY_ID = 'story-1'
const CHAPTER_ID = 'chapter-1'

function buildExtraction(overrides: Partial<MemoryExtractionResult> = {}): MemoryExtractionResult {
  return {
    mainEvents: [],
    sideEvents: [],
    emotions: [],
    foreshadowing: [],
    relationshipChanges: [],
    characterStatusChanges: {},
    timelineDay: null,
    summary: '',
    scenes: [],
    ...overrides
  }
}

describe('sanitizeImportance (implicit via prepareMemoryWrites)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('mainEvents.importance = -1 → 写出 5 (prompt 默认值, 替代非法 -1)', () => {
    const result = buildExtraction({
      mainEvents: [{ description: 'd', participants: ['p'], importance: -1 }]
    })
    const out = prepareMemoryWrites(STORY_ID, CHAPTER_ID, result, 1)
    expect(out.memories).toHaveLength(1)
    expect(out.memories[0].importance).toBe(5)
  })

  it('mainEvents.importance = 0 → 写出 5 (0 是无效下界)', () => {
    const result = buildExtraction({
      mainEvents: [{ description: 'd', participants: ['p'], importance: 0 }]
    })
    const out = prepareMemoryWrites(STORY_ID, CHAPTER_ID, result, 1)
    expect(out.memories[0].importance).toBe(5)
  })

  it('mainEvents.importance = 11 → 写出 10 (上限截断)', () => {
    const result = buildExtraction({
      mainEvents: [{ description: 'd', participants: ['p'], importance: 11 }]
    })
    const out = prepareMemoryWrites(STORY_ID, CHAPTER_ID, result, 1)
    expect(out.memories[0].importance).toBe(10)
  })

  it('mainEvents.importance = NaN → 写出 5 (非数字 fallback)', () => {
    const result = buildExtraction({
      mainEvents: [{ description: 'd', participants: ['p'], importance: NaN }]
    })
    const out = prepareMemoryWrites(STORY_ID, CHAPTER_ID, result, 1)
    expect(out.memories[0].importance).toBe(5)
  })

  it('mainEvents.importance = 6 (合法范围) → 保留 6 (不破坏)', () => {
    const result = buildExtraction({
      mainEvents: [{ description: 'd', participants: ['p'], importance: 6 }]
    })
    const out = prepareMemoryWrites(STORY_ID, CHAPTER_ID, result, 1)
    expect(out.memories[0].importance).toBe(6)
  })

  it('mainEvents.importance = 1 (边界合法) → 保留 1', () => {
    const result = buildExtraction({
      mainEvents: [{ description: 'd', participants: ['p'], importance: 1 }]
    })
    const out = prepareMemoryWrites(STORY_ID, CHAPTER_ID, result, 1)
    expect(out.memories[0].importance).toBe(1)
  })

  it('mainEvents.importance = 10 (边界合法) → 保留 10', () => {
    const result = buildExtraction({
      mainEvents: [{ description: 'd', participants: ['p'], importance: 10 }]
    })
    const out = prepareMemoryWrites(STORY_ID, CHAPTER_ID, result, 1)
    expect(out.memories[0].importance).toBe(10)
  })
})

describe('prepareMemoryWrites — clamp 覆盖到所有 AI 控制的 importance 字段', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('sideEvents.importance = -1 → clamp 到 5', () => {
    const result = buildExtraction({
      sideEvents: [{ description: 'd', participants: ['p'], importance: -1 }]
    })
    const out = prepareMemoryWrites(STORY_ID, CHAPTER_ID, result, 1)
    expect(out.memories).toHaveLength(1)
    expect(out.memories[0].importance).toBe(5)
  })

  it('scenes.importance = 0 → clamp 到 5 (scene 兜底, 避免 0 进库)', () => {
    const result = buildExtraction({
      scenes: [{ location: 'L', event: 'E', importance: 0 }]
    })
    const out = prepareMemoryWrites(STORY_ID, CHAPTER_ID, result, 1)
    expect(out.memories[0].importance).toBe(5)
  })

  it('scenes.importance = 6 (合法) → 保留 6', () => {
    const result = buildExtraction({
      scenes: [{ location: 'L', event: 'E', importance: 6 }]
    })
    const out = prepareMemoryWrites(STORY_ID, CHAPTER_ID, result, 1)
    expect(out.memories[0].importance).toBe(6)
  })

  it('混合: mainEvents -1 + sideEvents 0 + scenes 11 一起 clamp', () => {
    const result = buildExtraction({
      mainEvents: [
        { description: 'm1', participants: ['p'], importance: -1 },
        { description: 'm2', participants: ['p'], importance: 8 }
      ],
      sideEvents: [{ description: 's1', participants: ['p'], importance: 0 }],
      scenes: [{ location: 'L', event: 'E', importance: 11 }]
    })
    const out = prepareMemoryWrites(STORY_ID, CHAPTER_ID, result, 1)
    const importances = out.memories.map(m => m.importance)
    expect(importances).toEqual([5, 8, 5, 10])
  })
})

describe('prepareMemoryWrites — emotions/foreshadowing/relationships/characterStatus 保持硬编码 (不破坏)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('emotions / foreshadowing / relationships 硬编码 5 (AI 无权设置)', () => {
    const result = buildExtraction({
      emotions: ['e1', 'e2'],
      foreshadowing: ['f1'],
      relationshipChanges: ['r1', 'r2', 'r3']
    })
    const out = prepareMemoryWrites(STORY_ID, CHAPTER_ID, result, 1)
    expect(out.memories).toHaveLength(6)
    expect(out.memories.every(m => m.importance === 5)).toBe(true)
  })

  it('characterStatusChanges 硬编码 8', () => {
    const result = buildExtraction({
      characterStatusChanges: {
        '李凡': { rank: '筑基' }
      }
    })
    const out = prepareMemoryWrites(STORY_ID, CHAPTER_ID, result, 1)
    expect(out.memories).toHaveLength(1)
    expect(out.memories[0].importance).toBe(8)
  })
})

describe('prepareMemoryWrites — timelineDay 正常通路', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('timelineDay 数字 → 进入 timelineEvents (commit 写入 TimelineEvent 表)', () => {
    const result = buildExtraction({
      timelineDay: 7
    })
    const out = prepareMemoryWrites(STORY_ID, CHAPTER_ID, result, 1)
    expect(out.timelineEvents).toHaveLength(1)
    expect(out.timelineEvents[0].day).toBe(7)
  })

  it('timelineDay = null → 不产生 timelineEvents (commit 跳过 TimelineEvent 写入)', () => {
    const result = buildExtraction({
      timelineDay: null
    })
    const out = prepareMemoryWrites(STORY_ID, CHAPTER_ID, result, 1)
    expect(out.timelineEvents).toEqual([])
  })
})
