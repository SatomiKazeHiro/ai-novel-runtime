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
        findUnique: vi.fn().mockResolvedValue({ status: 'pending' }),
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
    // 第一个 draft 被 select 标 rejected, 第二个 pending, 第三个 rejected
    mockCallAIWithLog.mockResolvedValue('content')
    const app = makeApp()
    app.prisma.draft.findUnique
      .mockResolvedValueOnce({ status: 'rejected' })
      .mockResolvedValueOnce({ status: 'pending' })
      .mockResolvedValueOnce({ status: 'rejected' })
    const processor = createGenerateProcessor(app)
    await processor(makeJob('draft', [true, true, true]))

    // 只应该有 1 次 AI 调用 (中间那个 pending), rejected 跳过
    expect(mockCallAIWithLog).toHaveBeenCalledTimes(1)
    // 只有 1 次 draft.update (中间那个 pending → completed)
    const draftUpdates = app.prisma.draft.update.mock.calls.map((c: any) => c[0].where.id)
    expect(draftUpdates).toEqual(['d1'])
  })
})
