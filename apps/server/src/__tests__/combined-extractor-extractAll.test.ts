import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock all of extractAll's runtime dependencies so we can drive
// `callAIWithLog` with controlled responses and observe how extractAll
// handles parse failures. The mocks are declared before the dynamic
// import of combined-extractor (vi.mock is hoisted).
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

import { extractAll } from '../services/combined-extractor.js'

function buildPrisma() {
  return {
    character: {
      findMany: vi.fn().mockResolvedValue([])
    },
    plotArc: {
      findMany: vi.fn().mockResolvedValue([])
    },
    graphNode: {
      findMany: vi.fn().mockResolvedValue([])
    }
  }
}

const validJsonPayload = {
  memories: {
    mainEvents: [],
    sideEvents: [],
    emotions: [],
    foreshadowing: [],
    relationshipChanges: [],
    characterStatusChanges: {},
    timelineDay: 1,
    summary: '',
    scenes: []
  },
  graph: { nodes: [], edges: [] },
  plotArcs: { arcs: [] }
}

describe('extractAll — AI call configuration (L1)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockLoadRuntimeBase.mockResolvedValue({
      identity: '', settings: {}, behavior: '', jailbreak: ''
    })
    mockLoadWorkerTask.mockResolvedValue({
      workerType: 'memory', taskPrompt: ''
    })
    mockCallAIWithLog.mockResolvedValue(
      '```json\n' + JSON.stringify(validJsonPayload) + '\n```'
    )
  })

  it('omits hardcoded maxTokens — falls back to aiConfig.maxTokens via provider', async () => {
    // Combined extraction is the heaviest AI call in the system
    // (memories + graph + plotArcs in one shot). A hardcoded 4096 max
    // budget was causing markdown-wrapped responses to be truncated
    // mid-JSON, surfacing as a generic "AI 提取返回为空" 500 to the user.
    // The fix: let callAIWithLog fall back to aiConfig.maxTokens so
    // users can tune the budget in ModelManager without a code change.
    const prisma = buildPrisma()
    const app: any = { prisma, log: { info: vi.fn(), error: vi.fn(), warn: vi.fn() } }

    await extractAll(app, 'c1', 's1', 'content', 'outline', 1)

    expect(mockCallAIWithLog).toHaveBeenCalledTimes(1)
    const options = mockCallAIWithLog.mock.calls[0][1]
    // maxTokens must NOT be present (or must be undefined) so the
    // provider's `options?.maxTokens ?? aiConfig.maxTokens` chain kicks
    // in and uses whatever the user configured in ModelManager.
    expect(options.maxTokens).toBeUndefined()
  })
})

