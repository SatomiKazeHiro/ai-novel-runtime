import type { FastifyInstance } from 'fastify'
import { extractCharacters } from '../services-v2/character-extractor.js'
import { extractMemories } from '../services-v2/memory-extractor.js'
import { extractPlotArcs } from '../services-v2/plot-arc-extractor.js'
import { extractTimeline } from '../services-v2/timeline-extractor.js'
import { extractGraph } from '../services-v2/graph-extractor.js'
import { mergeGraph } from '../services-v2/graph-organizer.js'
import type { GraphData } from '../services-v2/graph-types.js'
import { resolveProvider } from '../services/ai-provider-init.js'
import { computeExtractorCharBudget } from '../services-v2/content-budget.js'

function getPending(raw: any): Record<string, any> {
  if (raw == null || raw === '') return {}
  try { return JSON.parse(raw) } catch {
    throw new Error(`pendingAnalysis JSON 解析失败: ${String(raw).slice(0, 80)}`)
  }
}

async function runAnalyzer(key: string, prisma: any, app: any, chapter: any): Promise<Record<string, any>> {
  const startTime = Date.now()
  const base = { extractedAt: new Date().toISOString(), durationMs: Date.now() - startTime }

  // 章节内容预算：按 model contextLength 动态算 (替代 8000 字硬截断)。
  // resolveProvider 失败 / 无 config 时降级 8000，保持旧行为不崩。
  let contentCharBudget = 8000
  try {
    const resolved = await resolveProvider(prisma, chapter.storyId)
    if (resolved?.config) {
      contentCharBudget = computeExtractorCharBudget(
        resolved.config.contextLength ?? 64000,
        resolved.config.maxTokens ?? 4096
      )
    }
  } catch (err: any) {
    app.log.warn(`[V2-Analysis] resolveProvider 失败, 章节内容预算降级 8000: ${err?.message || err}`)
  }

  try {
    switch (key) {
      case 'characters': {
        const result = await extractCharacters(prisma, chapter.storyId, chapter.content, contentCharBudget)
        if (!result.ok) return { status: 'failed', error: result.error, ...base }
        return { status: 'success', ...base, items: result.data.characters }
      }
      case 'memories': {
        const result = await extractMemories(prisma, chapter.storyId, chapter.number, chapter.content, contentCharBudget)
        if (!result.ok) return { status: 'failed', error: result.error, ...base }
        return { status: 'success', ...base, chapterMemories: result.data.chapterMemories, globalMemories: result.data.globalMemories, sceneMemories: result.data.sceneMemories }
      }
      case 'plotArcs': {
        const result = await extractPlotArcs(prisma, chapter.storyId, chapter.content, contentCharBudget)
        if (!result.ok) return { status: 'failed', error: result.error, ...base }
        return { status: 'success', ...base, arcs: result.data.arcs }
      }
      case 'timeline': {
        const result = await extractTimeline(prisma, chapter.storyId, chapter.content, contentCharBudget)
        if (!result.ok) return { status: 'failed', error: result.error, ...base }
        return { status: 'success', ...base, events: result.data.events, defaultAnchorName: result.data.defaultAnchorName }
      }
      case 'graph': {
        const chapterGraphResult = await extractGraph(prisma, chapter.storyId, chapter.content, contentCharBudget)
        if (!chapterGraphResult.ok) return { status: 'failed', error: chapterGraphResult.error, ...base }
        // 找上一章的 mergedGraph
        const prevChapter = await prisma.v2Chapter.findFirst({
          where: { storyId: chapter.storyId, number: { lt: chapter.number }, mergedGraph: { not: null } },
          orderBy: { number: 'desc' },
          select: { mergedGraph: true, number: true }
        })
        const warnings: string[] = []
        let prevMerged: GraphData | null = null
        if (prevChapter?.mergedGraph) {
          try {
            prevMerged = JSON.parse(prevChapter.mergedGraph)
          } catch (err: any) {
            app.log.warn(`[V2] 第 ${prevChapter.number} 章 mergedGraph 解析失败，第 ${chapter.number} 章跨章连续性将丢失: ${err.message}`)
            warnings.push(`上一章（第 ${prevChapter.number} 章）的合并图谱损坏，本章图谱无法继承`)
          }
        }
        const mergedGraph = await mergeGraph(prisma, chapter.storyId, chapterGraphResult.data, prevMerged)
        return {
          status: 'success',
          ...base,
          chapterGraph: chapterGraphResult.data,
          mergedGraph,
          ...(warnings.length > 0 ? { warnings } : {})
        }
      }
      default:
        return { status: 'failed', error: `未知分析类型: ${key}`, ...base }
    }
  } catch (err: any) {
    return { status: 'failed', error: err.message || '分析过程异常', ...base }
  }
}

const ANALYZER_KEYS = ['characters', 'memories', 'plotArcs', 'timeline', 'graph'] as const

