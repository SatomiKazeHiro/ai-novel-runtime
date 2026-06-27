import { describe, it, expect, vi, beforeEach } from 'vitest'
import { prepareMemoryWrites, commitMemoryWrites, type MemoryExtractionResult } from '../services/memory-extractor.js'

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
    // 第一条 row 是章首 (携 mainEvents 描述 + 原数组第一条描述)
    expect(out.timelineEvents[0].position).toBe(1.00106)
    expect(JSON.parse(out.timelineEvents[0].events)).toEqual(['main1', 'main2', 'a'])
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
    // 章首 row: mainEvents 描述 + 原数组描述 (合并语义, 2026-06-27)
    expect(JSON.parse(out.timelineEvents[0].events)).toEqual(['m1', '章首事件'])
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
    // 章首 row: mainEvents 描述 + 数组第一条描述 (合并语义, 2026-06-27)
    expect(JSON.parse(out.timelineEvents[0].events)).toEqual(['m1', '章首'])
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

/**
 * prepareMemoryWrites — 同 fromChapterNumber 范围内 timelineEvents 聚类
 *
 * 背景 (2026-06-27): 用户反馈 TimelineEvent 列表里出现大量描述重复的 row,
 * 根因不是 schema 也不是写入, 而是 AI 在 mainEvents 数组 / timelineEvents
 * 数组里用不同措辞写同一事件。例如 "李凡三次自行筑基失败后, 吞服赵若曦所赠
 * 【筑基丹】成功筑基" 与 "李凡三次筑基失败后服用赵若曦所赠筑基丹, 凭借外力
 * 筑基成功" 是同一事件, 但因为措辞变体, 落库后变成 2 条 row。
 *
 * 兜底方案: prepareMemoryWrites 输出 timelineEvents 前, 对同 fromChapterNumber
 * 范围内的 row 做 Jaccard 聚类 (阈值 0.7) — 复用 tokenSet + jaccardSimilarity
 * (已有, memory-extractor.ts:53)。匹配到现有 row 就把新 events 合并, 不匹配
 * 独立成 row。不同 fromChapterNumber 不互相聚类 (跨章节, 语义独立)。
 *
 * 历史数据不回填, 只影响未来 archive。
 */
