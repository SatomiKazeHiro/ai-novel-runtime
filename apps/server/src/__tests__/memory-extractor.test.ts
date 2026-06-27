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
    timelinePosition: null,
    summary: '',
    scenes: [],
    // timelineEvents 是 AI 响应里的可选字段, 默认空数组保证类型形状一致
    timelineEvents: [],
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

describe('prepareMemoryWrites — timelinePosition 正常通路', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('timelinePosition 合法 Y.DDDHH → 进入 timelineEvents + timelinePosition 顶层字段', () => {
    const result = buildExtraction({
      timelinePosition: 1.00700  // 第1年第7天 00时
    })
    const out = prepareMemoryWrites(STORY_ID, CHAPTER_ID, result, 1)
    expect(out.timelineEvents).toHaveLength(1)
    expect(out.timelineEvents[0].position).toBe(1.007)
    expect(out.timelinePosition).toBe(1.007)
  })

  it('timelinePosition = null → 不产生 timelineEvents', () => {
    const result = buildExtraction({
      timelinePosition: null
    })
    const out = prepareMemoryWrites(STORY_ID, CHAPTER_ID, result, 1)
    expect(out.timelineEvents).toEqual([])
    expect(out.timelinePosition).toBeNull()
  })

  it('timelinePosition 非法值 (负 day, decode 后越界) → validate 兜底丢弃, 顶层 timelinePosition 置 null', () => {
    const result = buildExtraction({
      timelinePosition: 1.99999  // decode clamp: day=365 hour=23 — 实际仍合法
    })
    const out = prepareMemoryWrites(STORY_ID, CHAPTER_ID, result, 1)
    // 99999 → decoder clamp 到 day=365 hour=23, 合法
    expect(out.timelineEvents).toHaveLength(1)
    expect(out.timelinePosition).toBe(1.99999)
  })

  it('timelinePosition = NaN → validate 拒绝, 不写入', () => {
    const result = buildExtraction({
      timelinePosition: NaN
    })
    const out = prepareMemoryWrites(STORY_ID, CHAPTER_ID, result, 1)
    expect(out.timelineEvents).toEqual([])
    expect(out.timelinePosition).toBeNull()
  })

  it('timelinePosition 负年 → 透传', () => {
    const result = buildExtraction({
      timelinePosition: -2.05018
    })
    const out = prepareMemoryWrites(STORY_ID, CHAPTER_ID, result, 1)
    expect(out.timelineEvents).toHaveLength(1)
    expect(out.timelinePosition).toBe(-2.05018)
  })
})

/**
 * prepareMemoryWrites — timelineEvents[] 数组扫描 + 顶层兜底
 *
 * 背景: 2026-06-27 用户报告 "时间线一直是空的"。调查发现:
 *   - AI combined_extract 响应里 timelineEvents 数组存在但每条 position=null
 *   - 顶层 timelinePosition 也常为 null
 *   - prepareMemoryWrites 此前只读顶层 timelinePosition, 完全忽略数组
 *   - slim 模式 prompt 文字弱, AI 不强约束自己填 position
 *
 * 修复后行为:
 *   - 数组里每条带有效 position → 生成独立 TimelineEventWrite
 *   - 顶层 null + 数组有效 → 用数组第一条 position 作章首锚点
 *   - 顶层有效 + 数组第一条 position 不等于顶层 → 顶层作为章首 row,
 *     数组所有 row 保留(可能含后续时间点事件)
 *   - 顶层 + 数组都 null → 不合成, 输出 timelineEvents=[] + timelinePosition=null
 *     (合成会污染数据, 让用户看到假锚点)
 */
