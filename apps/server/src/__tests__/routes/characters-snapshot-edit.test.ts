import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createMockApp, callHandler } from '../setup.js'

const ROUTE = '/api/stories/:storyId/characters/:charId/snapshot/:chapterNumber'

describe('PUT /api/stories/:storyId/characters/:charId/snapshot/:chapterNumber', () => {
  let mockPrisma: any
  let routes: Record<string, any>

  beforeEach(async () => {
    vi.clearAllMocks()
    mockPrisma = {
      character: { findFirst: vi.fn().mockResolvedValue({ id: 'c1', storyId: 's1' }) },
      characterBranchState: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) }
    }
    const built = createMockApp(mockPrisma)
    const { characterRoutes } = await import('../../routes/characters.js')
    await characterRoutes(built.app)
    routes = built.routes
  })

  it('成功更新: status/relationships JSON.stringify + costume 透传 + chapterNumber 转 Number', async () => {
    const result = await callHandler(routes, 'PUT', ROUTE, {
      status: { realm: '练气' },
      relationships: { 林帆: '师徒' },
      costume: '青衫'
    }, { storyId: 's1', charId: 'c1', chapterNumber: '3' })
    expect(mockPrisma.characterBranchState.updateMany).toHaveBeenCalledWith({
      where: { characterId: 'c1', fromChapterNumber: 3 },
      data: { status: '{"realm":"练气"}', relationships: '{"林帆":"师徒"}', costume: '青衫' }
    })
    expect(result.body).toEqual({ success: true, data: { updated: 1 } })
  })

  it('costume 空白字符串 → 存 null (视同未描写)', async () => {
    await callHandler(routes, 'PUT', ROUTE, {
      status: { realm: '练气' },
      relationships: {},
      costume: '   '
    }, { storyId: 's1', charId: 'c1', chapterNumber: '3' })
    expect(mockPrisma.characterBranchState.updateMany).toHaveBeenCalledWith({
      where: { characterId: 'c1', fromChapterNumber: 3 },
      data: { status: '{"realm":"练气"}', relationships: '{}', costume: null }
    })
  })

  it('status/relationships 缺省或 null → 清空为 {}', async () => {
    await callHandler(routes, 'PUT', ROUTE, {
      status: null,
      relationships: null,
      costume: null
    }, { storyId: 's1', charId: 'c1', chapterNumber: '3' })
    expect(mockPrisma.characterBranchState.updateMany).toHaveBeenCalledWith({
      where: { characterId: 'c1', fromChapterNumber: 3 },
      data: { status: '{}', relationships: '{}', costume: null }
    })
  })

  it('该章无此角色快照 (updateMany count=0) → 404', async () => {
    mockPrisma.characterBranchState.updateMany.mockResolvedValue({ count: 0 })
    const result = await callHandler(routes, 'PUT', ROUTE, {
      status: {}, relationships: {}, costume: null
    }, { storyId: 's1', charId: 'c1', chapterNumber: '99' })
    expect(result.status).toBe(404)
    expect(result.body.success).toBe(false)
  })

  it('charId 不属于该 storyId → 404 Character not found', async () => {
    mockPrisma.character.findFirst.mockResolvedValue(null)
    const result = await callHandler(routes, 'PUT', ROUTE, {
      status: {}, relationships: {}, costume: null
    }, { storyId: 's1', charId: 'other', chapterNumber: '3' })
    expect(result.status).toBe(404)
    expect(result.body.success).toBe(false)
    expect(mockPrisma.characterBranchState.updateMany).not.toHaveBeenCalled()
  })

  it('status 为数组 → 400', async () => {
    const result = await callHandler(routes, 'PUT', ROUTE, {
      status: ['bad'], relationships: {}, costume: null
    }, { storyId: 's1', charId: 'c1', chapterNumber: '3' })
    expect(result.status).toBe(400)
    expect(result.body.success).toBe(false)
  })

  it('relationships 为字符串 → 400', async () => {
    const result = await callHandler(routes, 'PUT', ROUTE, {
      status: {}, relationships: 'bad', costume: null
    }, { storyId: 's1', charId: 'c1', chapterNumber: '3' })
    expect(result.status).toBe(400)
    expect(result.body.success).toBe(false)
  })

  it('chapterNumber 非法 → 400', async () => {
    const result = await callHandler(routes, 'PUT', ROUTE, {
      status: {}, relationships: {}, costume: null
    }, { storyId: 's1', charId: 'c1', chapterNumber: 'abc' })
    expect(result.status).toBe(400)
    expect(mockPrisma.characterBranchState.updateMany).not.toHaveBeenCalled()
  })
})
