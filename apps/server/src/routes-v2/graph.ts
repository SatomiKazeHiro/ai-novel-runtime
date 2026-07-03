import type { FastifyInstance, FastifyReply } from 'fastify'
import { extractGraph } from '../services-v2/graph-extractor.js'
import { mergeGraph } from '../services-v2/graph-organizer.js'
import type { GraphData } from '../services-v2/graph-types.js'

/** JSON 字段损坏 → 422；空值/合法字符串 → 解析或空结构。损坏时给 reply 返回响应并返回 null */
function parseOrEmpty(
  raw: string | null,
  ctx: string,
  reply: FastifyReply
): { nodes: any[]; edges: any[] } | null {
  if (raw == null || raw === '') return { nodes: [], edges: [] }
  try { return JSON.parse(raw) } catch {
    reply.code(422).send({ success: false, error: `${ctx} JSON 解析失败: ${raw.slice(0, 80)}` })
    return null
  }
}

export async function v2GraphRoutes(app: FastifyInstance) {
  // GET /api/v2/graph?storyId=xxx — 获取故事最新的合并图谱
  app.get('/graph', async (request, reply) => {
    const { storyId } = request.query as { storyId?: string }
    if (!storyId) return { success: false, error: '缺少 storyId 参数' }

    const chapters = await app.prisma.v2Chapter.findMany({
      where: { storyId, mergedGraph: { not: null } },
      orderBy: { number: 'desc' },
      take: 1,
      select: { id: true, number: true, mergedGraph: true }
    })

    if (chapters.length === 0) {
      return { success: true, data: { nodes: [], edges: [], sourceChapterNumber: null } }
    }

    let merged: any
    try {
      merged = JSON.parse(chapters[0].mergedGraph!)
    } catch (err: any) {
      return reply.code(422).send({
        success: false,
        error: `第 ${chapters[0].number} 章 mergedGraph 损坏: ${(chapters[0].mergedGraph || '').slice(0, 80)}`
      })
    }
    return {
      success: true,
      data: {
        ...merged,
        sourceChapterNumber: chapters[0].number
      }
    }
  })

  // GET /api/v2/graph/:chapterId — 获取指定章节的图谱数据
  app.get('/graph/:chapterId', async (request, reply) => {
    const { chapterId } = request.params as { chapterId: string }
    const chapter = await app.prisma.v2Chapter.findUnique({
      where: { id: chapterId },
      select: { chapterGraph: true, mergedGraph: true, number: true }
    })
    if (!chapter) return { success: false, error: '章节不存在' }

    const chapterGraph = parseOrEmpty(chapter.chapterGraph, `第 ${chapter.number} 章 chapterGraph`, reply)
    if (chapterGraph === null) return
    const mergedGraph = parseOrEmpty(chapter.mergedGraph, `第 ${chapter.number} 章 mergedGraph`, reply)
    if (mergedGraph === null) return

    return {
      success: true,
      data: {
        chapterNumber: chapter.number,
        chapterGraph,
        mergedGraph
      }
    }
  })

  // POST /api/v2/graph/extract — AI 从正文提取本章图谱
  app.post('/graph/extract', async (request) => {
    const { storyId, content } = (request.body as any) || {}
    if (!storyId || !content) return { success: false, error: '缺少 storyId 或 content' }

    const data = await extractGraph(app.prisma, storyId, content)
    return { success: true, data }
  })

  // POST /api/v2/graph/merge — AI 合并本章图谱与总图谱
  app.post('/graph/merge', async (request) => {
    const { storyId, chapterGraph, previousMergedGraph } = (request.body as any) || {}
    if (!storyId || !chapterGraph) return { success: false, error: '缺少 storyId 或 chapterGraph' }

    const data = await mergeGraph(
      app.prisma,
      storyId,
      chapterGraph as GraphData,
      (previousMergedGraph as GraphData) || null
    )
    return { success: true, data }
  })

  // PUT /api/v2/graph/:chapterId — 保存编辑后的图谱到章节
  app.put('/graph/:chapterId', async (request) => {
    const { chapterId } = request.params as { chapterId: string }
    const { chapterGraph, mergedGraph } = (request.body as any) || {}

    const chapter = await app.prisma.v2Chapter.findUnique({ where: { id: chapterId } })
    if (!chapter) return { success: false, error: '章节不存在' }
    if (chapter.status === 'archived') return { success: false, error: '已归档章节不可编辑' }

    const update: Record<string, any> = {}
    if (chapterGraph !== undefined) {
      update.chapterGraph = chapterGraph ? JSON.stringify(chapterGraph) : null
    }
    if (mergedGraph !== undefined) {
      update.mergedGraph = mergedGraph ? JSON.stringify(mergedGraph) : null
    }

    if (Object.keys(update).length === 0) {
      return { success: false, error: '没有需要保存的数据' }
    }

    await app.prisma.v2Chapter.update({ where: { id: chapterId }, data: update })
    return { success: true }
  })
}