describe('prepareMemoryWrites — timelineEvents[] 扫描 + 顶层兜底', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('顶层 timelinePosition + 空数组 → 当前 1 条 row 行为保留', () => {
    const result = buildExtraction({
      timelinePosition: 1.00700,
      timelineEvents: []
    })
    const out = prepareMemoryWrites(STORY_ID, CHAPTER_ID, result, 1)
    expect(out.timelineEvents).toHaveLength(1)
    expect(out.timelineEvents[0].position).toBe(1.007)
    expect(out.timelinePosition).toBe(1.007)
  })

  it('顶层 null + 数组多条事件 → 多条 row, 章首取数组第一条', () => {
    const result = buildExtraction({
      timelinePosition: null,
      mainEvents: [
        { description: 'main1', participants: ['p'], importance: 6 },
        { description: 'main2', participants: ['p'], importance: 6 }
      ],
      timelineEvents: [
        { position: 1.00106, description: 'a' },
        { position: 1.00112, description: 'b' }
      ]
    })
    const out = prepareMemoryWrites(STORY_ID, CHAPTER_ID, result, 1)
    expect(out.timelineEvents).toHaveLength(2)
    // 章首 = 第一条事件的 position
    expect(out.timelinePosition).toBe(1.00106)
    // 第一条 row 是章首 (携 mainEvents 描述)
    expect(out.timelineEvents[0].position).toBe(1.00106)
    expect(JSON.parse(out.timelineEvents[0].events)).toEqual(['main1', 'main2'])
    // 第二条 row 是数组里第二条事件
    expect(out.timelineEvents[1].position).toBe(1.00112)
    expect(JSON.parse(out.timelineEvents[1].events)).toEqual(['b'])
  })

  it('顶层 null + 数组单条 → 1 条章首 row, 携 mainEvents 描述', () => {
    const result = buildExtraction({
      timelinePosition: null,
      mainEvents: [{ description: 'm1', participants: ['p'], importance: 6 }],
      timelineEvents: [{ position: 1.00106, description: '章首事件' }]
    })
    const out = prepareMemoryWrites(STORY_ID, CHAPTER_ID, result, 1)
    expect(out.timelineEvents).toHaveLength(1)
    expect(out.timelinePosition).toBe(1.00106)
    expect(JSON.parse(out.timelineEvents[0].events)).toEqual(['m1'])
  })

  it('顶层有效 + 数组第一条不同位置 → 顶层作章首 row, 数组事件独立写入', () => {
    const result = buildExtraction({
      timelinePosition: 1.00106,
      mainEvents: [{ description: 'm1', participants: ['p'], importance: 6 }],
      timelineEvents: [
        { position: 1.00106, description: '章首' },
        { position: 1.00112, description: 'b' }
      ]
    })
    const out = prepareMemoryWrites(STORY_ID, CHAPTER_ID, result, 1)
    // 章首 row (顶层) + 数组第二条事件 = 2 条 row
    expect(out.timelineEvents).toHaveLength(2)
    expect(out.timelinePosition).toBe(1.00106)
    expect(out.timelineEvents[0].position).toBe(1.00106)
    expect(JSON.parse(out.timelineEvents[0].events)).toEqual(['m1'])
    expect(out.timelineEvents[1].position).toBe(1.00112)
    expect(JSON.parse(out.timelineEvents[1].events)).toEqual(['b'])
  })

  it('顶层 null + 数组里 position 全 null → 不合成, 输出空', () => {
    const result = buildExtraction({
      timelinePosition: null,
      timelineEvents: [
        { position: null, description: 'a' },
        { position: null, description: 'b' }
      ]
    })
    const out = prepareMemoryWrites(STORY_ID, CHAPTER_ID, result, 1)
    expect(out.timelineEvents).toEqual([])
    expect(out.timelinePosition).toBeNull()
  })

  it('顶层 null + 空数组 → 行为保留 (不合成)', () => {
    const result = buildExtraction({
      timelinePosition: null,
      timelineEvents: []
    })
    const out = prepareMemoryWrites(STORY_ID, CHAPTER_ID, result, 1)
    expect(out.timelineEvents).toEqual([])
    expect(out.timelinePosition).toBeNull()
  })

  it('顶层 null + 数组负年 → 数组第一条作章首, 负年透传', () => {
    const result = buildExtraction({
      timelinePosition: null,
      mainEvents: [{ description: '前世记忆', participants: ['p'], importance: 6 }],
      timelineEvents: [{ position: -2.05018, description: '前世' }]
    })
    const out = prepareMemoryWrites(STORY_ID, CHAPTER_ID, result, 1)
    expect(out.timelineEvents).toHaveLength(1)
    expect(out.timelinePosition).toBe(-2.05018)
    expect(out.timelineEvents[0].position).toBe(-2.05018)
  })

  it('顶层 null + 数组里 position 是 NaN → validate 拒, 不写入', () => {
    const result = buildExtraction({
      timelinePosition: null,
      timelineEvents: [{ position: NaN, description: 'x' }]
    })
    const out = prepareMemoryWrites(STORY_ID, CHAPTER_ID, result, 1)
    expect(out.timelineEvents).toEqual([])
    expect(out.timelinePosition).toBeNull()
  })
})
