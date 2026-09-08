import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createMockApp, callHandler } from '../setup.js'

// v4 拆分: archive confirm 路由严格校验 PendingArchiveDataV4 + 5 stage,
// raw 从 memoryExtract 取,优化融合从 memoryOptimize 取。
// 本文件验证:
//   1. v3 payload 直接 400 version-mismatch
//   2. memoryOptimize.status='failed' → 400
//   3. memoryExtract.status='failed' → 400
//   4. 5 stage 全 success → Memory 三层 (chapter/scene/global) + Chapter 三列 + 翻 archived

const ts = '2026-07-31T00:00:00.000Z'

const extractResult = {
  mainEvents: [
    { description: '主要事件A', importance: 8 },
    { description: '主要事件B', importance: 7 }
  ],
  sideEvents: [{ description: '次要事件', importance: 5 }],
  emotions: ['紧张', '期待'],
  foreshadowing: ['伏笔1'],
  relationshipChanges: ['关系变化1'],
  scenes: [{ location: '楼道', event: '对话', importance: 7 }],
  summary: '本章摘要'
}

const optimizeMemories = [
  { content: '全局记忆1', originUid: 'NEW', importance: 7, type: 'event' as const },
  { content: '全局记忆2', originUid: 'U-EXIST', importance: 6, type: 'state' as const }
]

/** 构造 v4 pendingArchiveData JSON,5 stage 状态可分别覆盖 */
function makePendingV4(opts: {
  memoryExtract?: any
  memoryOptimize?: any
  character?: any
  plotArc?: any
  graph?: any
  cumulativeGraph?: any
  cumulativeGraphGeneratedAt?: string
} = {}) {
  const defaults = {
    character: { status: 'success', result: { characterStates: [] }, completedAt: ts },
    memoryExtract: { status: 'success', result: extractResult, completedAt: ts },
    memoryOptimize: { status: 'success', result: { memories: optimizeMemories }, completedAt: ts },
    plotArc: { status: 'success', result: { plotArcs: [] }, completedAt: ts },
    graph: { status: 'success', result: { chapterGraph: { nodes: [], edges: [], timestamp: ts } }, completedAt: ts }
  }
  return JSON.stringify({
    version: 4,
    stages: {
      character: { ...defaults.character, ...(opts.character || {}) },
      memoryExtract: { ...defaults.memoryExtract, ...(opts.memoryExtract || {}) },
      memoryOptimize: { ...defaults.memoryOptimize, ...(opts.memoryOptimize || {}) },
      plotArc: { ...defaults.plotArc, ...(opts.plotArc || {}) },
      graph: { ...defaults.graph, ...(opts.graph || {}) }
    },
    cumulativeGraph: opts.cumulativeGraph ?? { nodes: [], edges: [], timestamp: ts },
    cumulativeGraphGeneratedAt: opts.cumulativeGraphGeneratedAt ?? ts,
    meta: { extractedAt: ts, chapterNumber: 1 }
  })
}

/** 构造 v3 payload (旧版) */
function makePendingV3() {
  return JSON.stringify({
    version: 3,
    stages: {
      character: { status: 'success', result: { characterStates: [] } },
      memory: {
        status: 'success',
        result: {
          mainEvents: [], sideEvents: [], emotions: [], foreshadowing: [],
          relationshipChanges: [], scenes: [], summary: 'v3', memories: []
        }
      },
      plotArc: { status: 'success', result: { plotArcs: [] } },
      graph: { status: 'success', result: { chapterGraph: { nodes: [], edges: [] } } }
    },
    cumulativeGraph: { nodes: [], edges: [] },
    cumulativeGraphGeneratedAt: ts,
    meta: { chapterNumber: 1 }
  })
}

function makeChapter(pendingArchiveData: string | null) {
  return {
    id: 'abc',
    storyId: 's1',
    status: 'reviewing',
    isSideStory: false,
    content: 'a'.repeat(200),
    outline: 'short outline',
    number: 1,
    parentChapterId: null,
    pendingArchiveData,
    chapterGraph: null,
    cumulativeGraph: null
  }
}

