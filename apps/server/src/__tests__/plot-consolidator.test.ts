import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * plot-consolidator — P1 bug fix for "plot arc 不增长".
 *
 * 根因: slim 重构后 extractAll 用 mode='slim' prompt, AI 看不到现有 arc 名字,
 *       每章返回新名字的 arc。preparePlotArcWrites 按 name 精确匹配 existing,
 *       全部走 isNew=true 路径 → 6 章 6 条互不关联的 arc 都卡在 50%。
 *
 * 设计: 对齐 graph-organizer 模式 — Phase 2 跨章融合 worker:
 *   Step 1: code fast path — raw.name 精确匹配 existing.name → 更新进度
 *   Step 2: AI reconcile — unmatched raw + 已有 arcs 存在 → 一次小 AI 调用
 *           判断"是否同一条(重命名/别名)" vs "真正新弧线"
 *   Step 3: carry-forward — 未推进的 existing arc 保留 (不被本章节的"未提及"抹掉)
 *
 * 此处只测 consolidatePlotArcs 的纯逻辑。AI reconcile 走 ai-call-logger mock,
 * 不依赖真实 provider。
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

describe('consolidatePlotArcs — code fast path (exact name match)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setupRuntimeMocks()
  })

  it('raw.name matches existing.name → isNew=false, existingId set, no AI call', async () => {
    const existing = buildExistingArc('李凡修仙之路', { progress: 35 })
    const app = buildApp()

    const result = await consolidatePlotArcs(
      app, 's1', 'c1',
      [existing],
      [{
        name: '李凡修仙之路',
        type: 'main',
        status: 'active',
        progress: 45,
        currentStage: 'stageB',
        nextGoal: 'goalB',
        unresolved: ['悬念1'],
        summary: '推进了'
      }]
    )

    // No AI reconcile needed when all matched
    expect(mockCallAIWithLog).not.toHaveBeenCalled()

    expect(result).toHaveLength(1)
    expect(result[0].isNew).toBe(false)
    expect(result[0].existingId).toBe('existing-李凡修仙之路')
    expect(result[0].progress).toBe(45)  // 用了 raw 的进度
    expect(result[0].currentStage).toBe('stageB')
  })

  it('no existing arcs → all raws become new (isNew=true), no AI call', async () => {
    const app = buildApp()

    const result = await consolidatePlotArcs(
      app, 's1', 'c1',
      [],
      [{
        name: '全新主线',
        type: 'main',
        status: 'pending',
        progress: 0,
        currentStage: 'start',
        nextGoal: 'next',
        unresolved: [],
        summary: '新章开始'
      }]
    )

    expect(mockCallAIWithLog).not.toHaveBeenCalled()
    expect(result).toHaveLength(1)
    expect(result[0].isNew).toBe(true)
    expect(result[0].existingId).toBeUndefined()
    expect(result[0].name).toBe('全新主线')
  })

  it('existing arc NOT in raws → carry forward unchanged (id+name+progress保留)', async () => {
    // 关键: 本章没推进的 arc 不能丢 — 用户在 ReviewingPanel 应该看到它们还在
    const existing1 = buildExistingArc('李凡修仙之路', { progress: 35 })
    const existing2 = buildExistingArc('李凡与赵若曦的感情', { progress: 20 })
    const app = buildApp()

    const result = await consolidatePlotArcs(
      app, 's1', 'c1',
      [existing1, existing2],
      [{
        // 只推进了 existing1
        name: '李凡修仙之路',
        type: 'main',
        status: 'active',
        progress: 50,
        currentStage: 'stageC',
        nextGoal: 'goalC',
        unresolved: [],
        summary: '推进'
      }]
    )

    expect(mockCallAIWithLog).not.toHaveBeenCalled()  // 没 unmatched raw

    expect(result).toHaveLength(2)

    const updated = result.find(r => r.name === '李凡修仙之路')!
    expect(updated.isNew).toBe(false)
    expect(updated.existingId).toBe('existing-李凡修仙之路')
    expect(updated.progress).toBe(50)

    const carried = result.find(r => r.name === '李凡与赵若曦的感情')!
    expect(carried.isNew).toBe(false)
    expect(carried.existingId).toBe('existing-李凡与赵若曦的感情')
    expect(carried.progress).toBe(20)  // 保留原进度, 不被吞掉
  })
})