export async function v2ChapterAnalysisRoutes(app: FastifyInstance) {
  // GET /api/v2/chapters/:chapterId/analysis
  app.get('/chapters/:chapterId/analysis', async (request, reply) => {
    const { chapterId } = request.params as { chapterId: string }
    const chapter = await app.prisma.v2Chapter.findUnique({
      where: { id: chapterId },
      select: { pendingAnalysis: true, analysisId: true, contentHash: true, status: true }
    })
    if (!chapter) return { success: false, error: '章节不存在' }
    let analysis: Record<string, any>
    try {
      analysis = getPending(chapter.pendingAnalysis)
    } catch (err: any) {
      return reply.status(422).send({ success: false, error: `数据完整性错误: ${err.message}，请重新执行分析` })
    }
    return {
      success: true,
      data: {
        analysis,
        analysisId: chapter.analysisId,
        contentHash: chapter.contentHash,
        isStale: chapter.analysisId !== chapter.contentHash,
        status: chapter.status
      }
    }
  })

  // POST /api/v2/chapters/:chapterId/analyze — 并行分析全部 5 个维度
  app.post('/chapters/:chapterId/analyze', async (request) => {
    const { chapterId } = request.params as { chapterId: string }
    const chapter = await app.prisma.v2Chapter.findUnique({ where: { id: chapterId } })
    if (!chapter) return { success: false, error: '章节不存在' }
    if (chapter.status === 'archived') return { success: false, error: '已归档章节不可分析' }
    if (!chapter.content) return { success: false, error: '请先输入正文' }

    const tasks = ANALYZER_KEYS.map(key => runAnalyzer(key, app.prisma, app, chapter))
    const results = await Promise.all(tasks)

    const pending: Record<string, any> = {}
    const errors: Record<string, string> = {}
    for (let i = 0; i < ANALYZER_KEYS.length; i++) {
      const key = ANALYZER_KEYS[i]
      const r = results[i]
      pending[key] = r
      if (r.status === 'failed') {
        errors[key] = r.error
      }
    }
    if (Object.keys(errors).length > 0) {
      pending._errors = errors
    } else {
      delete pending._errors
    }

    await app.prisma.v2Chapter.update({
      where: { id: chapterId },
      data: { pendingAnalysis: JSON.stringify(pending) }
    })

    const allSuccess = Object.keys(errors).length === 0
    if (allSuccess) {
      await app.prisma.v2Chapter.update({
        where: { id: chapterId },
        data: { analysisId: chapter.contentHash, status: 'analyzing' }
      })
    }

    return {
      success: true,
      data: {
        pending,
        allSuccess,
        analysisId: allSuccess ? chapter.contentHash : null
      }
    }
  })

  // POST /api/v2/chapters/:chapterId/analyze/:key — 单个维度重新生成
  app.post('/chapters/:chapterId/analyze/:key', async (request, reply) => {
    const { chapterId, key } = request.params as { chapterId: string; key: string }
    if (!ANALYZER_KEYS.includes(key as any)) {
      return { success: false, error: `未知分析类型: ${key}` }
    }
    const chapter = await app.prisma.v2Chapter.findUnique({ where: { id: chapterId } })
    if (!chapter) return { success: false, error: '章节不存在' }
    if (chapter.status === 'archived') return { success: false, error: '已归档章节不可分析' }
    if (!chapter.content) return { success: false, error: '请先输入正文' }

    const result = await runAnalyzer(key, app.prisma, app, chapter)

    let pending: Record<string, any>
    try {
      pending = getPending(chapter.pendingAnalysis)
    } catch (err: any) {
      return reply.status(422).send({ success: false, error: `数据完整性错误: ${err.message}，请重新执行分析` })
    }
    pending[key] = result
    if (result.status === 'failed') {
      pending._errors = { ...(pending._errors || {}), [key]: result.error }
    } else {
      if (pending._errors) {
        delete pending._errors[key]
        if (Object.keys(pending._errors).length === 0) delete pending._errors
      }
    }
    await app.prisma.v2Chapter.update({
      where: { id: chapterId },
      data: { pendingAnalysis: JSON.stringify(pending) }
    })

    return { success: result.status === 'success', data: result, error: result.status === 'failed' ? result.error : undefined }
  })

  // PUT /api/v2/chapters/:chapterId/pending-analysis — 保存分析结果的手动编辑
  app.put('/chapters/:chapterId/pending-analysis', async (request) => {
    const { chapterId } = request.params as { chapterId: string }
    const chapter = await app.prisma.v2Chapter.findUnique({ where: { id: chapterId } })
    if (!chapter) return { success: false, error: '章节不存在' }
    if (chapter.status === 'archived') return { success: false, error: '已归档章节不可操作' }

    const body = request.body as any
    await app.prisma.v2Chapter.update({
      where: { id: chapterId },
      data: { pendingAnalysis: JSON.stringify(body) }
    })
    return { success: true }
  })

  // POST /api/v2/chapters/:chapterId/revert-analysis — 撤销分析
  app.post('/chapters/:chapterId/revert-analysis', async (request) => {
    const { chapterId } = request.params as { chapterId: string }
    const chapter = await app.prisma.v2Chapter.findUnique({ where: { id: chapterId } })
    if (!chapter) return { success: false, error: '章节不存在' }
    if (chapter.status !== 'analyzing') return { success: false, error: '仅分析中状态可撤销' }

    await app.prisma.v2Chapter.update({
      where: { id: chapterId },
      data: { pendingAnalysis: null, analysisId: null, status: 'draft' }
    })
    return { success: true }
  })
}
