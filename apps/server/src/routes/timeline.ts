import type { FastifyInstance } from 'fastify'
import { CreateTimelineEventRequestSchema } from '@novel-runtime/shared'
import { parseBody } from './_helpers.js'

export async function timelineRoutes(app: FastifyInstance) {
  // GET /api/stories/:id/timeline
  app.get('/api/stories/:storyId/timeline', async (request, reply) => {
    const { storyId } = request.params as any
    const events = await app.prisma.timelineEvent.findMany({
      where: { storyId },
      orderBy: { position: 'asc' }
    })
    return { success: true, data: events }
  })

  // POST /api/stories/:id/timeline
  //   - zod 校验 (CreateTimelineEventRequestSchema): fromChapterNumber / position / events 必填且合法
  //   - 业务校验: fromChapterNumber 必须对应同 storyId 下的 archived chapter
  //     (主线 number=1/2/3..., 番外 number=1.01/1.02... 都可; draft / selected / reviewing 不收)
  //   强一致的语义 (2026-06-27): 所有 UI 入口创建的事件必须有 fromChapterNumber,
  //   才能跟随 chapters-crud.ts:176-178 的 cascade 在删除章节时一起清理。
  //   历史 fromChapterNumber=NULL 行保留不动 (向前兼容)。
  app.post('/api/stories/:storyId/timeline', async (request, reply) => {
    const { storyId } = request.params as any
    const body = parseBody(CreateTimelineEventRequestSchema, request, reply)
    if (body === null) return

    // 业务校验: 章节必须存在且已归档
    const chapter = await app.prisma.chapter.findFirst({
      where: { storyId, number: body.fromChapterNumber, status: 'archived' },
      select: { id: true, number: true, status: true }
    })
    if (!chapter) {
      return reply.status(400).send({
        success: false,
        error: `章节不存在或未归档 (storyId=${storyId}, fromChapterNumber=${body.fromChapterNumber})`
      })
    }

    const event = await app.prisma.timelineEvent.create({
      data: {
        storyId,
        fromChapterNumber: body.fromChapterNumber,
        position: body.position,
        events: JSON.stringify(body.events)
      }
    })
    return { success: true, data: event }
  })

  // PUT /api/timeline/:eventId
  //   - 仅改 position / events. 不动 fromChapterNumber (2026-06-27 决定:
  //     Timeline.vue 编辑 modal 不弹章节选择器, 见 docs/ISSUES.md)
  app.put('/api/timeline/:eventId', async (request, reply) => {
    const { eventId } = request.params as any
    const body = request.body as any
    const data: any = {}
    if (body.position !== undefined) data.position = body.position
    if (body.events !== undefined) data.events = JSON.stringify(body.events)
    const event = await app.prisma.timelineEvent.update({
      where: { id: eventId },
      data
    })
    return { success: true, data: event }
  })

  // DELETE /api/timeline/:eventId
  app.delete('/api/timeline/:eventId', async (request, reply) => {
    const { eventId } = request.params as any
    await app.prisma.timelineEvent.delete({ where: { id: eventId } })
    return { success: true }
  })
}
