import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createMockApp, callHandler } from '../setup.js'

const ts = '2026-07-25T00:00:00.000Z'

const matchedState = {
  characterId: 'char-1',
  name: '姜禾',
  key: 'jiang_he',
  status: '{"rank":"练气","location":"楼道"}',
  relationships: '{"许青":"朋友"}',
  isNew: false
}

const newCharacterState = {
  characterId: null,
  name: '神秘女子',
  key: 'unknown_woman',
  status: '{"rank":"未知"}',
  relationships: '{}',
  isNew: true
}

const basePending = {
  version: 4,
  stages: {
    character: {
      status: 'success',
      result: { characterStates: [matchedState, newCharacterState] }
    },
    memoryExtract: {
      status: 'success',
      result: {
        mainEvents: [{ description: '主角觉醒', importance: 8 }],
        sideEvents: [],
        emotions: [],
        foreshadowing: [],
        relationshipChanges: [],
        scenes: [],
        summary: '主角觉醒',
        memories: []
      }
    },
    memoryOptimize: {
      status: 'success',
      result: { memories: [] }
    },
    plotArc: { status: 'success', result: { plotArcs: [] } },
    graph: {
      status: 'success',
      result: { chapterGraph: { nodes: [], edges: [] } },
      completedAt: ts
    }
  },
  cumulativeGraph: { nodes: [], edges: [] },
  cumulativeGraphGeneratedAt: ts,
  meta: { chapterNumber: 1 }
}

const baseChapter = {
  id: 'ch-1',
  storyId: 'test-story',
  number: 1,
  title: '第1章 测试',
  status: 'reviewing',
  isSideStory: false,
  content: 'a'.repeat(200),
  outline: 'short',
  pendingArchiveData: JSON.stringify(basePending),
  chapterGraph: null,
  cumulativeGraph: null
}

describe('archive v3 — CharacterBranchState 写库 (P0 修复)', () => {
  let mockPrisma: any
  let routes: Record<string, any>
  let log: any

  beforeEach(async () => {
    vi.clearAllMocks()
    log = { info: vi.fn(), error: vi.fn(), warn: vi.fn() }
    mockPrisma = {
      chapter: {
        findUnique: vi.fn(),
        update: vi.fn(),
        updateMany: vi.fn().mockResolvedValue({ count: 1 })
      },
      character: { findMany: vi.fn().mockResolvedValue([]), create: vi.fn().mockResolvedValue({ id: 'new-char-id' }) },
      characterBranchState: { create: vi.fn().mockResolvedValue({ id: 'cbs-1' }) },
      plotArc: {
        findMany: vi.fn().mockResolvedValue([]),
        create: vi.fn().mockResolvedValue({ id: 'arc-1' })
      },
      memory: { create: vi.fn().mockResolvedValue({ id: 'mem-1' }) },
      $transaction: vi.fn(async (fn: any) => fn(mockPrisma))
    }
    const { chapterArchiveRoutes } = await import('../../routes/chapters-archive.js')
    const built = createMockApp(mockPrisma, log)
    await chapterArchiveRoutes(built.app)
    routes = built.routes
  })

  it('happy path: archive confirm 触发 commitCharacterBranchStateWrites → CharacterBranchState 表新增 (matched)', async () => {
    mockPrisma.chapter.findUnique.mockResolvedValue({ ...baseChapter })

    const result = await callHandler(
      routes, 'POST', '/api/chapters/:chapterId/archive',
      undefined, { chapterId: 'ch-1' }
    )

    expect(result.body).toMatchObject({ success: true })
    // matched 那条 → 1 branchState.create
    // isNew 那条 → 自动建 character + branchState
    expect(mockPrisma.characterBranchState.create).toHaveBeenCalledTimes(2)
    expect(mockPrisma.character.create).toHaveBeenCalledTimes(1)
    expect(mockPrisma.characterBranchState.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        characterId: 'char-1',
        fromChapterNumber: baseChapter.number,
        status: matchedState.status,
        relationships: matchedState.relationships
      })
    })
    // 章节翻 archived
    expect(mockPrisma.chapter.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'archived' })
      })
    )
  })

  it('isNew skip: characterStates 全是 isNew → create 不被调, 章节仍翻 archived', async () => {
    mockPrisma.chapter.findUnique.mockResolvedValue({
      ...baseChapter,
      pendingArchiveData: JSON.stringify({
        ...basePending,
        stages: {
          ...basePending.stages,
          character: {
            status: 'success',
            result: { characterStates: [newCharacterState] }
          }
        }
      })
    })

    const result = await callHandler(
      routes, 'POST', '/api/chapters/:chapterId/archive',
      undefined, { chapterId: 'ch-1' }
    )

    expect(result.body).toMatchObject({ success: true })
    expect(mockPrisma.character.create).toHaveBeenCalledTimes(1)
    expect(mockPrisma.characterBranchState.create).toHaveBeenCalledTimes(1)
    // 章节仍翻 archived
    expect(mockPrisma.chapter.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'archived' })
      })
    )
  })

  it('rollback: characterBranchState.create 抛错 → 整 transaction rollback, chapter 保持 reviewing', async () => {
    mockPrisma.chapter.findUnique.mockResolvedValue({ ...baseChapter })
    // 让 characterBranchState.create 抛错 (模拟 FK 约束 / 字段异常)
    mockPrisma.characterBranchState.create.mockRejectedValue(new Error('cbs.create failed'))

    await expect(
      callHandler(routes, 'POST', '/api/chapters/:chapterId/archive', undefined, { chapterId: 'ch-1' })
    ).rejects.toThrow(/cbs.create failed/)
    // 章节 status 没翻 archived (rollback 生效) — tx.chapter.updateMany 在 commitCharacterBranchStateWrites 之后调用
    const updateCalls = mockPrisma.chapter.updateMany.mock.calls
    const archivedUpdate = updateCalls.find((c: any[]) => c[0]?.data?.status === 'archived')
    expect(archivedUpdate).toBeUndefined()
  })
})
