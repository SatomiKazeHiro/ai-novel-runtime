import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createMockApp, callHandler } from '../setup.js'

// v4: GET display 端点用 fetchCharacterDisplay 服务,这里只 mock prisma + 验证路由参数透传
vi.mock('../../services/character-display.js', () => ({
  fetchCharacterDisplay: vi.fn()
}))
import { fetchCharacterDisplay } from '../../services/character-display.js'

const ROUTE = '/api/stories/:storyId/characters/display'

describe('GET /api/stories/:storyId/characters/display', () => {
  let mockPrisma: any
  let routes: Record<string, any>

  beforeEach(async () => {
    vi.clearAllMocks()
    mockPrisma = {
      character: { findMany: vi.fn().mockResolvedValue([]) },
      characterBranchState: { findMany: vi.fn().mockResolvedValue([]) }
    }
    const built = createMockApp(mockPrisma)
    const { characterRoutes } = await import('../../routes/characters.js')
    await characterRoutes(built.app)
    routes = built.routes
  })

  it('空 story → 返回 data: []', async () => {
    vi.mocked(fetchCharacterDisplay).mockResolvedValue([])
    const result = await callHandler(routes, 'GET', ROUTE, undefined, { storyId: 'story-empty' })
    expect(result.body).toEqual({ success: true, data: [] })
    expect(fetchCharacterDisplay).toHaveBeenCalledWith(mockPrisma, 'story-empty', null)
  })

  it('无 chapter 参数 → viewChapterNumber=null (透传)', async () => {
    vi.mocked(fetchCharacterDisplay).mockResolvedValue([])
    await callHandler(routes, 'GET', ROUTE, undefined, { storyId: 's1' })
    expect(fetchCharacterDisplay).toHaveBeenCalledWith(mockPrisma, 's1', null)
  })

  it('?chapter=3 → viewChapterNumber=3 (Number 转换)', async () => {
    vi.mocked(fetchCharacterDisplay).mockResolvedValue([])
    await callHandler(routes, 'GET', ROUTE, undefined, { storyId: 's1' }, { chapter: '3' })
    expect(fetchCharacterDisplay).toHaveBeenCalledWith(mockPrisma, 's1', 3)
  })

  it('?chapter=null 字符串 → 视为 null', async () => {
    vi.mocked(fetchCharacterDisplay).mockResolvedValue([])
    await callHandler(routes, 'GET', ROUTE, undefined, { storyId: 's1' }, { chapter: 'null' })
    expect(fetchCharacterDisplay).toHaveBeenCalledWith(mockPrisma, 's1', null)
  })

  it('?chapter=abc (非法) → 返回 400', async () => {
    const result = await callHandler(routes, 'GET', ROUTE, undefined, { storyId: 's1' }, { chapter: 'abc' })
    expect(result.status).toBe(400)
    expect(result.body.success).toBe(false)
    expect(result.body.error).toMatch(/invalid chapter/)
    expect(fetchCharacterDisplay).not.toHaveBeenCalled()
  })

  it('返回 fetchCharacterDisplay 结果作为 data', async () => {
    const fakeRows = [{ id: 'c1', name: '林凡', slug: 'linfan' }]
    vi.mocked(fetchCharacterDisplay).mockResolvedValue(fakeRows as any)
    const result = await callHandler(routes, 'GET', ROUTE, undefined, { storyId: 's1' })
    expect(result.body).toEqual({ success: true, data: fakeRows })
  })
})
