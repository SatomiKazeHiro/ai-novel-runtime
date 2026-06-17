import { describe, it, expect, vi, beforeEach } from 'vitest'
import { truncateByParagraph } from '@novel-runtime/prompt-runtime'

// Mock deps so we can drive extractAll and observe the prompt it builds
const mockCallAIWithLog = vi.fn()
const mockLoadRuntimeBase = vi.fn()
const mockLoadWorkerTask = vi.fn()
const mockResolveProvider = vi.fn()

vi.mock('../services/ai-call-logger.js', () => ({
  callAIWithLog: (...args: any[]) => mockCallAIWithLog(...args)
}))
vi.mock('../services/runtime-loader.js', () => ({
  loadRuntimeBase: (...args: any[]) => mockLoadRuntimeBase(...args),
  loadWorkerTask: (...args: any[]) => mockLoadWorkerTask(...args)
}))
vi.mock('../services/ai-provider-init.js', () => ({
  resolveProvider: (...args: any[]) => mockResolveProvider(...args)
}))

import { extractAll, computeContentCharBudget } from '../services/combined-extractor.js'

const emptyPayload = {
  memories: { mainEvents: [], sideEvents: [], emotions: [], foreshadowing: [],
              relationshipChanges: [], characterStatusChanges: {},
              timelineDay: 1, summary: '', scenes: [] },
  graph: { nodes: [], edges: [] },
  plotArcs: { arcs: [] }
}

function buildPrisma() {
  return {
    character: { findMany: vi.fn().mockResolvedValue([]) },
    plotArc: { findMany: vi.fn().mockResolvedValue([]) },
    graphNode: { findMany: vi.fn().mockResolvedValue([]) }
  }
}

describe('computeContentCharBudget — pure helper (TDD anchor)', () => {
  it('default DeepSeek 64K context + 4K maxTokens → budget much larger than 8000', () => {
    // Bug fix anchor: 8000 was silently dropping 80%+ of long chapters.
    // New budget should be a meaningful fraction of 64K context.
    // Formula: floor(64K * 0.6) − 4096 − 2000 = 38400 − 4096 − 2000 = 32304 tokens
    //          × 2.0 chars/token = 64608 chars
    const { charBudget, tokenBudget } = computeContentCharBudget(64000, 4096)
    expect(tokenBudget).toBe(32304)
    expect(charBudget).toBe(64608)
    expect(charBudget).toBeGreaterThan(8000)
  })

  it('small 8K context + 1K maxTokens → much smaller budget', () => {
    // floor(8000 * 0.6) − 1000 − 2000 = 4800 − 1000 − 2000 = 1800 tokens
    // × 2.0 = 3600 chars
    const { charBudget, tokenBudget } = computeContentCharBudget(8000, 1000)
    expect(tokenBudget).toBe(1800)
    expect(charBudget).toBe(3600)
  })

  it('maxTokens larger than available → charBudget clamped to 0 (graceful)', () => {
    // floor(4000 * 0.6) − 5000 − 2000 = 2400 − 5000 − 2000 = -4600 → max(0, ...) = 0
    const { charBudget, tokenBudget } = computeContentCharBudget(4000, 5000)
    expect(tokenBudget).toBe(0)
    expect(charBudget).toBe(0)
  })

  it('contextLength = 0 → charBudget 0 (no budget, graceful)', () => {
    const { charBudget, tokenBudget } = computeContentCharBudget(0, 4096)
    expect(tokenBudget).toBe(0)
    expect(charBudget).toBe(0)
  })

  it('charBudget is always an integer (no fractional chars)', () => {
    const { charBudget, tokenBudget } = computeContentCharBudget(12345, 678)
    expect(Number.isInteger(charBudget)).toBe(true)
    expect(Number.isInteger(tokenBudget)).toBe(true)
  })
})

