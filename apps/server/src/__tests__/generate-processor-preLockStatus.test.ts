import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock callAIWithLog so the worker does not actually call AI.
const mockCallAIWithLog = vi.fn()
vi.mock('../services/ai-call-logger.js', () => ({
  callAIWithLog: (...args: any[]) => mockCallAIWithLog(...args)
}))

import { createGenerateProcessor } from '../services/generate-processor.js'

function makeJob(preLockStatus: string | undefined, successPerCall: boolean[]) {
  return {
    data: {
      draftIds: successPerCall.map((_, i) => `d${i}`),
      chapterId: 'c1',
      storyId: 's1',
      compiled: { systemMessage: '', userMessage: '', meta: { totalTokens: 0 } },
      temperatures: successPerCall.map(() => 0.7),
      maxTokens: 4096,
      chapterTitle: 'Title',
      chapterOutline: 'Outline',
      preLockStatus
    }
  }
}

function makeApp() {
  return {
    prisma: {
      draft: {
        // 默认 status='generating' — 这是 chapters-generate.ts:278 route 创建 draft 时的真实初值。
        // 之前 mock 默认 'pending' 配合旧 worker 的 `!== 'pending'` 跳过条件, 把这个 bug 掩盖了。
        findUnique: vi.fn().mockResolvedValue({ status: 'generating' }),
        update: vi.fn()
      },
      chapter: {
        update: vi.fn(),
        // 现在 worker 用 updateMany + where status='generating' 保护, 不覆盖已 select 的 chapter
        updateMany: vi.fn().mockResolvedValue({ count: 1 })
      }
    },
    log: { info: vi.fn(), error: vi.fn(), warn: vi.fn() }
  } as any
}

