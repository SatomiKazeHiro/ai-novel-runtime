import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createMockApp, callHandler, createMockPrisma } from '../setup.js'

/**
 * apps/server/src/routes/timeline.ts 的 zod + 业务校验测试
 *
 * 历史 bug (2026-06-27): Timeline.vue 右上角"+ 添加事件"只发 {position, events},
 * server 直接 body.fromChapterNumber (undefined) 落库,DB 行 fromChapterNumber=NULL,
 * 这类事件在章节删除时幸存,与 archive 流程写入的有 fromChapterNumber
 * 事件行为不一致。修复: server 强制 fromChapterNumber 必填且必须对应
 * 已归档章节 (CreateTimelineEventRequestSchema + 业务校验)。
 *
 * 覆盖:
 *   1. zod 校验层: 缺字段 / 类型错 / 空 events / position 非法
 *   2. 业务校验层: fromChapterNumber 不在 storyId 范围 / 章节未归档
 *   3. happy path: 合法请求通过, prisma.timelineEvent.create 收到 fromChapterNumber
 *   4. PUT /api/timeline/:id 不动 (允许 null 保留, 不引入 fromChapterNumber 必填)
 */

describe('POST /api/stories/:storyId/timeline — CreateTimelineEventRequestSchema', () => {
  let mockPrisma: any
  let routes: Record<string, any>

  beforeEach(async () => {
    vi.clearAllMocks()
    mockPrisma = createMockPrisma({
      chapter: {
        ...createMockPrisma().chapter,
        // 默认业务校验通过: storyId=s1 下有 archived chapter number=1
        findFirst: vi.fn().mockImplementation(async ({ where }: any) => {
          if (where.storyId === 's1' && where.number === 1 && where.status === 'archived') {
            return { id: 'c1', storyId: 's1', number: 1, status: 'archived' }
          }
          return null
        })
      },
      timelineEvent: {
        ...createMockPrisma().timelineEvent,
        findUnique: vi.fn().mockResolvedValue(null),  // 默认: 同 position 不存在
        create: vi.fn().mockImplementation(async ({ data }: any) => ({
          id: 'te-new',
          storyId: data.storyId,
          fromChapterNumber: data.fromChapterNumber,
          position: data.position,
          events: data.events
        })),
        update: vi.fn().mockImplementation(async ({ where, data }: any) => ({
          id: where.id ?? where.eventId ?? 'te-updated',
          storyId: 's1',
          position: 1.00106,
          events: data.events
        }))
      }
    })
    const { timelineRoutes } = await import('../../routes/timeline.js')
    const built = createMockApp(mockPrisma)
    await timelineRoutes(built.app)
    routes = built.routes
  })

  it('accepts valid body and forwards fromChapterNumber to prisma.create (regression: 编辑期事件必须绑章节)', async () => {
    const result = await callHandler(
      routes, 'POST', '/api/stories/:storyId/timeline',
      { fromChapterNumber: 1, position: 1.00106, events: ['事件描述'] },
      { storyId: 's1' }
    )
    expect(result.status).not.toBe(400)
    expect(result.body).toEqual(expect.objectContaining({ success: true }))
    expect(mockPrisma.timelineEvent.create).toHaveBeenCalledTimes(1)
    const createArg = mockPrisma.timelineEvent.create.mock.calls[0][0]
    expect(createArg.data.fromChapterNumber).toBe(1)
    expect(createArg.data.storyId).toBe('s1')
    expect(createArg.data.position).toBe(1.00106)
    expect(createArg.data.events).toBe('["事件描述"]')
  })

  it('accepts side-story fromChapterNumber=1.01 (Float? column supports decimals)', async () => {
    mockPrisma.chapter.findFirst.mockImplementation(async ({ where }: any) => {
      if (where.storyId === 's1' && where.number === 1.01 && where.status === 'archived') {
        return { id: 'c-side', storyId: 's1', number: 1.01, status: 'archived' }
      }
      return null
    })
    const result = await callHandler(
      routes, 'POST', '/api/stories/:storyId/timeline',
      { fromChapterNumber: 1.01, position: 1.00106, events: ['番外事件'] },
      { storyId: 's1' }
    )
    expect(result.status).not.toBe(400)
    expect(result.body).toEqual(expect.objectContaining({ success: true }))
  })

  it('rejects missing fromChapterNumber (zod required)', async () => {
    const result = await callHandler(
      routes, 'POST', '/api/stories/:storyId/timeline',
      { position: 1.00106, events: ['x'] },
      { storyId: 's1' }
    )
    expect(result.status).toBe(400)
    expect(result.body).toEqual(
      expect.objectContaining({ success: false, error: expect.stringContaining('fromChapterNumber') })
    )
    expect(mockPrisma.timelineEvent.create).not.toHaveBeenCalled()
  })

  it('rejects fromChapterNumber=null (zod rejects undefined / null)', async () => {
    const result = await callHandler(
      routes, 'POST', '/api/stories/:storyId/timeline',
      { fromChapterNumber: null, position: 1.00106, events: ['x'] },
      { storyId: 's1' }
    )
    expect(result.status).toBe(400)
    expect(mockPrisma.timelineEvent.create).not.toHaveBeenCalled()
  })

  it('rejects missing events (zod required)', async () => {
    const result = await callHandler(
      routes, 'POST', '/api/stories/:storyId/timeline',
      { fromChapterNumber: 1, position: 1.00106 },
      { storyId: 's1' }
    )
    expect(result.status).toBe(400)
    expect(result.body).toEqual(
      expect.objectContaining({ success: false, error: expect.stringContaining('events') })
    )
  })

  it('rejects events=[] (zod min(1))', async () => {
    const result = await callHandler(
      routes, 'POST', '/api/stories/:storyId/timeline',
      { fromChapterNumber: 1, position: 1.00106, events: [] },
      { storyId: 's1' }
    )
    expect(result.status).toBe(400)
  })

  it('rejects position=NaN (zod refine via validateTimelinePosition)', async () => {
    const result = await callHandler(
      routes, 'POST', '/api/stories/:storyId/timeline',
      { fromChapterNumber: 1, position: 'not-a-number', events: ['x'] },
      { storyId: 's1' }
    )
    expect(result.status).toBe(400)
  })

  it('rejects when fromChapterNumber chapter not found in story (业务校验)', async () => {
    // 业务校验通过的前提: chapter.findFirst 找不到 → reject
    mockPrisma.chapter.findFirst.mockResolvedValue(null)
    const result = await callHandler(
      routes, 'POST', '/api/stories/:storyId/timeline',
      { fromChapterNumber: 99, position: 1.00106, events: ['x'] },
      { storyId: 's1' }
    )
    expect(result.status).toBe(400)
    expect(result.body).toEqual(
      expect.objectContaining({
        success: false,
        error: expect.stringMatching(/章节.*不存在.*未归档|归档/)
      })
    )
    expect(mockPrisma.timelineEvent.create).not.toHaveBeenCalled()
  })

  it('rejects when chapter exists but is not archived (e.g. draft / selected / reviewing)', async () => {
    // chapter.findFirst 用 status='archived' 过滤, 状态非 archived 直接查不到
    mockPrisma.chapter.findFirst.mockResolvedValue(null)  // archived=archived 不匹配 → null
    const result = await callHandler(
      routes, 'POST', '/api/stories/:storyId/timeline',
      { fromChapterNumber: 1, position: 1.00106, events: ['x'] },
      { storyId: 's1' }
    )
    expect(result.status).toBe(400)
    expect(mockPrisma.timelineEvent.create).not.toHaveBeenCalled()
  })

  it('merges events into existing row when (storyId, position) already exists (regression: P2002 on default position)', async () => {
    // 用户报告 500: 默认 position = 该章节已有事件的最大 position, 该 position 已
    // 存在 TimelineEvent row, prisma.timelineEvent.create 抛 P2002 (unique on
    // (storyId, position))。修复: 镜像 commitMemoryWrites 的 merge 语义 —
    // 找到已有 row, 把新 events 追加到 JSON 数组, update 而非 create。
    mockPrisma.timelineEvent.findUnique.mockResolvedValue({
      id: 'te-existing', storyId: 's1',
      fromChapterNumber: 1, position: 1.00106,
      events: '["已有事件"]',
      createdAt: new Date(),
      updatedAt: new Date()
    })
    mockPrisma.timelineEvent.update.mockImplementation(async ({ where, data }: any) => ({
      id: where.id, storyId: 's1', fromChapterNumber: 1,
      position: 1.00106, events: data.events
    }))

    const result = await callHandler(
      routes, 'POST', '/api/stories/:storyId/timeline',
      { fromChapterNumber: 1, position: 1.00106, events: ['新事件'] },
      { storyId: 's1' }
    )

    expect(result.status).not.toBe(500)
    expect(result.status).not.toBe(400)
    expect(result.body).toEqual(expect.objectContaining({ success: true }))
    // 不调用 create, 走 update
    expect(mockPrisma.timelineEvent.create).not.toHaveBeenCalled()
    expect(mockPrisma.timelineEvent.update).toHaveBeenCalledTimes(1)
    const updateArg = mockPrisma.timelineEvent.update.mock.calls[0][0]
    expect(updateArg.where.id).toBe('te-existing')
    // 合并: 已有 + 新
    const merged = JSON.parse(updateArg.data.events)
    expect(merged).toEqual(['已有事件', '新事件'])
  })
})

