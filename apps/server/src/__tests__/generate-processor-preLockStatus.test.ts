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
      draft: { update: vi.fn() },
      chapter: { update: vi.fn() }
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

    expect(app.prisma.chapter.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'c1' },
        data: { status: 'generated' }
      })
    )
  })

  it('preLockStatus=generated, all success → restore to "generated"', async () => {
    mockCallAIWithLog.mockResolvedValue('content')
    const app = makeApp()
    const processor = createGenerateProcessor(app)
    await processor(makeJob('generated', [true, true, true]))

    expect(app.prisma.chapter.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: 'generated' } })
    )
  })

  it('preLockStatus=selected, all success → restore to "selected" (Task #66 core)', async () => {
    mockCallAIWithLog.mockResolvedValue('content')
    const app = makeApp()
    const processor = createGenerateProcessor(app)
    await processor(makeJob('selected', [true, true, true]))

    expect(app.prisma.chapter.update).toHaveBeenCalledWith(
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

    expect(app.prisma.chapter.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: 'selected' } })
    )
  })

  it('preLockStatus=selected, all fail → still restore to "selected" (avoids stuck generating)', async () => {
    mockCallAIWithLog.mockRejectedValue(new Error('AI fail'))
    const app = makeApp()
    const processor = createGenerateProcessor(app)
    await processor(makeJob('selected', [false, false, false]))

    expect(app.prisma.chapter.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: 'selected' } })
    )
  })

  it('preLockStatus=undefined (legacy queue job) → fallback to "draft" → restore to "generated"', async () => {
    mockCallAIWithLog.mockResolvedValue('content')
    const app = makeApp()
    const processor = createGenerateProcessor(app)
    await processor(makeJob(undefined, [true, true, true]))

    expect(app.prisma.chapter.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: 'generated' } })
    )
  })

  it('worker does NOT touch Chapter.content (additive invariant — spec §2.1.2)', async () => {
    mockCallAIWithLog.mockResolvedValue('content')
    const app = makeApp()
    const processor = createGenerateProcessor(app)
    await processor(makeJob('selected', [true, true, true]))

    const updateCall = app.prisma.chapter.update.mock.calls[0][0]
    expect(updateCall.data).not.toHaveProperty('content')
  })
})