describe('generate-processor — preLockStatus restore (Task #66)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('preLockStatus=draft, all success → restore to "generated"', async () => {
    mockCallAIWithLog.mockResolvedValue('content')
    const app = makeApp()
    const processor = createGenerateProcessor(app)
    await processor(makeJob('draft', [true, true, true]))

    expect(app.prisma.chapter.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'c1', status: 'generating' },
        data: { status: 'generated' }
      })
    )
  })

  it('preLockStatus=generated, all success → restore to "generated"', async () => {
    mockCallAIWithLog.mockResolvedValue('content')
    const app = makeApp()
    const processor = createGenerateProcessor(app)
    await processor(makeJob('generated', [true, true, true]))

    expect(app.prisma.chapter.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: 'generated' } })
    )
  })

  it('preLockStatus=selected, all success → restore to "selected" (Task #66 core)', async () => {
    mockCallAIWithLog.mockResolvedValue('content')
    const app = makeApp()
    const processor = createGenerateProcessor(app)
    await processor(makeJob('selected', [true, true, true]))

    expect(app.prisma.chapter.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: 'selected' } })
    )
  })

  it('preLockStatus=selected, partial success → restore to "selected"', async () => {
    mockCallAIWithLog
      .mockResolvedValueOnce('content')
      .mockRejectedValueOnce(new Error('AI fail'))
      .mockResolvedValueOnce('content')
    const app = makeApp()
    const processor = createGenerateProcessor(app)
    await processor(makeJob('selected', [true, false, true]))

    expect(app.prisma.chapter.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: 'selected' } })
    )
  })

  it('preLockStatus=selected, all fail → still restore to "selected" (avoids stuck generating)', async () => {
    mockCallAIWithLog.mockRejectedValue(new Error('AI fail'))
    const app = makeApp()
    const processor = createGenerateProcessor(app)
    await processor(makeJob('selected', [false, false, false]))

    expect(app.prisma.chapter.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: 'selected' } })
    )
  })

  it('preLockStatus=undefined (legacy queue job) → fallback to "draft" → restore to "generated"', async () => {
    mockCallAIWithLog.mockResolvedValue('content')
    const app = makeApp()
    const processor = createGenerateProcessor(app)
    await processor(makeJob(undefined, [true, true, true]))

    expect(app.prisma.chapter.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: 'generated' } })
    )
  })

  it('worker does NOT touch Chapter.content (additive invariant — spec §2.1.2)', async () => {
    mockCallAIWithLog.mockResolvedValue('content')
    const app = makeApp()
    const processor = createGenerateProcessor(app)
    await processor(makeJob('selected', [true, true, true]))

    // 兜底: 没有任何对 chapter 的写带 content 字段
    const writes = [
      ...app.prisma.chapter.updateMany.mock.calls,
      ...app.prisma.chapter.update.mock.calls
    ]
    expect(writes.length).toBeGreaterThan(0)
    for (const call of writes) {
      expect(call[0].data).not.toHaveProperty('content')
    }
  })

  it('当 chapter.status 已被用户 select 翻成 selected, worker 不覆盖 (select 优先)', async () => {
    // updateMany where status='generating' count=0 模拟 select 已先把 chapter 翻了
    mockCallAIWithLog.mockResolvedValue('content')
    const app = makeApp()
    app.prisma.chapter.updateMany.mockResolvedValue({ count: 0 })
    const processor = createGenerateProcessor(app)
    await processor(makeJob('draft', [true, true, true]))

    // 即便 count=0, worker 也会调 updateMany (这是 noop, 但调用发生了)
    expect(app.prisma.chapter.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'c1', status: 'generating' } })
    )
    // 关键: 没有 fallback 用 chapter.update 把 status 写成 generated
    const fallbackUpdate = app.prisma.chapter.update.mock.calls.find((c: any) =>
      c[0]?.data?.status === 'generated'
    )
    expect(fallbackUpdate).toBeUndefined()
  })

  it('生成中遇到已被 select 标 rejected 的 draft, 跳过 (避免 select 被覆盖)', async () => {
    // 第一个 draft 被 select 标 rejected, 第二个 generating, 第三个 rejected
    mockCallAIWithLog.mockResolvedValue('content')
    const app = makeApp()
    app.prisma.draft.findUnique
      .mockResolvedValueOnce({ status: 'rejected' })
      .mockResolvedValueOnce({ status: 'generating' })
      .mockResolvedValueOnce({ status: 'rejected' })
    const processor = createGenerateProcessor(app)
    await processor(makeJob('draft', [true, true, true]))

    // 只应该有 1 次 AI 调用 (中间那个 generating), rejected 跳过
    expect(mockCallAIWithLog).toHaveBeenCalledTimes(1)
    // 只有 1 次 draft.update (中间那个 generating → completed)
    const draftUpdates = app.prisma.draft.update.mock.calls.map((c: any) => c[0].where.id)
    expect(draftUpdates).toEqual(['d1'])
  })

  it('route 实际用 status="generating" 创建 draft, worker 必须处理 (regression #5189442 bug)', async () => {
    // bug 背景: 之前 worker 用 `current.status !== 'pending'` 跳过,
    // 但 chapters-generate.ts:278 route 用 'generating' 创建 draft,
    // 导致 worker 永远跳过自己刚派出去的任务, draft 卡在 'generating' 永远不处理。
    // 修复: 跳过条件改为 SKIP_STATUSES 白名单 (selected/rejected/completed/failed),
    // pending + generating 都会处理。
    mockCallAIWithLog.mockResolvedValue('content')
    const app = makeApp()
    // 默认 mock 就是 'generating', 显式再确认一次
    app.prisma.draft.findUnique.mockResolvedValue({ status: 'generating' })
    const processor = createGenerateProcessor(app)
    await processor(makeJob('draft', [true, true, true]))

    // 3 个 draft 都应该被处理, AI 调用 3 次
    expect(mockCallAIWithLog).toHaveBeenCalledTimes(3)
    // 3 个 draft.update 都发生 (status → completed)
    const draftUpdates = app.prisma.draft.update.mock.calls.map((c: any) => c[0].where.id)
    expect(draftUpdates).toEqual(['d0', 'd1', 'd2'])
  })

  it('selected draft 跳过 (用户已选, 不能复活)', async () => {
    mockCallAIWithLog.mockResolvedValue('content')
    const app = makeApp()
    app.prisma.draft.findUnique.mockResolvedValue({ status: 'selected' })
    const processor = createGenerateProcessor(app)
    await processor(makeJob('draft', [true, true, true]))

    // 全 selected → 全部跳过, 0 AI 调用
    expect(mockCallAIWithLog).toHaveBeenCalledTimes(0)
    expect(app.prisma.draft.update).not.toHaveBeenCalled()
  })

  it('completed draft 跳过 (worker 已成功处理过, 不重跑)', async () => {
    mockCallAIWithLog.mockResolvedValue('content')
    const app = makeApp()
    app.prisma.draft.findUnique.mockResolvedValue({ status: 'completed' })
    const processor = createGenerateProcessor(app)
    await processor(makeJob('draft', [true, true, true]))

    expect(mockCallAIWithLog).toHaveBeenCalledTimes(0)
    expect(app.prisma.draft.update).not.toHaveBeenCalled()
  })

  it('failed draft 跳过 (worker 已失败, 不静默重试)', async () => {
    mockCallAIWithLog.mockResolvedValue('content')
    const app = makeApp()
    app.prisma.draft.findUnique.mockResolvedValue({ status: 'failed' })
    const processor = createGenerateProcessor(app)
    await processor(makeJob('draft', [true, true, true]))

    expect(mockCallAIWithLog).toHaveBeenCalledTimes(0)
    expect(app.prisma.draft.update).not.toHaveBeenCalled()
  })

  it('mixed: generating 处理, selected/rejected/completed/failed 全部跳过', async () => {
    mockCallAIWithLog.mockResolvedValue('content')
    const app = makeApp()
    app.prisma.draft.findUnique
      .mockResolvedValueOnce({ status: 'selected' })     // 跳过
      .mockResolvedValueOnce({ status: 'generating' })   // 处理
      .mockResolvedValueOnce({ status: 'rejected' })     // 跳过
      .mockResolvedValueOnce({ status: 'completed' })    // 跳过
      .mockResolvedValueOnce({ status: 'failed' })       // 跳过
    const processor = createGenerateProcessor(app)
    await processor(makeJob('draft', [true, true, true, true, true]))

    expect(mockCallAIWithLog).toHaveBeenCalledTimes(1)
    const draftUpdates = app.prisma.draft.update.mock.calls.map((c: any) => c[0].where.id)
    expect(draftUpdates).toEqual(['d1'])
  })
})
