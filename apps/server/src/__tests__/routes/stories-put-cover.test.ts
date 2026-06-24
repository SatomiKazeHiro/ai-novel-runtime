import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createMockApp, callHandler, createMockPrisma } from '../setup.js'

function fakeFile(opts: { mimetype: string; filename: string; content: Buffer }) {
  return {
    type: 'file' as const,
    fieldname: 'cover',
    mimetype: opts.mimetype,
    filename: opts.filename,
    toBuffer: async () => opts.content
  }
}

function fakeField(name: string, value: string) {
  return { type: 'field' as const, fieldname: name, value }
}

function buildMultipartRequest(parts: any[]) {
  return {
    isMultipart: () => true,
    file: async () => undefined,
    parts: async function* () { for (const p of parts) yield p }
  }
}

describe('PUT /:id — cover upload', () => {
  const ID = '97b9efa5-9cb4-4630-9d46-925ed0b08b2a'

  let mockPrisma: any
  let routes: Record<string, any>
  let coverStorageMock: any

  beforeEach(async () => {
    vi.clearAllMocks()
    mockPrisma = createMockPrisma({
      story: {
        findUnique: vi.fn().mockResolvedValue({ id: ID, coverUrl: null }),
        update: vi.fn().mockResolvedValue({ id: ID, coverUrl: `/uploads/covers/${ID}-1700000000000.jpg` })
      }
    })
    coverStorageMock = {
      saveCover: vi.fn().mockResolvedValue(`/uploads/covers/${ID}-1700000000000.jpg`),
      deleteCover: vi.fn().mockResolvedValue(undefined)
    }
    vi.resetModules()
    vi.doMock('../../lib/cover-storage.js', () => coverStorageMock)
    const { storyRoutes } = await import('../../routes/stories.js')
    const built = createMockApp(mockPrisma)
    await storyRoutes(built.app)
    routes = built.routes
  })

  it('accepts jpg cover, saves file, updates DB', async () => {
    const file = fakeFile({ mimetype: 'image/jpeg', filename: 'a.jpg', content: Buffer.from('jpg-bytes') })
    const req = buildMultipartRequest([fakeField('title', '长安·朱雀门'), file])
    const result = await callHandler(routes, 'PUT', '/:id', req, { id: ID })
    expect(result.status).not.toBe(400)
    expect(result.status).not.toBe(415)
    expect(result.body.success).toBe(true)
    expect(coverStorageMock.saveCover).toHaveBeenCalledWith(
      expect.any(String), ID, expect.any(Number), 'jpg', expect.any(Buffer)
    )
    expect(mockPrisma.story.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: ID },
        data: expect.objectContaining({ coverUrl: `/uploads/covers/${ID}-1700000000000.jpg` })
      })
    )
  })

  it('accepts png cover', async () => {
    const file = fakeFile({ mimetype: 'image/png', filename: 'a.png', content: Buffer.from('png') })
    const req = buildMultipartRequest([fakeField('title', '云中'), file])
    const result = await callHandler(routes, 'PUT', '/:id', req, { id: ID })
    expect(result.body.success).toBe(true)
    expect(coverStorageMock.saveCover).toHaveBeenCalledWith(expect.any(String), ID, expect.any(Number), 'png', expect.any(Buffer))
  })

  it('accepts webp cover', async () => {
    const file = fakeFile({ mimetype: 'image/webp', filename: 'a.webp', content: Buffer.from('webp') })
    const req = buildMultipartRequest([fakeField('title', '云中'), file])
    const result = await callHandler(routes, 'PUT', '/:id', req, { id: ID })
    expect(result.body.success).toBe(true)
    expect(coverStorageMock.saveCover).toHaveBeenCalledWith(expect.any(String), ID, expect.any(Number), 'webp', expect.any(Buffer))
  })

  it('rejects image/gif with 415 and does not save', async () => {
    const file = fakeFile({ mimetype: 'image/gif', filename: 'a.gif', content: Buffer.from('gif') })
    const req = buildMultipartRequest([fakeField('title', '长安'), file])
    const result = await callHandler(routes, 'PUT', '/:id', req, { id: ID })
    expect(result.status).toBe(415)
    expect(result.body.success).toBe(false)
    expect(coverStorageMock.saveCover).not.toHaveBeenCalled()
    expect(mockPrisma.story.update).not.toHaveBeenCalled()
  })

  it('removes existing cover when removeCover=true alongside new file', async () => {
    mockPrisma.story.findUnique.mockResolvedValue({ id: ID, coverUrl: `/uploads/covers/${ID}-1.jpg` })
    const file = fakeFile({ mimetype: 'image/jpeg', filename: 'a.jpg', content: Buffer.from('jpg') })
    const req = buildMultipartRequest([fakeField('title', '新标题'), fakeField('removeCover', 'true'), file])
    const result = await callHandler(routes, 'PUT', '/:id', req, { id: ID })
    expect(result.body.success).toBe(true)
    expect(coverStorageMock.deleteCover).toHaveBeenCalledWith(expect.any(String), `/uploads/covers/${ID}-1.jpg`)
  })

  it('clears coverUrl when removeCover=true without new file', async () => {
    mockPrisma.story.findUnique.mockResolvedValue({ id: ID, coverUrl: `/uploads/covers/${ID}-1.jpg` })
    const req = buildMultipartRequest([fakeField('title', '新标题'), fakeField('removeCover', 'true')])
    const result = await callHandler(routes, 'PUT', '/:id', req, { id: ID })
    expect(result.body.success).toBe(true)
    expect(coverStorageMock.deleteCover).toHaveBeenCalledWith(expect.any(String), `/uploads/covers/${ID}-1.jpg`)
    expect(mockPrisma.story.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ coverUrl: null })
      })
    )
  })

  it('works without file (no cover change)', async () => {
    const req = buildMultipartRequest([fakeField('title', '新标题')])
    const result = await callHandler(routes, 'PUT', '/:id', req, { id: ID })
    expect(result.body.success).toBe(true)
    expect(coverStorageMock.saveCover).not.toHaveBeenCalled()
    expect(mockPrisma.story.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: ID },
        data: expect.objectContaining({ title: '新标题' })
      })
    )
  })

  it('rolls back saved file when DB update fails (no orphan)', async () => {
    mockPrisma.story.update.mockRejectedValue(new Error('db down'))
    const file = fakeFile({ mimetype: 'image/jpeg', filename: 'a.jpg', content: Buffer.from('jpg') })
    const req = buildMultipartRequest([fakeField('title', 'X'), file])
    const result = await callHandler(routes, 'PUT', '/:id', req, { id: ID })
    expect(result.body.success).toBe(false)
    // saveCover was called, then we attempted to unlink the just-saved file
    expect(coverStorageMock.deleteCover).toHaveBeenCalledWith(expect.any(String), `/uploads/covers/${ID}-1700000000000.jpg`)
  })

  it('accepts plain JSON body when not multipart', async () => {
    const result = await callHandler(routes, 'PUT', '/:id', { title: 'Just JSON' }, { id: ID })
    expect(result.body.success).toBe(true)
    expect(coverStorageMock.saveCover).not.toHaveBeenCalled()
  })

  // REGRESSION: 前端 JSON 路径 (无 coverFile) 走"点移除封面→保存"时,
  // updateStorySchema 之前没有 removeCover 字段, zod 把它 strip 掉, 导致
  // coverUrl 永不清空、磁盘文件永不删除. 这里覆盖 bug 的精确路径.
  it('REGRESSION: JSON body with removeCover="true" clears coverUrl and deletes file', async () => {
    mockPrisma.story.findUnique.mockResolvedValue({ id: ID, coverUrl: `/uploads/covers/${ID}-1.jpg` })
    const result = await callHandler(routes, 'PUT', '/:id', { title: '新标题', removeCover: 'true' }, { id: ID })
    expect(result.status).not.toBe(400)
    expect(result.body.success).toBe(true)
    expect(coverStorageMock.deleteCover).toHaveBeenCalledWith(expect.any(String), `/uploads/covers/${ID}-1.jpg`)
    expect(mockPrisma.story.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ coverUrl: null })
      })
    )
  })

  it('JSON body with removeCover=true (boolean) is accepted', async () => {
    mockPrisma.story.findUnique.mockResolvedValue({ id: ID, coverUrl: `/uploads/covers/${ID}-1.jpg` })
    const result = await callHandler(routes, 'PUT', '/:id', { title: 'X', removeCover: true }, { id: ID })
    expect(result.body.success).toBe(true)
    expect(coverStorageMock.deleteCover).toHaveBeenCalled()
    expect(mockPrisma.story.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ coverUrl: null }) })
    )
  })

  it('removeCover is stripped from prisma update data (not written as a column)', async () => {
    mockPrisma.story.findUnique.mockResolvedValue({ id: ID, coverUrl: null })
    const result = await callHandler(routes, 'PUT', '/:id', { title: 'X', removeCover: 'true' }, { id: ID })
    expect(result.body.success).toBe(true)
    const updateArgs = mockPrisma.story.update.mock.calls[0]?.[0]
    expect(updateArgs.data).not.toHaveProperty('removeCover')
  })

  it('JSON body without removeCover leaves coverUrl untouched', async () => {
    mockPrisma.story.findUnique.mockResolvedValue({ id: ID, coverUrl: `/uploads/covers/${ID}-existing.jpg` })
    const result = await callHandler(routes, 'PUT', '/:id', { title: 'X' }, { id: ID })
    expect(result.body.success).toBe(true)
    expect(coverStorageMock.deleteCover).not.toHaveBeenCalled()
    const updateArgs = mockPrisma.story.update.mock.calls[0]?.[0]
    expect(updateArgs.data).not.toHaveProperty('coverUrl')
  })
})