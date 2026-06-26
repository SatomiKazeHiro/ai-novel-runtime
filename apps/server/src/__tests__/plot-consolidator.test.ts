import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * plot-consolidator v2 — AI 跨章融合 worker (P1 bug 修复第二轮)
 *
 * 设计意图 (用户 2026-06-26 明确指出):
 *   "比对以往的剧情弧线, 相近的剧情主题则更新进度, 若是新的剧情弧线且
 *    在文章中笔墨浓重的、有推动剧情发展的、情感强烈的等等则形成一个新的剧情弧线"
 *
 * 关键变化 (vs v1):
 *   - v1: 输入 raw arcs (slim prompt 产物) → AI 机械问"rawName 是不是 existingName 的别名"
 *   v2: 输入 chapterContent + existingArcs → AI 自己读章节做语义级判断:
 *        * existing 推进: AI 看 existing + 章节, 决定"笔墨浓重地推进了"的 existing
 *        * 新 arc 识别: AI 看章节, 决定"笔墨浓重 / 推动主线 / 情感强烈"的独立新事件线
 *        * 不要把过渡 / 路人 / 一次性对话做成新 arc (这是 AI 擅长的价值判断)
 *
 *   - v2 不再依赖 extractAll 的 plotArcs 字段, 因为 slim prompt 没让 AI 看 existing,
 *     raw arcs 已经"歪了"。consolidator 自己读章节 + existing 才能做正确判断。
 *
 * AI 返回 contract:
 *   {
 *     "updates": [{ "existingId": "<id>", "progress": 45, "currentStage": "...", ... }],
 *     "newArcs":  [{ "name": "...", "type": "main"|"side", "progress": 0-15, ... }]
 *   }
 */

const mockCallAIWithLog = vi.fn()
const mockLoadRuntimeBase = vi.fn()
const mockLoadWorkerTask = vi.fn()

vi.mock('../services/ai-call-logger.js', () => ({
  callAIWithLog: (...args: any[]) => mockCallAIWithLog(...args)
}))
vi.mock('../services/runtime-loader.js', () => ({
  loadRuntimeBase: (...args: any[]) => mockLoadRuntimeBase(...args),
  loadWorkerTask: (...args: any[]) => mockLoadWorkerTask(...args)
}))

import { consolidatePlotArcs, type ExistingArcView } from '../services/plot-consolidator.js'

function buildApp() {
  return { prisma: {}, log: { info: vi.fn(), error: vi.fn(), warn: vi.fn() } } as any
}

function buildExistingArc(name: string, overrides: Partial<ExistingArcView> = {}): ExistingArcView {
  return {
    id: `existing-${name}`,
    name,
    type: 'main',
    status: 'active',
    progress: 30,
    currentStage: 'stageA',
    nextGoal: 'goalA',
    unresolved: '[]',
    summary: `${name} summary`,
    stages: '[]',
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    ...overrides
  }
}

function setupRuntimeMocks() {
  mockLoadRuntimeBase.mockResolvedValue({ identity: '', settings: {}, behavior: '', jailbreak: '' })
  mockLoadWorkerTask.mockResolvedValue({ workerType: 'memory', taskPrompt: '' })
}

const SAMPLE_CHAPTER = '李凡清晨在山脚采药, 偶遇玄天宗外门长老张伯。张伯见他根骨极佳, 决定收他为徒...'
const SAMPLE_OUTLINE = '李凡遇张伯, 拜入玄天宗'

// ============================================================================
// AI 推进已有弧线 (核心价值: AI 决定哪条 existing 被本章推进)
// ============================================================================