function makePrisma() {
  const tx: any = {
    chapter: { update: vi.fn().mockResolvedValue({}), updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    character: { create: vi.fn().mockResolvedValue({ id: 'new-char-id' }) },
    memory: { create: vi.fn().mockResolvedValue({ id: 'mem-row' }) },
    characterBranchState: { create: vi.fn().mockResolvedValue({ id: 'cbs-row' }) },
    plotArc: {
      findMany: vi.fn().mockResolvedValue([]),
      create: vi.fn().mockResolvedValue({ id: 'arc-row' }),
      update: vi.fn().mockResolvedValue({ id: 'arc-row' })
    }
  }
  return {
    tx,
    chapter: {
      findUnique: vi.fn(),
      findFirst: vi.fn().mockResolvedValue(null),
      update: vi.fn(),
      updateMany: vi.fn()
    },
    character: { findMany: vi.fn().mockResolvedValue([]) },
    characterBranchState: { findMany: vi.fn().mockResolvedValue([]) },
    plotArc: { findMany: vi.fn().mockResolvedValue([]) },
    memory: { create: vi.fn().mockResolvedValue({ id: 'mem-row' }) },
    $transaction: vi.fn(async (fn: any) => fn(tx))
  }
}

async function setupRoutes(mockPrisma: any) {
  const { chapterArchiveRoutes } = await import('../../routes/chapters-archive.js')
  const built = createMockApp(mockPrisma)
  await chapterArchiveRoutes(built.app)
  return built.routes
}

const ROUTE = '/api/chapters/:chapterId/archive'

describe('archive confirm v4 — strict 5-stage validation + split data sources', () => {
  let mockPrisma: any
  let routes: Record<string, any>

  beforeEach(async () => {
    vi.clearAllMocks()
    mockPrisma = makePrisma()
    routes = await setupRoutes(mockPrisma)
  })

  it('rejects v3 payload with 400 version-mismatch', async () => {
    mockPrisma.chapter.findUnique.mockResolvedValue(makeChapter(makePendingV3()))

    const result = await callHandler(routes, 'POST', ROUTE, undefined, { chapterId: 'abc' })

    expect(result.status).toBe(400)
    expect(result.body.success).toBe(false)
    // 中文 error 提示用户重新准备归档
    expect(result.body.error).toMatch(/版本不匹配|重新准备/)
    // 不能写库
    expect(mockPrisma.$transaction).not.toHaveBeenCalled()
  })

  it('rejects when memoryOptimize.status=failed', async () => {
    mockPrisma.chapter.findUnique.mockResolvedValue(
      makeChapter(makePendingV4({
        memoryOptimize: { status: 'failed', errorMessage: 'optimizer boom', completedAt: ts }
      }))
    )

    const result = await callHandler(routes, 'POST', ROUTE, undefined, { chapterId: 'abc' })

    expect(result.status).toBe(400)
    expect(result.body.success).toBe(false)
    expect(result.body.error).toMatch(/memoryOptimize/)
    expect(mockPrisma.$transaction).not.toHaveBeenCalled()
  })

  it('rejects when memoryExtract.status=failed', async () => {
    mockPrisma.chapter.findUnique.mockResolvedValue(
      makeChapter(makePendingV4({
        memoryExtract: { status: 'failed', errorMessage: 'extract boom', completedAt: ts }
      }))
    )

    const result = await callHandler(routes, 'POST', ROUTE, undefined, { chapterId: 'abc' })

    expect(result.status).toBe(400)
    expect(result.body.success).toBe(false)
    expect(result.body.error).toMatch(/memoryExtract/)
    expect(mockPrisma.$transaction).not.toHaveBeenCalled()
  })

  it('rejects when stages is missing (no Object.entries crash)', async () => {
    mockPrisma.chapter.findUnique.mockResolvedValue(
      makeChapter(JSON.stringify({ version: 4 }))
    )

    const result = await callHandler(routes, 'POST', ROUTE, undefined, { chapterId: 'abc' })

    expect(result.status).toBe(400)
    expect(result.body.success).toBe(false)
    expect(result.body.error).toMatch(/stages/)
    expect(mockPrisma.$transaction).not.toHaveBeenCalled()
  })

  it('rejects when a required stage is missing (e.g. graph)', async () => {
    const payload = JSON.parse(makePendingV4())
    delete payload.stages.graph
    mockPrisma.chapter.findUnique.mockResolvedValue(makeChapter(JSON.stringify(payload)))

    const result = await callHandler(routes, 'POST', ROUTE, undefined, { chapterId: 'abc' })

    expect(result.status).toBe(400)
    expect(result.body.success).toBe(false)
    expect(result.body.error).toMatch(/graph/)
    expect(mockPrisma.$transaction).not.toHaveBeenCalled()
  })

  it('writes memory from memoryExtract (raw) + memoryOptimize (global) when all 5 stages success', async () => {
    mockPrisma.chapter.findUnique.mockResolvedValue(makeChapter(makePendingV4()))

    const result = await callHandler(routes, 'POST', ROUTE, undefined, { chapterId: 'abc' })

    expect(result.status).toBeUndefined()
    expect(result.body).toMatchObject({ success: true })
    expect(result.body.data).toMatchObject({ archived: true })

    // tx.memory.create 必须被调:3 条 mainEvents(2) + sideEvents(1) + 情绪(2) + 伏笔(1) + 关系(1) + scene(1) + global(2) = 10
    // 完整列出:
    //   mainEvents[2] (auto-extracted + main-plot) = 2
    //   sideEvents[1] (auto-extracted) = 1
    //   emotions[2] (auto-extracted) = 2
    //   foreshadowing[1] (auto-extracted) = 1
    //   relationshipChanges[1] (auto-extracted) = 1
    //   scenes[1] (auto-extracted + scene-memory) = 1
    //   optimized[2] (auto-extracted + event/state) = 2
    // 合计 10
    const memoryCreateCalls = mockPrisma.tx.memory.create.mock.calls
    expect(memoryCreateCalls).toHaveLength(10)

    // 验证 layer 分布
    const layerCounts = memoryCreateCalls.reduce((acc: Record<string, number>, c: any[]) => {
      const layer = c[0]?.data?.layer
      if (layer) acc[layer] = (acc[layer] || 0) + 1
      return acc
    }, {})
    expect(layerCounts.chapter).toBe(7) // 2 main + 1 side + 2 emotion + 1 foreshadow + 1 relationship
    expect(layerCounts.scene).toBe(1)
    expect(layerCounts.global).toBe(2)

    // 验证 raw → chapter 行: mainEvents[0] 应带 main-plot tag
    const mainPlotRows = memoryCreateCalls.filter(
      (c: any[]) => c[0]?.data?.tags?.includes('main-plot')
    )
    expect(mainPlotRows).toHaveLength(2)
    expect(mainPlotRows[0][0].data.content).toBe('主要事件A')

    // 验证 raw → chapter 行: sideEvents / emotions / foreshadow / relationship 都带 auto-extracted 不带 main-plot
    const chapterNonMainRows = memoryCreateCalls.filter(
      (c: any[]) => c[0]?.data?.layer === 'chapter' && !c[0]?.data?.tags?.includes('main-plot')
    )
    expect(chapterNonMainRows).toHaveLength(5)

    // 验证 scene 行: tags 含 scene-memory
    const sceneRows = memoryCreateCalls.filter(
      (c: any[]) => c[0]?.data?.layer === 'scene'
    )
    expect(sceneRows).toHaveLength(1)
    expect(sceneRows[0][0].data.content).toContain('楼道')

    // 验证 global 行: 来自 memoryOptimize.result.memories (2 条),'NEW' 应被替换成实际 UID
    const globalRows = memoryCreateCalls.filter(
      (c: any[]) => c[0]?.data?.layer === 'global'
    )
    expect(globalRows).toHaveLength(2)
    const newGlobal = globalRows.find((c: any[]) => c[0].data.content === '全局记忆1')
    expect(newGlobal).toBeDefined()
    // originUid === 'NEW' → 替换成 `${chapterNumber}#${4位hex}`
    expect(newGlobal![0].data.originUid).toMatch(/^1#[0-9A-F]{4}$/)
    expect(newGlobal![0].data.category).toBe('event_memory')
    const existGlobal = globalRows.find((c: any[]) => c[0].data.content === '全局记忆2')
    expect(existGlobal).toBeDefined()
    // 继承的旧 UID 不动
    expect(existGlobal![0].data.originUid).toBe('U-EXIST')
    expect(existGlobal![0].data.category).toBe('state')

    // 验证 tx.chapter.updateMany（乐观锁）: summary + status=archived + pendingArchiveData=null + chapterGraph + cumulativeGraph
    const chapterUpdateCalls = mockPrisma.tx.chapter.updateMany.mock.calls.filter(
      (c: any[]) => c[0]?.data?.status === 'archived'
    )
    expect(chapterUpdateCalls.length).toBeGreaterThan(0)
    const archivedUpdate = chapterUpdateCalls[chapterUpdateCalls.length - 1][0]
    expect(archivedUpdate.data).toMatchObject({
      summary: extractResult.summary,
      status: 'archived',
      pendingArchiveData: null
    })
    // chapterGraph 来自 pending.stages.graph.result.chapterGraph (JSON string)
    expect(archivedUpdate.data.chapterGraph).toBe(JSON.stringify({ nodes: [], edges: [], timestamp: ts }))
    // cumulativeGraph 来自 pending.cumulativeGraph
    expect(archivedUpdate.data.cumulativeGraph).toBe(
      JSON.stringify({ nodes: [], edges: [], timestamp: ts })
    )
    expect(archivedUpdate.data.cumulativeGraphGeneratedAt).toBeInstanceOf(Date)

    // 验证 $transaction 被调
    expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1)
  })
})

describe('archive confirm v4 — character resolve + commit', () => {
  let mockPrisma: any
  let routes: Record<string, any>

  beforeEach(async () => {
    vi.clearAllMocks()
    mockPrisma = makePrisma()
    routes = await setupRoutes(mockPrisma)
  })

  it('新角色进入 → Character 表 +1, CharacterBranchState 表 +1, base 关系/状态为 null', async () => {
    const basePending1 = JSON.parse(makePendingV4())
    const pendingWithIsNew = JSON.stringify({
      ...basePending1,
      stages: {
        ...basePending1.stages,
        character: {
          status: 'success',
          result: {
            characterStates: [
              {
                characterId: null,
                name: '神秘人',
                key: 'shenmi_ren',
                status: { realm: '筑基' },
                relationships: {},
                costume: '黑袍',
                isNew: true
              }
            ]
          }
        }
      }
    })

    mockPrisma.chapter.findUnique.mockResolvedValue(makeChapter(pendingWithIsNew))

    const result = await callHandler(routes, 'POST', ROUTE, undefined, { chapterId: 'ch-1' })

    expect(result.body).toMatchObject({ success: true })
    expect(mockPrisma.tx.character.create).toHaveBeenCalledTimes(1)
    expect(mockPrisma.tx.character.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        slug: 'shenmi_ren',
        name: '神秘人',
        relationships: '{}',
        status: '{}'
      })
    })
    expect(mockPrisma.tx.characterBranchState.create).toHaveBeenCalledTimes(1)
    expect(mockPrisma.tx.characterBranchState.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        characterId: 'new-char-id',
        fromChapterNumber: 1,
        costume: '黑袍'
      })
    })
  })

  it('slug+name 冲突 → 返回 409 + payload.conflicts, 章节保持 reviewing', async () => {
    const basePending2 = JSON.parse(makePendingV4())
    const pendingWithConflict = JSON.stringify({
      ...basePending2,
      stages: {
        ...basePending2.stages,
        character: {
          status: 'success',
          result: {
            characterStates: [
              {
                characterId: null,
                name: '林峰',  // AI 返回的 name
                key: 'linfan', // AI 返回的 key,与已有 slug 撞
                status: {},
                relationships: {},
                isNew: true
              }
            ]
          }
        }
      }
    })
    // 已有 slug='linfan', name='林凡' 的角色
    mockPrisma.character.findMany.mockResolvedValue([
      { id: 'char-linfan', slug: 'linfan', name: '林凡' }
    ])
    mockPrisma.chapter.findUnique.mockResolvedValue(makeChapter(pendingWithConflict))

    const result = await callHandler(routes, 'POST', ROUTE, undefined, { chapterId: 'ch-1' })

    expect(result.status).toBe(409)
    expect(result.body).toMatchObject({
      success: false,
      error: 'character write conflict'
    })
    expect(result.body.conflicts).toHaveLength(1)
    expect(result.body.conflicts[0].reason).toBe('slug_name_mismatch')
    expect(result.body.conflicts[0].existingCharacter.name).toBe('林凡')
    // 章节未翻 archived
    expect(mockPrisma.chapter.update).not.toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'archived' }) })
    )
  })

  it('reviewingPanel 已纠正 isNew=true → 命中已有角色, 不新建 Character', async () => {
    // ReviewingPanel 纠正后:characterId 已指向现有角色, isNew=false
    const basePending = JSON.parse(makePendingV4())
    const pendingCorrected = JSON.stringify({
      ...basePending,
      stages: {
        ...basePending.stages,
        character: {
          status: 'success',
          result: {
            characterStates: [
              {
                characterId: 'char-linfan',
                name: '林凡',
                key: 'linfan',
                status: { realm: '筑基' },
                relationships: {},
                isNew: false
              }
            ]
          }
        }
      }
    })

    mockPrisma.chapter.findUnique.mockResolvedValue(makeChapter(pendingCorrected))

    const result = await callHandler(routes, 'POST', ROUTE, undefined, { chapterId: 'ch-1' })

    expect(result.body).toMatchObject({ success: true })
    expect(mockPrisma.tx.character.create).not.toHaveBeenCalled()
    expect(mockPrisma.tx.characterBranchState.create).toHaveBeenCalledTimes(1)
    expect(mockPrisma.tx.characterBranchState.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        characterId: 'char-linfan'
      })
    })
  })
})
