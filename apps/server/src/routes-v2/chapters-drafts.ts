import type { FastifyInstance } from 'fastify'

/**
 * 候选文章路由：
 * - GET /api/v2/chapters/:chapterId/drafts — 列表
 * - DELETE /api/v2/drafts/:draftId — 删除
 * 原本挂在 chapters.ts 第 199-224 行（Q12-1 后下移），Q12-2 拆出。
 */
export async function v2ChapterDraftsRoutes(app: FastifyInstance) {
  // GET /api/v2/chapters/:chapterId/drafts — 候选文章列表
  app.get('/chapters/:chapterId/drafts', async (request) => {
    const { chapterId } = request.params as { chapterId: string }
    const drafts = await app.prisma.v2Draft.findMany({
      where: { chapterId },
      orderBy: { createdAt: 'desc' }
    })
    return { success: true, data: drafts }
  })

  // DELETE /api/v2/drafts/:draftId — 删除候选文章
  app.delete('/drafts/:draftId', async (request) => {
    const { draftId } = request.params as { draftId: string }
    const draft = await app.prisma.v2Draft.findUnique({
      where: { id: draftId },
      include: { chapter: { select: { status: true } } }
    })
    if (!draft) {
      return { success: false, error: '候选文章不存在' }
    }
    if (draft.chapter.status === 'archived') {
      return { success: false, error: '已归档章节的候选文章不可删除' }
    }
    await app.prisma.v2Draft.delete({ where: { id: draftId } })
    return { success: true }
  })
}
