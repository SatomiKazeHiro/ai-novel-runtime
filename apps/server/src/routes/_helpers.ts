import type { FastifyReply, FastifyRequest } from 'fastify'
import type { ZodSchema } from 'zod'

/**
 * 安全解析 request.body。
 * - 成功:返回 parseResult.data
 * - 失败:reply.status(400).send({ success: false, error: ... }) 后返回 null
 *
 * 调用方模式:
 *   const body = parseBody(XxxRequestSchema, request, reply)
 *   if (body === null) return
 *
 * 错误格式 byte-identical 到 P2b inline 格式(path-prefixed, '; ' join)。
 */
export function parseBody<T>(
  schema: ZodSchema<T>,
  request: FastifyRequest,
  reply: FastifyReply
): T | null {
  const result = schema.safeParse(request.body)
  if (!result.success) {
    reply.status(400).send({
      success: false,
      error: result.error.errors
        .map(e => `${e.path.join('.') || '<root>'}: ${e.message}`)
        .join('; ')
    })
    return null
  }
  return result.data
}

/**
 * 用 chapterId 取 chapter,不存在则 404 + 返回 null。
 *
 * 调用方模式:
 *   const chapter = await getOrThrowChapter(prisma, chapterId, reply)
 *   if (chapter === null) return
 */
export async function getOrThrowChapter(
  prisma: any,
  chapterId: string,
  reply: FastifyReply
): Promise<any | null> {
  const chapter = await prisma.chapter.findUnique({ where: { id: chapterId } })
  if (!chapter) {
    reply.status(404).send({ success: false, error: 'Chapter not found' })
    return null
  }
  return chapter
}

/**
 * 故事下 number 最大的章节(主+番外)。
 * 跨 3 子 route 文件复用:chapters-crud.ts (DELETE + develop) / chapters-generate.ts (preview)。
 */
export async function getLastChapter(prisma: any, storyId: string): Promise<any | null> {
  return prisma.chapter.findFirst({
    where: { storyId },
    orderBy: { number: 'desc' }
  })
}