describe('extractAll — content budget (integration with extractAll)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockLoadRuntimeBase.mockResolvedValue({ identity: '', settings: {}, behavior: '', jailbreak: '' })
    mockLoadWorkerTask.mockResolvedValue({ workerType: 'memory', taskPrompt: '' })
    mockCallAIWithLog.mockResolvedValue('```json\n' + JSON.stringify(emptyPayload) + '\n```')
  })

  it('uses aiConfig contextLength + maxTokens to compute content budget (replaces 8000)', async () => {
    // Spec: aiConfig.contextLength=32000, maxTokens=4096
    //   tokenBudget = floor(32000 * 0.6) - 4096 - 2000 = 19200 - 4096 - 2000 = 13104
    //   charBudget  = 13104 * 2.0 = 26208
    // We use a small (4000) contextLength here just to make the test fast:
    //   tokenBudget = floor(4000 * 0.6) - 100 - 2000 = 2400 - 2100 = 300
    //   charBudget  = 300 * 2.0 = 600
    // The point is the budget is *computed from aiConfig*, not hardcoded 8000.
    mockResolveProvider.mockResolvedValue({
      provider: {},
      config: { contextLength: 4000, maxTokens: 100 }
    })

    const prisma = buildPrisma()
    const app: any = { prisma, log: { info: vi.fn(), error: vi.fn(), warn: vi.fn() } }

    // 100-char content (under 600 budget) — should be preserved fully
    const contentUnder = 'x'.repeat(100)
    await extractAll(app, 'c1', 's1', contentUnder, 'outline', 1)
    let userMessage: string = mockCallAIWithLog.mock.calls[0][1].compiled.userMessage
    expect(userMessage).toContain(contentUnder)  // not truncated

    // 1000-char content (over 600 budget) — should be truncated to ~600
    mockCallAIWithLog.mockClear()
    const contentOver = 'y'.repeat(1000)
    await extractAll(app, 'c2', 's2', contentOver, 'outline', 2)
    userMessage = mockCallAIWithLog.mock.calls[0][1].compiled.userMessage
    // The 8000-char hardcode would not truncate at all (since 1000 < 8000).
    // After the fix, content should be truncated to charBudget (600).
    const tailIdx = userMessage.lastIndexOf('章节内容如下：')
    const tail = userMessage.slice(tailIdx)
    expect(tail.length).toBeLessThan(contentOver.length + 200)  // truncated, not full 1000
    // Truncated content should be ≈ charBudget, which is 600. Plus the prefix
    // "章节内容如下：\n" is 7 chars, so total tail should be < 700.
    expect(tail.length).toBeLessThan(700)
  })

  it('logs TODO warn when content exceeds 90% of token budget', async () => {
    // Use a tight budget: contextLength=4000, maxTokens=100
    //   tokenBudget = floor(4000*0.6) - 100 - 2000 = 300 tokens
    //   charBudget  = 300 * 2.0 = 600 chars
    // To force 90% usage: need truncated content with ≥ 270 tokens.
    // 600 chars of 'z' (single token each in cl100k) → ~100-200 tokens.
    // Use 5000 chars → truncated to 600 → still ~100-200 tokens, won't hit 90%.
    // Use a higher maxTokens=800 → tokenBudget=2400-800-2000=max(0,-400)=0, fails.
    // Use contextLength=6000, maxTokens=200 → tokenBudget=3600-200-2000=1400, charBudget=2800.
    // 5000 chars truncated to 2800 → ~700+ tokens → 50% usage, won't hit 90%.
    // Strategy: drop CONTENT_BUDGET_HEADROOM via direct helper test instead.
    //   Actually use: contextLength=4000, maxTokens=80 → tokenBudget=2400-80-2000=320, charBudget=640.
    //   Need 288 tokens in 640 chars of 'z' → 'z' is 1 token, 640 z's = 640 tokens → 200% usage → warn fires.
    mockResolveProvider.mockResolvedValue({
      provider: {},
      config: { contextLength: 4000, maxTokens: 80 }
    })

    const prisma = buildPrisma()
    const log = { info: vi.fn(), error: vi.fn(), warn: vi.fn() }
    const app: any = { prisma, log }

    // 2000 chars of 'z' → truncated to charBudget=640 → 640 z tokens / 320 budget = 200% → warn fires
    const content = 'z'.repeat(2000)
    await extractAll(app, 'c1', 's1', content, 'outline', 1)

    expect(log.warn).toHaveBeenCalled()
    const warnCalls = log.warn.mock.calls.flat().join(' ')
    expect(warnCalls).toMatch(/TODO.*CombinedExtractor/)
    expect(warnCalls).toMatch(/budget/)
  })

  it('does NOT warn when content is well under budget', async () => {
    mockResolveProvider.mockResolvedValue({
      provider: {},
      config: { contextLength: 64000, maxTokens: 4096 }
    })

    const prisma = buildPrisma()
    const log = { info: vi.fn(), error: vi.fn(), warn: vi.fn() }
    const app: any = { prisma, log }

    // 1000 chars — trivially under 64608 budget
    await extractAll(app, 'c1', 's1', 'x'.repeat(1000), 'outline', 1)

    const warnCalls = log.warn.mock.calls.flat().join(' ')
    expect(warnCalls).not.toMatch(/TODO.*CombinedExtractor/)
  })

  it('falls back to defaults when resolveProvider returns null (no aiConfig)', async () => {
    // No AI provider configured → use 64000/4096 as fallback so the function
    // still works (it must not crash). Default charBudget = 64608.
    mockResolveProvider.mockResolvedValue(null)

    const prisma = buildPrisma()
    const log = { info: vi.fn(), error: vi.fn(), warn: vi.fn() }
    const app: any = { prisma, log }

    const content = 'a'.repeat(5000)  // well under 64608
    const result = await extractAll(app, 'c1', 's1', content, 'outline', 1)
    expect(result).not.toBeNull()  // extraction should still complete
  })
})