describe('PUT /api/timeline/:eventId — 编辑不改 fromChapterNumber', () => {
  let mockPrisma: any
  let routes: Record<string, any>

  beforeEach(async () => {
    vi.clearAllMocks()
    mockPrisma = createMockPrisma({
      timelineEvent: {
        ...createMockPrisma().timelineEvent,
        update: vi.fn().mockImplementation(async ({ where, data }: any) => ({
          id: where.eventId, ...data
        }))
      }
    })
    const { timelineRoutes } = await import('../../routes/timeline.js')
    const built = createMockApp(mockPrisma)
    await timelineRoutes(built.app)
    routes = built.routes
  })

  it('updates position and events without touching fromChapterNumber', async () => {
    const result = await callHandler(
      routes, 'PUT', '/api/timeline/:eventId',
      { position: 2.00106, events: ['updated'] },
      { eventId: 'te-1' }
    )
    expect(result.status).not.toBe(400)
    expect(result.body).toEqual(expect.objectContaining({ success: true }))
    expect(mockPrisma.timelineEvent.update).toHaveBeenCalledTimes(1)
    const updateArg = mockPrisma.timelineEvent.update.mock.calls[0][0]
    // 既不新增也不删 fromChapterNumber
    expect(updateArg.data).not.toHaveProperty('fromChapterNumber')
  })
})