describe('consolidatePlotArcs v2 — AI 推进已有弧线 (核心场景)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setupRuntimeMocks()
  })

  it('AI 判断推进 1 条 existing arc → 输出 updates', async () => {
    const existing = buildExistingArc('李凡修仙之路', { progress: 30 })
    const app = buildApp()

    mockCallAIWithLog.mockResolvedValue(JSON.stringify({
      updates: [
        {
          existingId: 'existing-李凡修仙之路',
          progress: 45,
          currentStage: '李凡拜入玄天宗',
          nextGoal: '入门修行',
          unresolved: ['张伯为何主动收徒'],
          summary: '本章李凡偶遇张伯, 被收为徒, 正式开启修行之路'
        }
      ],
      newArcs: []
    }))

    const result = await consolidatePlotArcs(
      app, 's1', 'c1',
      [existing],
      SAMPLE_CHAPTER,
      SAMPLE_OUTLINE
    )

    expect(mockCallAIWithLog).toHaveBeenCalledTimes(1)
    expect(mockCallAIWithLog.mock.calls[0][1].callType).toBe('plot_consolidate')

    expect(result).toHaveLength(1)
    const updated = result[0]
    expect(updated.existingId).toBe('existing-李凡修仙之路')
    expect(updated.isNew).toBe(false)
    expect(updated.progress).toBe(45)
    expect(updated.currentStage).toBe('李凡拜入玄天宗')
    expect(updated.summary).toContain('正式开启修行之路')
  })

  it('AI 判断不推进任何 existing → 全部 carry forward', async () => {
    // 章节是日常过渡, 没有任何 existing 被推进
    // existing 1 main + 1 side, 符合粒度 (主线 ≤ 1, 支线 ≤ 2)
    const existing1 = buildExistingArc('李凡修仙之路', { progress: 30, type: 'main' })
    const existing2 = buildExistingArc('李凡与赵若曦的感情', { progress: 20, type: 'side' })
    const app = buildApp()

    mockCallAIWithLog.mockResolvedValue(JSON.stringify({
      updates: [],
      newArcs: []
    }))

    const result = await consolidatePlotArcs(
      app, 's1', 'c1',
      [existing1, existing2],
      '本章为日常过渡, 无重要进展',
      '日常过渡'
    )

    expect(result).toHaveLength(2)
    expect(result.every(r => r.isNew === false)).toBe(true)
    expect(result.every(r => r.progress >= 20)).toBe(true)  // 保留原进度
  })

  it('AI 推进多条 existing → 每条都生成 update', async () => {
    // 1 main + 1 side, 符合粒度
    const e1 = buildExistingArc('李凡修仙之路', { progress: 30, type: 'main' })
    const e2 = buildExistingArc('李凡与赵若曦的感情', { progress: 20, type: 'side' })
    const app = buildApp()

    mockCallAIWithLog.mockResolvedValue(JSON.stringify({
      updates: [
        { existingId: 'existing-李凡修仙之路', progress: 45, currentStage: 'A', nextGoal: 'B', unresolved: [], summary: '推进 1' },
        { existingId: 'existing-李凡与赵若曦的感情', progress: 30, currentStage: 'C', nextGoal: 'D', unresolved: [], summary: '推进 2' }
      ],
      newArcs: []
    }))

    const result = await consolidatePlotArcs(
      app, 's1', 'c1',
      [e1, e2],
      '本章既推进了修行也推进了感情线',
      ''
    )

    expect(result).toHaveLength(2)
    expect(result.find(r => r.existingId === 'existing-李凡修仙之路')?.progress).toBe(45)
    expect(result.find(r => r.existingId === 'existing-李凡与赵若曦的感情')?.progress).toBe(30)
  })
})

// ============================================================================
// AI 识别新弧线 (核心价值: 笔墨浓重 / 推动主线 / 情感强烈)
// ============================================================================