describe('extractAll — parse failure propagation (L3)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockLoadRuntimeBase.mockResolvedValue({
      identity: '', settings: {}, behavior: '', jailbreak: ''
    })
    mockLoadWorkerTask.mockResolvedValue({
      workerType: 'memory', taskPrompt: ''
    })
  })

  it('throws (not returns null) when AI response is truncated markdown', async () => {
    // 用户的真实 bug 场景：responseContent 是 ```json 开头但被截断的 JSON。
    // 旧实现：cleanJsonBlock 吞掉 ```json → JSON.parse 抛 SyntaxError →
    //   extractAll catch 吞掉 → 返回 null → 路由「AI 提取返回为空」（误导）
    // 新实现：cleanJsonBlock 检测到不完整 fence 抛清晰错误 → extractAll
    //   不再吞错 → 路由 catch 把真错误（含 maxTokens 提示）透传到前端
    mockCallAIWithLog.mockResolvedValue('```json\n{"a":1,"b":')

    const prisma = buildPrisma()
    const app: any = { prisma, log: { info: vi.fn(), error: vi.fn(), warn: vi.fn() } }

    await expect(extractAll(app, 'c1', 's1', 'content', 'outline', 1))
      .rejects.toThrow(/未闭合|截断|maxTokens/)
  })

  it('throws when AI response is invalid JSON (no markdown fence)', async () => {
    // 老实现同样吞掉此错误。新实现让真错误透传。
    mockCallAIWithLog.mockResolvedValue('this is not json at all')

    const prisma = buildPrisma()
    const app: any = { prisma, log: { info: vi.fn(), error: vi.fn(), warn: vi.fn() } }

    await expect(extractAll(app, 'c1', 's1', 'content', 'outline', 1))
      .rejects.toThrow()
  })

  it('returns null when callAIWithLog returns null (AI provider unavailable)', async () => {
    // AI 调用失败（无 provider / 网络错误）仍走老路径返回 null，
    // 让 prepareArchiveData 在路由 catch 之前就知道 AI 没响应。
    mockCallAIWithLog.mockResolvedValue(null)

    const prisma = buildPrisma()
    const app: any = { prisma, log: { info: vi.fn(), error: vi.fn(), warn: vi.fn() } }

    const result = await extractAll(app, 'c1', 's1', 'content', 'outline', 1)
    expect(result).toBeNull()
  })

  it('returns parsed data on valid markdown-wrapped JSON (regression)', async () => {
    mockCallAIWithLog.mockResolvedValue(
      '```json\n' + JSON.stringify(validJsonPayload) + '\n```'
    )

    const prisma = buildPrisma()
    const app: any = { prisma, log: { info: vi.fn(), error: vi.fn(), warn: vi.fn() } }

    const result = await extractAll(app, 'c1', 's1', 'content', 'outline', 1)
    expect(result).not.toBeNull()
    expect(result?.memories?.summary).toBe('')
    expect(result?.graph?.nodes).toEqual([])
  })

  it('retries once with format hint when AI returns unparseable JSON, returns 2nd result on success', async () => {
    // 用户真实场景：AI 偶发返回严重损坏的 JSON（不是简单的"裸 &"问题，
    // cleanJsonBlock 修不了整个 token 错位 / 多重结构错误）。按用户约束
    // "以稳为主、允许多调几次 AI 兜底"，extractAll 应自动 retry 一次。
    // 第二次返回合法 JSON → 用第二次结果，调用方无感知。
    mockCallAIWithLog
      .mockResolvedValueOnce('{"a":1,,,b:2 garbage not json at all ~~~')
      .mockResolvedValueOnce(
        '```json\n' + JSON.stringify(validJsonPayload) + '\n```'
      )

    const prisma = buildPrisma()
    const app: any = { prisma, log: { info: vi.fn(), error: vi.fn(), warn: vi.fn() } }

    const result = await extractAll(app, 'c1', 's1', 'content', 'outline', 1)
    expect(mockCallAIWithLog).toHaveBeenCalledTimes(2)
    // 第二次调用应带"上次返回格式错误"的提示（让 AI 知道要更严格按 JSON 返回）
    const secondOptions = mockCallAIWithLog.mock.calls[1][1]
    expect(secondOptions.callType).toBe('combined_extract_retry')
    expect(result).not.toBeNull()
    expect(result?.graph?.nodes).toEqual([])
  })

  it('throws when BOTH AI responses are unparseable (retry exhausted)', async () => {
    // 重试兜底仍失败：必须把错误抛给上游（保持 L3 现有"parse 失败应 throw"语义），
    // 让路由 catch 把真实错误透传到前端，而不是 swallow 后返回误导的 null。
    mockCallAIWithLog
      .mockResolvedValueOnce('garbage response 1')
      .mockResolvedValueOnce('still garbage response 2')

    const prisma = buildPrisma()
    const app: any = { prisma, log: { info: vi.fn(), error: vi.fn(), warn: vi.fn() } }

    await expect(extractAll(app, 'c1', 's1', 'content', 'outline', 1))
      .rejects.toThrow(/已重试|重试.*失败|格式错误/)
  })

  it('does NOT retry on transient API failure (network error) — returns null as before', async () => {
    // 网络/Provider 错误走的是 catch 块返回 null（不是 parse 失败），
    // 不应触发 retry。retry 只针对"AI 返回了内容但内容不可解析"。
    mockCallAIWithLog.mockRejectedValue(new Error('fetch failed: ECONNREFUSED'))

    const prisma = buildPrisma()
    const app: any = { prisma, log: { info: vi.fn(), error: vi.fn(), warn: vi.fn() } }

    const result = await extractAll(app, 'c1', 's1', 'content', 'outline', 1)
    expect(result).toBeNull()
    expect(mockCallAIWithLog).toHaveBeenCalledTimes(1)
  })
})
