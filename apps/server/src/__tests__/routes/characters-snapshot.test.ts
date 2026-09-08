import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createMockApp, callHandler } from '../setup.js'

vi.mock('../../services/character-display.js', () => ({
  fetchCharacterDisplay: vi.fn()
}))
import { fetchCharacterDisplay } from '../../services/character-display.js'

const ROUTE = '/api/stories/:storyId/characters/:charId/snapshot'

describe('GET /api/stories/:storyId/characters/:charId/snapshot', () => {
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

  it('未传 chapter → viewChapterNumber=null,透传 charId', async () => {
    vi.mocked(fetchCharacterDisplay).mockResolvedValue([{ id: 'c1', name: '林凡', slug: 'linfan', protagonist: false, identity: [], appearance: [], temperament: [], personality: [], speechStyle: [], relationships: null, status: null, baseRelationships: null, baseStatus: null, costume: null }] as any)
    await callHandler(routes, 'GET', ROUTE, undefined, { storyId: 's1', charId: 'c1' })
    expect(fetchCharacterDisplay).toHaveBeenCalledWith(mockPrisma, 's1', null, 'c1')
  })

  it('?chapter=3 → 透传 Number 3', async () => {
    vi.mocked(fetchCharacterDisplay).mockResolvedValue([{ id: 'c1', name: '林凡', slug: 'linfan', protagonist: false, identity: [], appearance: [], temperament: [], personality: [], speechStyle: [], relationships: null, status: null, baseRelationships: null, baseStatus: null, costume: null }] as any)
    await callHandler(routes, 'GET', ROUTE, undefined, { storyId: 's1', charId: 'c1' }, { chapter: '3' })
    expect(fetchCharacterDisplay).toHaveBeenCalledWith(mockPrisma, 's1', 3, 'c1')
  })

  it('?chapter=null 字符串 → null', async () => {
    vi.mocked(fetchCharacterDisplay).mockResolvedValue([])
    await callHandler(routes, 'GET', ROUTE, undefined, { storyId: 's1', charId: 'c1' }, { chapter: 'null' })
    expect(fetchCharacterDisplay).toHaveBeenCalledWith(mockPrisma, 's1', null, 'c1')
  })

  it('?chapter=abc → 400', async () => {
    const result = await callHandler(routes, 'GET', ROUTE, undefined, { storyId: 's1', charId: 'c1' }, { chapter: 'abc' })
    expect(result.status).toBe(400)
    expect(fetchCharacterDisplay).not.toHaveBeenCalled()
  })

  it('角色不存在 → 404', async () => {
    vi.mocked(fetchCharacterDisplay).mockResolvedValue([])
    const result = await callHandler(routes, 'GET', ROUTE, undefined, { storyId: 's1', charId: 'missing' })
    expect(result.status).toBe(404)
    expect(result.body.success).toBe(false)
  })
  it('返回 fetchCharacterDisplay 数组的第一项作为 data (单对象,不是数组)', async () => {
    const row = { id: 'c1', name: '林凡', slug: 'linfan', protagonist: false, identity: [], appearance: [], temperament: [], personality: [], speechStyle: [], relationships: null, status: null, baseRelationships: null, baseStatus: null, costume: null }
    vi.mocked(fetchCharacterDisplay).mockResolvedValue([row] as any)
    const result = await callHandler(routes, 'GET', ROUTE, undefined, { storyId: 's1', charId: 'c1' })
    expect(result.body).toEqual({ success: true, data: row })
  })
})
