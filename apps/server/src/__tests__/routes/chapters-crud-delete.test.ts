import { describe, it, expect, vi } from 'vitest'
import { createMockApp, callHandler } from '../setup.js'

/**
 * DELETE /api/chapters/:chapterId — 归档章节删除的级联清理原子性回归。
 *
 * 覆盖 P1-2 修复：级联清理（memory / characterBranchState / plotArc / progressPoint）
 * + 删章节必须包在 $transaction 内，任一步失败整体回滚且错误向上冒泡（不吞错）。
 */
describe('DELETE /api/chapters/:chapterId — 归档章节删除', () => {
  function makePrisma() {
    const tx: any = {
      memory: { deleteMany: vi.fn().mockResolvedValue({ count: 3 }) },
      characterBranchState: { deleteMany: vi.fn().mockResolvedValue({ count: 2 }) },
      plotArc: {
        deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
        findMany: vi.fn().mockResolvedValue([]),
        update: vi.fn().mockResolvedValue({ id: 'arc' })
      },
      plotArcProgressPoint: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
      chapter: { delete: vi.fn().mockResolvedValue({ id: 'c1' }) }
    }
    const prisma: any = {
      tx,
      chapter: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'c1', storyId: 's1', status: 'archived', number: 5, childChapters: []
        }),
        // getLastChapter（无 status 过滤）→ 返回当前章节（即末尾）；prevChapter（status:'archived'）→ null
        findFirst: vi.fn().mockImplementation((args: any) =>
          Promise.resolve(args?.where?.status === 'archived' ? null : { id: 'c1', number: 5 })
        ),
        findMany: vi.fn().mockResolvedValue([]), // sideStories
        count: vi.fn().mockResolvedValue(1), // 非最后章节，跳过最后章节清理分支
        delete: vi.fn().mockResolvedValue({ id: 'c1' }) // 事务外删章节（归档分支不应调用）
      },
      $transaction: vi.fn(async (fn: any) => fn(tx))
    }
    return prisma
  }

  async function setup(mockPrisma: any) {
    const { chapterCrudRoutes } = await import('../../routes/chapters-crud.js')
    const built = createMockApp(mockPrisma)
    await chapterCrudRoutes(built.app)
    return built.routes
  }

  it('级联清理 + 删章节都在 $transaction 内原子执行', async () => {
    const prisma = makePrisma()
    const routes = await setup(prisma)
    const res = await callHandler(routes, 'DELETE', '/api/chapters/:chapterId', {}, { chapterId: 'c1' })

    expect(prisma.$transaction).toHaveBeenCalledTimes(1)
    expect(prisma.tx.memory.deleteMany).toHaveBeenCalledWith({
      where: { storyId: 's1', fromChapterNumber: 5 }
    })
    expect(prisma.tx.characterBranchState.deleteMany).toHaveBeenCalledWith({
      where: { storyId: 's1', fromChapterNumber: 5 }
    })
    expect(prisma.tx.plotArc.deleteMany).toHaveBeenCalledWith({
      where: { storyId: 's1', firstChapterNumber: 5 }
    })
    expect(prisma.tx.plotArcProgressPoint.deleteMany).toHaveBeenCalledWith({
      where: { arc: { storyId: 's1' }, chapterNumber: 5 }
    })
    expect(prisma.tx.chapter.delete).toHaveBeenCalledWith({ where: { id: 'c1' } })
    // 删章节只在事务内（tx.chapter.delete），不在事务外
    expect(prisma.chapter.delete).not.toHaveBeenCalled()
    expect(res.body).toEqual({ success: true })
  })

  it('级联清理任一步失败 → 错误冒泡（不吞错），且未执行到删章节', async () => {
    const prisma = makePrisma()
    prisma.tx.memory.deleteMany.mockRejectedValue(new Error('db locked'))
    const routes = await setup(prisma)
    await expect(
      callHandler(routes, 'DELETE', '/api/chapters/:chapterId', {}, { chapterId: 'c1' })
    ).rejects.toThrow('db locked')
    expect(prisma.tx.chapter.delete).not.toHaveBeenCalled()
  })
})