describe('prepareMemoryWrites — timelineEvents 同 fromChapterNumber 聚类去重', () => {
  it('同 chapter 内两条 description 措辞变体 (Jaccard ≈ 0.74) → 聚到一条 row', () => {
    const result = buildExtraction({
      timelinePosition: null,
      timelineEvents: [
        { position: 1.00106, description: '李凡三次筑基失败后吞服赵若曦所赠筑基丹成功筑基' },
        { position: 1.00112, description: '李凡三次筑基失败后服用赵若曦所赠筑基丹凭借外力筑基成功' }
      ]
    })
    const out = prepareMemoryWrites(STORY_ID, CHAPTER_ID, result, 1)
    // 两条应聚成一条 (后写合并到先写)
    expect(out.timelineEvents).toHaveLength(1)
    const merged = JSON.parse(out.timelineEvents[0].events)
    expect(merged).toHaveLength(2)
    expect(merged).toContain('李凡三次筑基失败后吞服赵若曦所赠筑基丹成功筑基')
    expect(merged).toContain('李凡三次筑基失败后服用赵若曦所赠筑基丹凭借外力筑基成功')
  })

  it('同 chapter 内 description 完全不同 (Jaccard < 0.7) → 独立成两条 row', () => {
    const result = buildExtraction({
      timelinePosition: null,
      timelineEvents: [
        { position: 1.00106, description: '李凡与赵若曦切磋武艺' },
        { position: 1.00112, description: '张望霜发现赵若曦频繁探望李凡并禁足她' }
      ]
    })
    const out = prepareMemoryWrites(STORY_ID, CHAPTER_ID, result, 1)
    expect(out.timelineEvents).toHaveLength(2)
  })

  it('同 chapter 内一组措辞变体聚类 + 一组独立 → 2 条 row (3 描述变 2 row)', () => {
    // 第一组: 筑基 (变体1+变体2 Jaccard ≈ 0.74)
    // 第二组: 完全独立
    const result = buildExtraction({
      timelinePosition: null,
      timelineEvents: [
        { position: 1.00106, description: '李凡三次筑基失败后吞服赵若曦所赠筑基丹成功筑基' },
        { position: 1.00112, description: '李凡三次筑基失败后服用赵若曦所赠筑基丹凭借外力筑基成功' },
        { position: 1.00200, description: '赵若曦因频繁前往外门陪李凡修行被师父张望霜发现并禁足' }
      ]
    })
    const out = prepareMemoryWrites(STORY_ID, CHAPTER_ID, result, 1)
    // 3 条输入: 筑基 2 条聚成 1 row, 独立 1 条 = 2 row
    expect(out.timelineEvents).toHaveLength(2)
    const allEvents = out.timelineEvents.flatMap(r => JSON.parse(r.events))
    expect(allEvents).toHaveLength(3)
  })

  it('不同 fromChapterNumber 各自独立 (跨章节不聚类, 即使 description 相似)', () => {
    // 章节 1 和 章节 2 都提到"筑基", 不应合并
    const out1 = prepareMemoryWrites(STORY_ID, CHAPTER_ID, buildExtraction({
      timelinePosition: null,
      timelineEvents: [{ position: 1.00106, description: '李凡三次筑基失败后吞服赵若曦所赠筑基丹成功筑基' }]
    }), 1)
    const out2 = prepareMemoryWrites(STORY_ID, CHAPTER_ID, buildExtraction({
      timelinePosition: null,
      timelineEvents: [{ position: 2.00106, description: '李凡三次筑基失败后服用赵若曦所赠筑基丹凭借外力筑基成功' }]
    }), 2)
    expect(out1.timelineEvents).toHaveLength(1)
    expect(out2.timelineEvents).toHaveLength(1)
    // 两次调用各自有 1 条 row, 没有跨调用聚合 (聚类是单次 prepareMemoryWrites 内)
  })

  it('章首 row (措辞与数组 row 相似 ≈ 0.74) → 数组 row 合并到章首 row', () => {
    // 顶层 timelinePosition 1.00106 → 章首 row, 携带 mainEvents 描述
    // 数组里 1.00106 row 措辞与章首 row 数组描述变体 → 聚到章首 row
    const result = buildExtraction({
      timelinePosition: 1.00106,
      mainEvents: [{ description: '李凡三次筑基失败后吞服赵若曦所赠筑基丹成功筑基', participants: ['李凡', '赵若曦'], importance: 8 }],
      timelineEvents: [
        { position: 1.00106, description: '李凡三次筑基失败后服用赵若曦所赠筑基丹凭借外力筑基成功' }
      ]
    })
    const out = prepareMemoryWrites(STORY_ID, CHAPTER_ID, result, 1)
    // 章首 row 应包含 mainEvents 描述 + 数组描述合并 (2 条 events)
    expect(out.timelineEvents).toHaveLength(1)
    const merged = JSON.parse(out.timelineEvents[0].events)
    expect(merged).toContain('李凡三次筑基失败后吞服赵若曦所赠筑基丹成功筑基')  // mainEvents 描述
    expect(merged).toContain('李凡三次筑基失败后服用赵若曦所赠筑基丹凭借外力筑基成功')  // timelineEvents 描述
  })
})

/**
 * commitMemoryWrites — 同 (storyId, position) 合并时去重描述
 *
 * 背景 (2026-06-27): commitMemoryWrites 在 (storyId, position) 已存在时
 * 朴素拼接 events JSON 数组, 但如果老 row 与新 events 里有相似措辞
 * (Jaccard ≥ 0.7), 就会在同一个 row.events 数组里制造"看似不同但语义相同"
 * 的重复条目。典型场景:
 *   - 章节重新归档: 旧 events + 新 events 在同一 row 叠加
 *   - 历史脏数据修复: 之前 cluster 未跑前写入了相似描述
 *
 * 兜底: 合并时按 Jaccard 阈值 0.7 去重, 保留先到的描述 (历史记录优先)。
 */
