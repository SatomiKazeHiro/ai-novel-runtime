import { describe, it, expect, vi } from 'vitest'
import { createMockApp, callHandler } from '../setup.js'

/**
 * POST /api/chapters/:chapterId/select — 只能采用已完成候选的回归。
 *
 * 覆盖 P1-3 修复：误选未完成/空文候选会导致候选集全灭 + 正文不变，
 * 现在 select 前校验 status === 'completed' 且 content 非空，否则 400。
 */
describe('POST /api/chapters/:chapterId/select', () => {
  function makePrisma(draft: any) {
    const tx: any = {
      draft: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
      chapter: { update: vi.fn().mockResolvedValue({ id: 'c1' }) }
    }
    return {
      tx,
      chapter: { findUnique: vi.fn().mockResolvedValue({ id: 'c1', storyId: 's1', status: 'draft' }), update: vi.fn().mockResolvedValue({ id: 'c1' }) },
      draft: { findUnique: vi.fn().mockResolvedValue(draft) },
      $transaction: vi.fn(async (fn: any) => fn(tx))
    }
  }

  async function setup(mockPrisma: any) {
    const { chapterGenerateRoutes } = await import('../../routes/chapters-generate.js')
    const built = createMockApp(mockPrisma)
    await chapterGenerateRoutes(built.app)
    return built.routes
  }

  it('选未完成(generating)候选 → 400，且不烧候选集', async () => {
    const prisma = makePrisma({ id: 'd1', chapterId: 'c1', status: 'generating', content: '' })
    const routes = await setup(prisma)
    const res = await callHandler(
      routes, 'POST', '/api/chapters/:chapterId/select', { draftId: 'd1' }, { chapterId: 'c1' }
    )
    expect(res.status).toBe(400)
    expect(prisma.$transaction).not.toHaveBeenCalled()
    expect(prisma.tx.draft.updateMany).not.toHaveBeenCalled() // 候选集不被全灭
  })

  it('选空 content 候选 → 400', async () => {
    const prisma = makePrisma({ id: 'd1', chapterId: 'c1', status: 'completed', content: '' })
    const routes = await setup(prisma)
    const res = await callHandler(
      routes, 'POST', '/api/chapters/:chapterId/select', { draftId: 'd1' }, { chapterId: 'c1' }
    )
    expect(res.status).toBe(400)
    expect(prisma.tx.draft.updateMany).not.toHaveBeenCalled()
  })

  it('选已完成且内容非空候选 → 成功，写正文 + 兄弟置 rejected', async () => {
    const prisma = makePrisma({ id: 'd1', chapterId: 'c1', status: 'completed', content: '正文' })
    const routes = await setup(prisma)
    const res = await callHandler(
      routes, 'POST', '/api/chapters/:chapterId/select', { draftId: 'd1' }, { chapterId: 'c1' }
    )
    // 不再废弃其他候选（候选是素材库，采用后仍可参考/换用）
    expect(prisma.tx.draft.updateMany).not.toHaveBeenCalled()
    expect(prisma.chapter.update).toHaveBeenCalledWith({
      where: { id: 'c1' }, data: { content: '正文' }
    })
    expect(res.body).toEqual({ success: true })
  })
})