describe('consolidatePlotArcs v2 — AI 识别新弧线 (笔墨浓重)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setupRuntimeMocks()
  })

  it('AI 在章节中识别"笔墨浓重"的新事件线 → 创建新 arc', async () => {
    const existing = buildExistingArc('李凡修仙之路', { progress: 30 })
    const app = buildApp()

    // 章节末尾出现重大事件: 魔道余孽首次现身, 章节花了大量篇幅渲染紧张气氛
    mockCallAIWithLog.mockResolvedValue(JSON.stringify({
      updates: [
        { existingId: 'existing-李凡修仙之路', progress: 35, currentStage: 'A', nextGoal: 'B', unresolved: [], summary: '小幅推进' }
      ],
      newArcs: [
        {
          name: '魔道余孽浮现',
          type: 'side',
          status: 'pending',
          progress: 5,
          currentStage: '本章末尾首次暗示',
          nextGoal: '主角查明魔道身份',
          unresolved: ['魔道余孽的真实身份', '其与玄天宗的渊源'],
          summary: '本章末尾, 一道黑影在玄天宗主峰掠过, 留下诡异符号 — 魔道余孽的首次登场'
        }
      ]
    }))

    const result = await consolidatePlotArcs(
      app, 's1', 'c1',
      [existing],
      '... 章节末尾, 一道黑影掠过玄天宗主峰...',
      '李凡开启修行, 魔道余孽首次登场'
    )

    expect(result).toHaveLength(2)

    const updated = result.find(r => r.existingId === 'existing-李凡修仙之路')!
    expect(updated.isNew).toBe(false)

    const newArc = result.find(r => r.isNew === true)!
    expect(newArc.name).toBe('魔道余孽浮现')
    expect(newArc.type).toBe('side')
    expect(newArc.progress).toBe(5)  // 新 arc 开篇, progress 应低
  })

  it('AI 判断章节没有"笔墨浓重"的新事件线 → 不创建新 arc (即使章节里有事件)', async () => {
    // 用户原始 bug 的真正修复: AI 不应该把"过渡 / 路人 / 一次性对话"做成 arc
    const existing = buildExistingArc('李凡修仙之路', { progress: 30 })
    const app = buildApp()

    mockCallAIWithLog.mockResolvedValue(JSON.stringify({
      updates: [
        { existingId: 'existing-李凡修仙之路', progress: 35, currentStage: 'A', nextGoal: 'B', unresolved: [], summary: '小幅推进' }
      ],
      newArcs: []  // AI 判断无新事件线值得开 arc
    }))

    const result = await consolidatePlotArcs(
      app, 's1', 'c1',
      [existing],
      '李凡在山脚采药, 与路人闲聊几句, 遇到一只野兔...',
      '日常过渡'
    )

    expect(result).toHaveLength(1)
    expect(result[0].isNew).toBe(false)
  })
})

// ============================================================================
// 完整流程: 推进 + 新增 + carry-forward 三类并存
// ============================================================================

describe('consolidatePlotArcs v2 — 推进 + 新增 + carry-forward 三类并存', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setupRuntimeMocks()
  })

  it('推进 1 条 + 新增 1 条 + carry-forward 1 条 → 3 条 writes', async () => {
    // 1 main + 1 side 符合粒度, AI 新增 1 side → 仍 1 main + 2 side
    const e1 = buildExistingArc('李凡修仙之路', { progress: 30, type: 'main' })
    const e2 = buildExistingArc('李凡与赵若曦的感情', { progress: 20, type: 'side' })  // 本章没推进
    const app = buildApp()

    mockCallAIWithLog.mockResolvedValue(JSON.stringify({
      updates: [
        { existingId: 'existing-李凡修仙之路', progress: 50, currentStage: 'A', nextGoal: 'B', unresolved: [], summary: '推进' }
      ],
      newArcs: [
        { name: '魔道余孽浮现', type: 'side', status: 'pending', progress: 5, currentStage: '首现', nextGoal: '查明身份', unresolved: ['真实身份'], summary: '新' }
      ]
    }))

    const result = await consolidatePlotArcs(
      app, 's1', 'c1',
      [e1, e2],
      '本章推进了修行, 末尾出现魔道...',
      ''
    )

    expect(result).toHaveLength(3)

    const updated = result.find(r => r.existingId === 'existing-李凡修仙之路')!
    expect(updated.isNew).toBe(false)
    expect(updated.progress).toBe(50)

    const carried = result.find(r => r.existingId === 'existing-李凡与赵若曦的感情')!
    expect(carried.isNew).toBe(false)
    expect(carried.progress).toBe(20)  // 保留原进度

    const newArc = result.find(r => r.isNew === true)!
    expect(newArc.name).toBe('魔道余孽浮现')
  })
})

// ============================================================================
// 边界保护: 进度单调 / AI 失败 / 幻觉 / 粒度约束
// ============================================================================

