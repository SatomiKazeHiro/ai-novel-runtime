import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createMockApp, callHandler, createMockPrisma } from '../setup.js'

// 本文件专门覆盖 chapters.ts 6 个 body endpoint 的 zod 校验行为。
// 单元粒度:每个 schema 1 个 happy(返回成功或进入业务分支) + 1 个 negative(zod 拒绝,返回 400)。
// 业务逻辑的 happy/negative 在其他 __tests__/routes/*-test.ts 里覆盖,本文件不重复。

describe('POST /stories/:storyId/chapters — CreateChapterRequestSchema', () => {
  let mockPrisma: any
  let routes: Record<string, any>

  beforeEach(async () => {
    vi.clearAllMocks()
    mockPrisma = createMockPrisma({
      chapter: {
        ...createMockPrisma().chapter,
        count: vi.fn().mockResolvedValue(0),     // 无现存章节 → 通过「非首章」校验
        findFirst: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({
          id: 'c1', storyId: 's1', number: 1, isSideStory: false,
          title: 't', outline: '', status: 'draft'
        })
      }
    })
    const { chapterRoutes } = await import('../../routes/chapters.js')
    const built = createMockApp(mockPrisma)
    await chapterRoutes(built.app)
    routes = built.routes
  })

  it('accepts valid body (title only)', async () => {
    const result = await callHandler(
      routes, 'POST', '/api/stories/:storyId/chapters',
      { title: 'Chapter 1' },
      { storyId: 's1' }
    )
    expect(result.status).not.toBe(400)
    expect(result.body).toEqual(expect.objectContaining({ success: true }))
  })

  it('rejects missing title with 400 + zod error', async () => {
    const result = await callHandler(
      routes, 'POST', '/api/stories/:storyId/chapters',
      { outline: 'no title' },
      { storyId: 's1' }
    )
    expect(result.status).toBe(400)
    expect(result.body).toEqual(
      expect.objectContaining({ success: false, error: expect.stringContaining('title') })
    )
    expect(mockPrisma.chapter.create).not.toHaveBeenCalled()
  })
})

describe('PUT /chapters/:chapterId — UpdateChapterRequestSchema', () => {
  let mockPrisma: any
  let routes: Record<string, any>

  beforeEach(async () => {
    vi.clearAllMocks()
    mockPrisma = createMockPrisma({
      chapter: {
        ...createMockPrisma().chapter,
        findUnique: vi.fn().mockResolvedValue({
          id: 'c1', storyId: 's1', status: 'draft', title: 't'
        }),
        update: vi.fn().mockResolvedValue({ id: 'c1' })
      }
    })
    const { chapterRoutes } = await import('../../routes/chapters.js')
    const built = createMockApp(mockPrisma)
    await chapterRoutes(built.app)
    routes = built.routes
  })

  it('accepts valid partial update', async () => {
    const result = await callHandler(
      routes, 'PUT', '/api/chapters/:chapterId',
      { title: 'New Title' },
      { chapterId: 'c1' }
    )
    expect(result.status).not.toBe(400)
    expect(result.body).toEqual(expect.objectContaining({ success: true }))
  })

  it('rejects wrong type (title must be string)', async () => {
    const result = await callHandler(
      routes, 'PUT', '/api/chapters/:chapterId',
      { title: 123 },
      { chapterId: 'c1' }
    )
    expect(result.status).toBe(400)
    expect(result.body).toEqual(
      expect.objectContaining({ success: false, error: expect.stringContaining('title') })
    )
    expect(mockPrisma.chapter.update).not.toHaveBeenCalled()
  })
})