describe('consolidatePlotArcs — AI reconcile (semantic rename detection)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setupRuntimeMocks()
  })

  it('raw.name 不匹配 → 调用 AI reconcile 一次, 决定归属', async () => {
    const existing = buildExistingArc('李凡修仙之路', { progress: 35 })
    const app = buildApp()

    // AI 返回: raw "修行主线推进" 是 existing "李凡修仙之路" 的重命名
    mockCallAIWithLog.mockResolvedValue(JSON.stringify({
      decisions: [
        { rawName: '修行主线推进', matchExistingName: '李凡修仙之路' }
      ]
    }))

    const result = await consolidatePlotArcs(
      app, 's1', 'c1',
      [existing],
      [{
        name: '修行主线推进',
        type: 'main',
        status: 'active',
        progress: 45,
        currentStage: 'stageB',
        nextGoal: 'goalB',
        unresolved: [],
        summary: 'AI 视角下的别名'
      }]
    )

    expect(mockCallAIWithLog).toHaveBeenCalledTimes(1)
    // reconcile 用独立 callType 方便区分日志
    expect(mockCallAIWithLog.mock.calls[0][1].callType).toBe('plot_reconcile')

    expect(result).toHaveLength(1)
    expect(result[0].isNew).toBe(false)
    expect(result[0].existingId).toBe('existing-李凡修仙之路')
    expect(result[0].name).toBe('李凡修仙之路')  // 用 existing 的名字 (归一化)
    expect(result[0].progress).toBe(45)
  })

  it('AI reconcile 返回 null → 新弧线 (isNew=true)', async () => {
    const existing = buildExistingArc('李凡修仙之路', { progress: 35 })
    const app = buildApp()

    mockCallAIWithLog.mockResolvedValue(JSON.stringify({
      decisions: [
        { rawName: '魔道余孽浮现', matchExistingName: null }  // 真正新弧线
      ]
    }))

    const result = await consolidatePlotArcs(
      app, 's1', 'c1',
      [existing],
      [{
        name: '魔道余孽浮现',
        type: 'side',
        status: 'pending',
        progress: 0,
        currentStage: 'start',
        nextGoal: 'next',
        unresolved: [],
        summary: '真正新弧线'
      }]
    )

    // 关键: 现有 arc 没被推进 (AI 说 raw 是 new) → 也被 carry-forward
    const newArc = result.find(r => r.name === '魔道余孽浮现')!
    expect(newArc.isNew).toBe(true)
    expect(newArc.existingId).toBeUndefined()
    expect(newArc.progress).toBe(0)
    const carried = result.find(r => r.existingId === 'existing-李凡修仙之路')!
    expect(carried.isNew).toBe(false)
    expect(carried.progress).toBe(35)
    expect(result).toHaveLength(2)
  })

  it('AI reconcile 混合: 部分 rename 部分新弧线, 同时推进同名 arc', async () => {
    // 真实场景: 3 个 raw + 2 个 existing
    //   - raw1 与 existing1 同名 (fast path)
    //   - raw2 是 existing2 的 rename (AI reconcile)
    //   - raw3 真正新 (AI reconcile returns null)
    const existing1 = buildExistingArc('李凡修仙之路', { progress: 35 })
    const existing2 = buildExistingArc('李凡与赵若曦的感情', { progress: 20 })
    const app = buildApp()

    mockCallAIWithLog.mockResolvedValue(JSON.stringify({
      decisions: [
        { rawName: '感情线发展', matchExistingName: '李凡与赵若曦的感情' },
        { rawName: '魔道余孽浮现', matchExistingName: null }
      ]
    }))

    const result = await consolidatePlotArcs(
      app, 's1', 'c1',
      [existing1, existing2],
      [
        {
          name: '李凡修仙之路',
          type: 'main',
          status: 'active',
          progress: 50,
          currentStage: 'stageC',
          nextGoal: 'goalC',
          unresolved: [],
          summary: '推进'
        },
        {
          name: '感情线发展',
          type: 'side',
          status: 'active',
          progress: 25,
          currentStage: 'b',
          nextGoal: 'c',
          unresolved: [],
          summary: 'rename'
        },
        {
          name: '魔道余孽浮现',
          type: 'side',
          status: 'pending',
          progress: 0,
          currentStage: 'start',
          nextGoal: 'next',
          unresolved: [],
          summary: 'new'
        }
      ]
    )

    expect(mockCallAIWithLog).toHaveBeenCalledTimes(1)
    // fast path 处理了 1 条, AI reconcile 处理了 2 条
    expect(result).toHaveLength(3)

    const updated1 = result.find(r => r.existingId === 'existing-李凡修仙之路')!
    expect(updated1.isNew).toBe(false)
    expect(updated1.progress).toBe(50)

    const updated2 = result.find(r => r.existingId === 'existing-李凡与赵若曦的感情')!
    expect(updated2.isNew).toBe(false)
    expect(updated2.name).toBe('李凡与赵若曦的感情')  // 归一化到 existing name
    expect(updated2.progress).toBe(25)

    const newArc = result.find(r => r.name === '魔道余孽浮现')!
    expect(newArc.isNew).toBe(true)
  })

  it('AI reconcile 失败 → 兜底把 unmatched 当 new, 不抛错阻塞归档', async () => {
    const existing = buildExistingArc('李凡修仙之路', { progress: 35 })
    const app = buildApp()

    mockCallAIWithLog.mockRejectedValue(new Error('AI provider unavailable'))

    const result = await consolidatePlotArcs(
      app, 's1', 'c1',
      [existing],
      [{
        name: '未知主线',
        type: 'main',
        status: 'active',
        progress: 50,
        currentStage: 'b',
        nextGoal: 'c',
        unresolved: [],
        summary: '可能 rename 也可能 new'
      }]
    )

    // 兜底: 当作 new (避免阻塞归档; ReviewingPanel 可人工修正)
    // 关键: 现有 arc 没被推进 → 也被 carry-forward (2 条 total)
    const newArc = result.find(r => r.name === '未知主线')!
    expect(newArc.isNew).toBe(true)
    const carried = result.find(r => r.existingId === 'existing-李凡修仙之路')!
    expect(carried.isNew).toBe(false)
    expect(carried.progress).toBe(35)
    expect(result).toHaveLength(2)
  })

  it('AI reconcile 返回未知的 rawName → 忽略该决策, 其它正常处理', async () => {
    const existing = buildExistingArc('李凡修仙之路', { progress: 35 })
    const app = buildApp()

    // AI 返回了 2 个 decision, 但只有 rawName="感情线发展" 在输入 raws 里
    // rawName="伪造的弧线" 在输入里没有 → 忽略
    mockCallAIWithLog.mockResolvedValue(JSON.stringify({
      decisions: [
        { rawName: '感情线发展', matchExistingName: null },
        { rawName: '伪造的弧线', matchExistingName: null }  // 幻觉
      ]
    }))

    const result = await consolidatePlotArcs(
      app, 's1', 'c1',
      [existing],
      [{
        name: '感情线发展',
        type: 'side',
        status: 'active',
        progress: 25,
        currentStage: 'b',
        nextGoal: 'c',
        unresolved: [],
        summary: 'AI 决定'
      }]
    )

    // 关键: 现有 arc 没被推进 (AI 决定 null → 新弧线) → 也被 carry-forward
    const newArc = result.find(r => r.name === '感情线发展')!
    expect(newArc.isNew).toBe(true)
    const carried = result.find(r => r.existingId === 'existing-李凡修仙之路')!
    expect(carried.isNew).toBe(false)
    expect(carried.progress).toBe(35)
    expect(result).toHaveLength(2)
  })
})