describe('consolidatePlotArcs v2 — 进度单调不减', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setupRuntimeMocks()
  })

  it('existing progress 35%, AI 返回 progress 25% → 取 max=35 (不回退)', async () => {
    const existing = buildExistingArc('李凡修仙之路', { progress: 35 })
    const app = buildApp()

    mockCallAIWithLog.mockResolvedValue(JSON.stringify({
      updates: [
        { existingId: 'existing-李凡修仙之路', progress: 25, currentStage: 'A', nextGoal: 'B', unresolved: [], summary: 'AI 推算偏低' }
      ],
      newArcs: []
    }))

    const result = await consolidatePlotArcs(app, 's1', 'c1', [existing], SAMPLE_CHAPTER, SAMPLE_OUTLINE)

    expect(result[0].progress).toBe(35)
  })

  it('new arc progress 限制 0-15 (开篇不应超过 15%)', async () => {
    const app = buildApp()
    mockCallAIWithLog.mockResolvedValue(JSON.stringify({
      updates: [],
      newArcs: [
        { name: '新主线', type: 'main', status: 'pending', progress: 50, currentStage: 'X', nextGoal: 'Y', unresolved: [], summary: 'AI 给了 50 但开篇不该这么高' }
      ]
    }))

    const result = await consolidatePlotArcs(app, 's1', 'c1', [], SAMPLE_CHAPTER, SAMPLE_OUTLINE)

    // 截到 15, 避免新 arc 凭空 50% (用户 bug 现象)
    expect(result[0].progress).toBeLessThanOrEqual(15)
  })
})

describe('consolidatePlotArcs v2 — AI 失败兜底', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setupRuntimeMocks()
  })

  it('AI 调用失败 → 兜底 carry-forward 全部 existing, 不创建新 arc', async () => {
    const e1 = buildExistingArc('李凡修仙之路', { progress: 30 })
    const e2 = buildExistingArc('李凡与赵若曦的感情', { progress: 20 })
    const app = buildApp()

    mockCallAIWithLog.mockRejectedValue(new Error('AI provider unavailable'))

    const result = await consolidatePlotArcs(app, 's1', 'c1', [e1, e2], SAMPLE_CHAPTER, SAMPLE_OUTLINE)

    // 兜底: 全部 carry-forward, 不创建新 arc (避免污染)
    expect(result).toHaveLength(2)
    expect(result.every(r => r.isNew === false)).toBe(true)
    expect(result.find(r => r.existingId === 'existing-李凡修仙之路')?.progress).toBe(30)
    expect(result.find(r => r.existingId === 'existing-李凡与赵若曦的感情')?.progress).toBe(20)
  })
})

describe('consolidatePlotArcs v2 — AI 幻觉保护', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setupRuntimeMocks()
  })

  it('AI 返回不存在的 existingId → 忽略该 update, 其它正常处理', async () => {
    const existing = buildExistingArc('李凡修仙之路', { progress: 30 })
    const app = buildApp()

    mockCallAIWithLog.mockResolvedValue(JSON.stringify({
      updates: [
        { existingId: 'existing-李凡修仙之路', progress: 45, currentStage: 'A', nextGoal: 'B', unresolved: [], summary: '合法' },
        { existingId: 'existing-不存在的弧线', progress: 50, currentStage: 'X', nextGoal: 'Y', unresolved: [], summary: '幻觉' }
      ],
      newArcs: []
    }))

    const result = await consolidatePlotArcs(app, 's1', 'c1', [existing], SAMPLE_CHAPTER, SAMPLE_OUTLINE)

    // 幻觉被忽略, 只有 1 个有效 update
    expect(result).toHaveLength(1)
    expect(result[0].progress).toBe(45)
  })
})

