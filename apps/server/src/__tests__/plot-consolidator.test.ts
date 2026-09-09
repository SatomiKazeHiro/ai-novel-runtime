import { describe, it, expect, vi, beforeEach } from 'vitest'

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
    isMainline: true,
    status: 'active',
    firstChapterNumber: 1,
    closedBy: null,
    closedTargetArcId: null,
    ...overrides
  }
}

function setupRuntimeMocks() {
  mockLoadRuntimeBase.mockResolvedValue({ identity: '', settings: {}, behavior: '', jailbreak: '' })
  mockLoadWorkerTask.mockResolvedValue({ workerType: 'memory', taskPrompt: '' })
}

const SAMPLE_CHAPTER = '李凡清晨在山脚采药, 偶遇玄天宗外门长老张伯。张伯见他根骨极佳, 决定收他为徒...'
const SAMPLE_OUTLINE = '李凡遇张伯, 拜入玄天宗'

describe('consolidatePlotArcs v3 — 推进点 + isEnd + 相似关闭', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setupRuntimeMocks()
  })

  it('AI 推进已有弧线 → update write', async () => {
    const existing = buildExistingArc('李凡修仙之路')
    const app = buildApp()
    mockCallAIWithLog.mockResolvedValue(JSON.stringify({
      arcUpdates: [{ arcId: 'existing-李凡修仙之路', content: '李凡拜入玄天宗', isEnd: false }],
      newArcs: [],
      closes: []
    }))

    const result = await consolidatePlotArcs(app, 's1', 'c1', [existing], SAMPLE_CHAPTER, SAMPLE_OUTLINE)

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      arcId: 'existing-李凡修仙之路',
      name: '李凡修仙之路',
      isMainline: true,
      content: '李凡拜入玄天宗',
      isEnd: false,
      action: 'update'
    })
  })

  it('AI 识别新弧线 → create write', async () => {
    const app = buildApp()
    mockCallAIWithLog.mockResolvedValue(JSON.stringify({
      arcUpdates: [],
      newArcs: [{ name: '魔道余孽浮现', isMainline: false, content: '黑影掠过主峰', isEnd: false }],
      closes: []
    }))

    const result = await consolidatePlotArcs(app, 's1', 'c1', [], SAMPLE_CHAPTER, SAMPLE_OUTLINE)

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({ arcId: null, name: '魔道余孽浮现', isMainline: false, action: 'create' })
  })

  it('AI 打 isEnd → 推进点带 isEnd 标记', async () => {
    const existing = buildExistingArc('李凡修仙之路')
    const app = buildApp()
    mockCallAIWithLog.mockResolvedValue(JSON.stringify({
      arcUpdates: [{ arcId: 'existing-李凡修仙之路', content: '主线收尾', isEnd: true }],
      newArcs: [],
      closes: []
    }))

    const result = await consolidatePlotArcs(app, 's1', 'c1', [existing], SAMPLE_CHAPTER, SAMPLE_OUTLINE)

    expect(result[0].isEnd).toBe(true)
    expect(result[0].action).toBe('update')
  })

  it('AI 相似关闭 → close write 带 targetArcId', async () => {
    const target = buildExistingArc('保留条')
    const dup = buildExistingArc('重复条')
    const app = buildApp()
    mockCallAIWithLog.mockResolvedValue(JSON.stringify({
      arcUpdates: [],
      newArcs: [],
      closes: [{ arcId: 'existing-重复条', targetArcId: 'existing-保留条' }]
    }))

    const result = await consolidatePlotArcs(app, 's1', 'c1', [target, dup], SAMPLE_CHAPTER, SAMPLE_OUTLINE)

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({ arcId: 'existing-重复条', action: 'close', targetArcId: 'existing-保留条' })
  })

  it('AI 幻觉 arcId → 忽略', async () => {
    const existing = buildExistingArc('李凡修仙之路')
    const app = buildApp()
    mockCallAIWithLog.mockResolvedValue(JSON.stringify({
      arcUpdates: [
        { arcId: 'existing-李凡修仙之路', content: '合法', isEnd: false },
        { arcId: 'existing-不存在', content: '幻觉', isEnd: false }
      ],
      newArcs: [],
      closes: []
    }))

    const result = await consolidatePlotArcs(app, 's1', 'c1', [existing], SAMPLE_CHAPTER, SAMPLE_OUTLINE)

    expect(result).toHaveLength(1)
    expect(result[0].arcId).toBe('existing-李凡修仙之路')
  })

  it('AI 失败 → 抛错（不再 carry-forward）', async () => {
    const e1 = buildExistingArc('李凡修仙之路')
    const app = buildApp()
    mockCallAIWithLog.mockRejectedValue(new Error('AI provider unavailable'))

    await expect(consolidatePlotArcs(app, 's1', 'c1', [e1], SAMPLE_CHAPTER, SAMPLE_OUTLINE))
      .rejects.toThrow('AI provider unavailable')
  })

  it('无 existing + 无内容 → 返回 []（不调 AI）', async () => {
    const app = buildApp()
    const result = await consolidatePlotArcs(app, 's1', 'c1', [], '', '')
    expect(result).toEqual([])
    expect(mockCallAIWithLog).not.toHaveBeenCalled()
  })
})