describe('consolidatePlotArcs — progress monotonic (regression guard)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setupRuntimeMocks()
  })

  it('existing arc 35% + raw 返回 25% → 不回退, 取 max(35, 25)=35', async () => {
    // 用户真实痛点: AI 不擅长算进度, 可能返回低于现有的进度。
    // 我们保证 progress 单调不减 — 不会让 arc 倒退。
    const existing = buildExistingArc('李凡修仙之路', { progress: 35 })
    const app = buildApp()

    const result = await consolidatePlotArcs(
      app, 's1', 'c1',
      [existing],
      [{
        name: '李凡修仙之路',
        type: 'main',
        status: 'active',
        progress: 25,  // 倒退!
        currentStage: 'b',
        nextGoal: 'c',
        unresolved: [],
        summary: 'AI 看走眼了'
      }]
    )

    expect(result).toHaveLength(1)
    expect(result[0].progress).toBe(35)  // 取 max, 不倒退
  })

  it('existing arc 35% + raw 返回 50% → 50 (正常推进)', async () => {
    const existing = buildExistingArc('李凡修仙之路', { progress: 35 })
    const app = buildApp()

    const result = await consolidatePlotArcs(
      app, 's1', 'c1',
      [existing],
      [{
        name: '李凡修仙之路',
        type: 'main',
        status: 'active',
        progress: 50,
        currentStage: 'b',
        nextGoal: 'c',
        unresolved: [],
        summary: '推进'
      }]
    )

    expect(result[0].progress).toBe(50)
  })
})

describe('consolidatePlotArcs — completed arcs (boundary)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setupRuntimeMocks()
  })

  it('existing arc status=completed → carry forward 跳过 (不重复写入)', async () => {
    // 已完成的弧线不需要在推进章节里再 carry forward — 用户已经看到它 completed。
    // 携带它会污染 ReviewingPanel 视图, 且 commitPlotArcWrites 会再做 update (no-op 但浪费)。
    const existingActive = buildExistingArc('李凡修仙之路', { progress: 35 })
    const existingDone = buildExistingArc('已完结支线', { progress: 100, status: 'completed' })
    const app = buildApp()

    const result = await consolidatePlotArcs(
      app, 's1', 'c1',
      [existingActive, existingDone],
      [{
        name: '李凡修仙之路',
        type: 'main',
        status: 'active',
        progress: 50,
        currentStage: 'b',
        nextGoal: 'c',
        unresolved: [],
        summary: '推进'
      }]
    )

    // 只有 active 被更新, completed 不出现
    expect(result).toHaveLength(1)
    expect(result[0].name).toBe('李凡修仙之路')
  })
})