describe('consolidatePlotArcs v2 — 粒度约束 (Zod schema 校验)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setupRuntimeMocks()
  })

  it('AI 超额返回 3 main + 2 side → 抛错 (主线 ≤ 1, 支线 ≤ 2)', async () => {
    // 现有 arc 已占用 1 main + 1 side, AI 又加 2 main + 1 side → 共 3 main + 2 side
    const e1 = buildExistingArc('主线A', { type: 'main', progress: 30 })
    const e2 = buildExistingArc('支线A', { type: 'side', progress: 20 })
    const app = buildApp()

    mockCallAIWithLog.mockResolvedValue(JSON.stringify({
      updates: [
        { existingId: 'existing-主线A', progress: 35, currentStage: 'A', nextGoal: 'B', unresolved: [], summary: 'x' }
      ],
      newArcs: [
        { name: '主线B', type: 'main', status: 'pending', progress: 5, currentStage: 'X', nextGoal: 'Y', unresolved: [], summary: 'x' },
        { name: '主线C', type: 'main', status: 'pending', progress: 5, currentStage: 'X', nextGoal: 'Y', unresolved: [], summary: 'x' },
        { name: '支线B', type: 'side', status: 'pending', progress: 5, currentStage: 'X', nextGoal: 'Y', unresolved: [], summary: 'x' }
      ]
    }))

    await expect(
      consolidatePlotArcs(app, 's1', 'c1', [e1, e2], SAMPLE_CHAPTER, SAMPLE_OUTLINE)
    ).rejects.toThrow(/粒度|主线|支线|granularity/i)
  })

  it('AI 返回 1 main + 2 side → 通过 (符合粒度)', async () => {
    const e1 = buildExistingArc('主线A', { type: 'main', progress: 30 })
    const e2 = buildExistingArc('支线A', { type: 'side', progress: 20 })
    const app = buildApp()

    mockCallAIWithLog.mockResolvedValue(JSON.stringify({
      updates: [
        { existingId: 'existing-主线A', progress: 35, currentStage: 'A', nextGoal: 'B', unresolved: [], summary: 'x' }
      ],
      newArcs: [
        { name: '支线B', type: 'side', status: 'pending', progress: 5, currentStage: 'X', nextGoal: 'Y', unresolved: [], summary: 'x' }
      ]
    }))

    const result = await consolidatePlotArcs(app, 's1', 'c1', [e1, e2], SAMPLE_CHAPTER, SAMPLE_OUTLINE)

    expect(result.length).toBeGreaterThanOrEqual(2)
    expect(result.every(r => !r.isNew || r.type === 'side')).toBe(true)
  })
})

describe('consolidatePlotArcs v2 — completed arc 跳过 carry-forward', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setupRuntimeMocks()
  })

  it('existing completed arc 不出现 (避免 ReviewingPanel 污染)', async () => {
    const active = buildExistingArc('主线A', { progress: 30 })
    const done = buildExistingArc('已完结', { progress: 100, status: 'completed' })
    const app = buildApp()

    mockCallAIWithLog.mockResolvedValue(JSON.stringify({
      updates: [{ existingId: 'existing-主线A', progress: 35, currentStage: 'A', nextGoal: 'B', unresolved: [], summary: 'x' }],
      newArcs: []
    }))

    const result = await consolidatePlotArcs(app, 's1', 'c1', [active, done], SAMPLE_CHAPTER, SAMPLE_OUTLINE)

    expect(result).toHaveLength(1)
    expect(result[0].name).toBe('主线A')
  })
})

describe('consolidatePlotArcs v2 — stages 合并 (新 arc 自动初始化 stages)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setupRuntimeMocks()
  })

  it('AI update existing → stages 追加新阶段 (若不重复)', async () => {
    const existing = buildExistingArc('李凡修仙之路', {
      progress: 30,
      stages: JSON.stringify([{ stage: '山脚采药', completed: false, description: '初始' }])
    })
    const app = buildApp()

    mockCallAIWithLog.mockResolvedValue(JSON.stringify({
      updates: [
        {
          existingId: 'existing-李凡修仙之路',
          progress: 50,
          currentStage: '拜入玄天宗',
          nextGoal: '入门修行',
          unresolved: [],
          summary: '推进'
        }
      ],
      newArcs: []
    }))

    const result = await consolidatePlotArcs(app, 's1', 'c1', [existing], SAMPLE_CHAPTER, SAMPLE_OUTLINE)

    const stages = JSON.parse(result[0].stages)
    expect(stages).toHaveLength(2)
    expect(stages.map((s: any) => s.stage)).toEqual(['山脚采药', '拜入玄天宗'])
  })

  it('AI new arc → stages 包含初始阶段', async () => {
    const app = buildApp()
    mockCallAIWithLog.mockResolvedValue(JSON.stringify({
      updates: [],
      newArcs: [
        { name: '魔道浮现', type: 'side', status: 'pending', progress: 5, currentStage: '首现', nextGoal: '查明', unresolved: ['身份'], summary: 'x' }
      ]
    }))

    const result = await consolidatePlotArcs(app, 's1', 'c1', [], SAMPLE_CHAPTER, SAMPLE_OUTLINE)

    const stages = JSON.parse(result[0].stages)
    expect(stages).toHaveLength(1)
    expect(stages[0].stage).toBe('首现')
  })
})