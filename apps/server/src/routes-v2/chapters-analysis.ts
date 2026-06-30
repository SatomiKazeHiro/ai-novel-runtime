import type { FastifyInstance } from 'fastify'
import { extractCharacters } from '../services-v2/character-extractor.js'
import { extractMemories } from '../services-v2/memory-extractor.js'
import { extractPlotArcs } from '../services-v2/plot-arc-extractor.js'

function getPending(analysis: any) {
  if (!analysis) return {}
  try { return JSON.parse(analysis) } catch { return {} }
}

export async function v2ChapterAnalysisRoutes(app: FastifyInstance) {
  // GET /api/v2/chapters/:chapterId/analysis — 获取当前分析结果
  app.get('/chapters/:chapterId/analysis', async (request) => {
    const { chapterId } = request.params as { chapterId: string }
    const chapter = await app.prisma.v2Chapter.findUnique({
      where: { id: chapterId },
      select: { pendingAnalysis: true, analysisId: true, contentHash: true }
    })
    if (!chapter) return { success: false, error: '章节不存在' }
    return {
      success: true,
      data: {
        analysis: getPending(chapter.pendingAnalysis),
        analysisId: chapter.analysisId,
        contentHash: chapter.contentHash,
        isStale: chapter.analysisId !== chapter.contentHash
      }
    }
  })

  // POST /api/v2/chapters/:chapterId/analyze/characters
  app.post('/chapters/:chapterId/analyze/characters', async (request) => {
    const { chapterId } = request.params as { chapterId: string }
    const chapter = await app.prisma.v2Chapter.findUnique({ where: { id: chapterId } })
    if (!chapter) return { success: false, error: '章节不存在' }
    if (chapter.status === 'archived') return { success: false, error: '已归档章节不可分析' }
    if (!chapter.content) return { success: false, error: '请先输入正文' }

    const result = await extractCharacters(app.prisma, chapter.storyId, chapter.content)
    const pending = getPending(chapter.pendingAnalysis)
    pending.characters = { extractedAt: new Date().toISOString(), items: result.characters }
    await app.prisma.v2Chapter.update({
      where: { id: chapterId },
      data: { pendingAnalysis: JSON.stringify(pending) }
    })
    return { success: true, data: result }
  })

  // POST /api/v2/chapters/:chapterId/analyze/memories
  app.post('/chapters/:chapterId/analyze/memories', async (request) => {
    const { chapterId } = request.params as { chapterId: string }
    const chapter = await app.prisma.v2Chapter.findUnique({ where: { id: chapterId } })
    if (!chapter) return { success: false, error: '章节不存在' }
    if (chapter.status === 'archived') return { success: false, error: '已归档章节不可分析' }
    if (!chapter.content) return { success: false, error: '请先输入正文' }

    const result = await extractMemories(app.prisma, chapter.storyId, chapter.number, chapter.content)
    const pending = getPending(chapter.pendingAnalysis)
    pending.memories = {
      extractedAt: new Date().toISOString(),
      chapterMemories: result.chapterMemories,
      globalMemories: result.globalMemories,
      sceneMemories: result.sceneMemories
    }
    await app.prisma.v2Chapter.update({
      where: { id: chapterId },
      data: { pendingAnalysis: JSON.stringify(pending) }
    })
    return { success: true, data: result }
  })

  // POST /api/v2/chapters/:chapterId/analyze/plot-arcs
  app.post('/chapters/:chapterId/analyze/plot-arcs', async (request) => {
    const { chapterId } = request.params as { chapterId: string }
    const chapter = await app.prisma.v2Chapter.findUnique({ where: { id: chapterId } })
    if (!chapter) return { success: false, error: '章节不存在' }
    if (chapter.status === 'archived') return { success: false, error: '已归档章节不可分析' }
    if (!chapter.content) return { success: false, error: '请先输入正文' }

    const result = await extractPlotArcs(app.prisma, chapter.storyId, chapter.content)
    const pending = getPending(chapter.pendingAnalysis)
    pending.plotArcs = { extractedAt: new Date().toISOString(), arcs: result.arcs }
    await app.prisma.v2Chapter.update({
      where: { id: chapterId },
      data: { pendingAnalysis: JSON.stringify(pending) }
    })
    return { success: true, data: result }
  })

  // POST /api/v2/chapters/:chapterId/analyze/timeline — 空实现
  app.post('/chapters/:chapterId/analyze/timeline', async (request) => {
    const { chapterId } = request.params as { chapterId: string }
    const chapter = await app.prisma.v2Chapter.findUnique({ where: { id: chapterId } })
    if (!chapter) return { success: false, error: '章节不存在' }
    if (chapter.status === 'archived') return { success: false, error: '已归档章节不可分析' }

    const pending = getPending(chapter.pendingAnalysis)
    pending.timeline = { extractedAt: new Date().toISOString() }
    await app.prisma.v2Chapter.update({
      where: { id: chapterId },
      data: { pendingAnalysis: JSON.stringify(pending) }
    })
    return { success: true, data: { message: '时间线分析暂未实现' } }
  })

  // POST /api/v2/chapters/:chapterId/analyze/graph — 空实现
  app.post('/chapters/:chapterId/analyze/graph', async (request) => {
    const { chapterId } = request.params as { chapterId: string }
    const chapter = await app.prisma.v2Chapter.findUnique({ where: { id: chapterId } })
    if (!chapter) return { success: false, error: '章节不存在' }
    if (chapter.status === 'archived') return { success: false, error: '已归档章节不可分析' }

    const pending = getPending(chapter.pendingAnalysis)
    pending.graph = { extractedAt: new Date().toISOString() }
    await app.prisma.v2Chapter.update({
      where: { id: chapterId },
      data: { pendingAnalysis: JSON.stringify(pending) }
    })
    return { success: true, data: { message: '图谱分析暂未实现' } }
  })

  // POST /api/v2/chapters/:chapterId/save-analysis — 保存分析结果
  app.post('/chapters/:chapterId/save-analysis', async (request) => {
    const { chapterId } = request.params as { chapterId: string }
    const chapter = await app.prisma.v2Chapter.findUnique({ where: { id: chapterId } })
    if (!chapter) return { success: false, error: '章节不存在' }
    if (chapter.status === 'archived') return { success: false, error: '已归档章节不可操作' }
    if (!chapter.pendingAnalysis) return { success: false, error: '请先执行分析' }

    await app.prisma.v2Chapter.update({
      where: { id: chapterId },
      data: { analysisId: chapter.contentHash, status: 'analyzing' }
    })
    return { success: true, data: { analysisId: chapter.contentHash } }
  })
}
