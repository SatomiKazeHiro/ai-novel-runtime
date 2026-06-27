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

    // Merge 语义 (2026-06-27 修复): UI 默认 position 是该章节已有事件的最大 position,
    // 该 position 已存在 TimelineEvent row, prisma.timelineEvent.create 会抛 P2002
    // (unique on (storyId, position))。镜像 commitMemoryWrites: 找到已有 row 后
    // 把新 events 追加到 JSON 数组, update 而非 create。
    const existing = await app.prisma.timelineEvent.findUnique({
      where: { storyId_position: { storyId, position: body.position } }
    })
    if (existing) {
      let oldEvents: string[] = []
      try {
        const parsed = JSON.parse(existing.events)
        if (Array.isArray(parsed)) oldEvents = parsed
      } catch {
        // 历史脏数据:旧 events 字段不是合法 JSON, 视为空数组追加, 不丢新数据
      }
      const event = await app.prisma.timelineEvent.update({
        where: { id: existing.id },
        data: { events: JSON.stringify([...oldEvents, ...body.events]) }
      })
      return { success: true, data: event }
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
  //   - 改 position 时查 (storyId, position) 冲突, 撞别的 row 返 409, 让用户
  //     换 position 或先删目标 row (2026-06-27 回归: P2002 → 500)
  app.put('/api/timeline/:eventId', async (request, reply) => {
    const { eventId } = request.params as any
    const body = request.body as any

    const current = await app.prisma.timelineEvent.findUnique({ where: { id: eventId } })
    if (!current) {
      return reply.status(404).send({ success: false, error: 'Timeline event not found' })
    }

    if (body.position !== undefined && body.position !== current.position) {
      const conflict = await app.prisma.timelineEvent.findUnique({
        where: { storyId_position: { storyId: current.storyId, position: body.position } }
      })
      if (conflict && conflict.id !== eventId) {
        return reply.status(409).send({
          success: false,
          error: `目标 position ${body.position} 已被另一条事件占用 (id=${conflict.id}, fromChapterNumber=${conflict.fromChapterNumber ?? '未绑'}), 请换一个 position 或先删除目标行`
        })
      }
    }

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