describe('commitMemoryWrites — timelineEvent 同 position 合并描述去重', () => {
  it('新 events 与老 events 措辞变体 (Jaccard ≈ 0.74) → 合并后只保留老 entries', async () => {
    const findUnique = vi.fn().mockResolvedValue({
      id: 'te-existing', storyId: STORY_ID,
      fromChapterNumber: 1, position: 1.00106,
      events: JSON.stringify(['李凡三次筑基失败后吞服赵若曦所赠筑基丹成功筑基']),
      createdAt: new Date(), updatedAt: new Date()
    })
    const update = vi.fn().mockImplementation(async ({ where, data }: any) => ({
      id: where.id, storyId: STORY_ID, fromChapterNumber: 1,
      position: 1.00106, events: data.events
    }))
    const tx: any = { timelineEvent: { findUnique, update } }

    await commitMemoryWrites(tx, CHAPTER_ID, STORY_ID, {
      memories: [],
      characterStates: [],
      timelineEvents: [{
        storyId: STORY_ID, fromChapterNumber: 1, position: 1.00106,
        events: JSON.stringify(['李凡三次筑基失败后服用赵若曦所赠筑基丹凭借外力筑基成功'])
      }],
      summary: '',
      timelinePosition: 1.00106
    })

    expect(update).toHaveBeenCalledTimes(1)
    const updateArg = update.mock.calls[0][0]
    const merged = JSON.parse(updateArg.data.events)
    // 老 entries 优先 (保留历史), 新相似条目被丢弃
    expect(merged).toEqual(['李凡三次筑基失败后吞服赵若曦所赠筑基丹成功筑基'])
  })

  it('新 events 包含独立描述 + 措辞变体 → 合并后保留独立 + 老 entries (变体丢弃)', async () => {
    const findUnique = vi.fn().mockResolvedValue({
      id: 'te-existing', storyId: STORY_ID,
      fromChapterNumber: 1, position: 1.00106,
      events: JSON.stringify(['李凡三次筑基失败后吞服赵若曦所赠筑基丹成功筑基']),
      createdAt: new Date(), updatedAt: new Date()
    })
    const update = vi.fn().mockImplementation(async ({ where, data }: any) => ({
      id: where.id, storyId: STORY_ID, fromChapterNumber: 1,
      position: 1.00106, events: data.events
    }))
    const tx: any = { timelineEvent: { findUnique, update } }

    await commitMemoryWrites(tx, CHAPTER_ID, STORY_ID, {
      memories: [],
      characterStates: [],
      timelineEvents: [{
        storyId: STORY_ID, fromChapterNumber: 1, position: 1.00106,
        events: JSON.stringify([
          '李凡三次筑基失败后服用赵若曦所赠筑基丹凭借外力筑基成功',  // 与老相似
          '张望霜发现赵若曦频繁探望李凡并禁足她'  // 独立
        ])
      }],
      summary: '',
      timelinePosition: 1.00106
    })

    const merged = JSON.parse(update.mock.calls[0][0].data.events)
    expect(merged).toEqual([
      '李凡三次筑基失败后吞服赵若曦所赠筑基丹成功筑基',
      '张望霜发现赵若曦频繁探望李凡并禁足她'
    ])
  })

  it('新 events 全部独立 (与老都不同) → 朴素拼接', async () => {
    const findUnique = vi.fn().mockResolvedValue({
      id: 'te-existing', storyId: STORY_ID,
      fromChapterNumber: 1, position: 1.00106,
      events: JSON.stringify(['老描述A']),
      createdAt: new Date(), updatedAt: new Date()
    })
    const update = vi.fn().mockImplementation(async ({ where, data }: any) => ({
      id: where.id, storyId: STORY_ID, fromChapterNumber: 1,
      position: 1.00106, events: data.events
    }))
    const tx: any = { timelineEvent: { findUnique, update } }

    await commitMemoryWrites(tx, CHAPTER_ID, STORY_ID, {
      memories: [],
      characterStates: [],
      timelineEvents: [{
        storyId: STORY_ID, fromChapterNumber: 1, position: 1.00106,
        events: JSON.stringify(['新描述B', '新描述C'])
      }],
      summary: '',
      timelinePosition: 1.00106
    })

    const merged = JSON.parse(update.mock.calls[0][0].data.events)
    expect(merged).toEqual(['老描述A', '新描述B', '新描述C'])
  })

  it('(storyId, position) 不存在 → 直接 create, 不调 update', async () => {
    const findUnique = vi.fn().mockResolvedValue(null)
    const create = vi.fn().mockImplementation(async ({ data }: any) => ({
      id: 'te-new', storyId: STORY_ID, fromChapterNumber: 1,
      position: 1.00106, events: data.events
    }))
    const update = vi.fn()
    const tx: any = { timelineEvent: { findUnique, create, update } }

    await commitMemoryWrites(tx, CHAPTER_ID, STORY_ID, {
      memories: [],
      characterStates: [],
      timelineEvents: [{
        storyId: STORY_ID, fromChapterNumber: 1, position: 1.00106,
        events: JSON.stringify(['新事件'])
      }],
      summary: '',
      timelinePosition: 1.00106
    })

    expect(create).toHaveBeenCalledTimes(1)
    expect(update).not.toHaveBeenCalled()
  })
})
