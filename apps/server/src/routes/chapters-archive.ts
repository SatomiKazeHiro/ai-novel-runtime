import type { FastifyInstance } from 'fastify'
import { randomBytes } from 'crypto'
import { PrepareArchiveRequestSchema, safeJsonParse } from '@novel-runtime/shared'
import type { PendingArchiveDataV3 } from '@novel-runtime/shared'
import { parseBody, getOrThrowChapter } from './_helpers.js'
import { runCharacterStage } from '../services/stages/character-stage.js'
import { runMemoryStage } from '../services/stages/memory-stage.js'
import { runPlotArcStage } from '../services/stages/plot-arc-stage.js'
import { runGraphExtractStage } from '../services/stages/graph-extract-stage.js'
import { commitPlotArcWrites } from '../services/plot-extractor.js'
import { optimizeMemories, type OptimizedMemory } from '../services/memory-optimizer.js'
import type { GraphSnapshot } from '../services/graph-snapshot.js'
import { buildCumulativeGraph } from '../services/cumulative-graph.js'

function extractGraphNodes(
  raw: string | null | undefined
): Array<{ type: string; key: string; label: string }> {
  const parsed = safeJsonParse<{ nodes?: Array<{ type?: unknown; key?: unknown; label?: unknown }> } | null>(raw, null)
  if (!parsed?.nodes) return []
  return parsed.nodes.filter((n): n is { type: string; key: string; label: string } =>
    typeof n?.type === 'string' &&
    typeof n?.key === 'string' &&
    typeof n?.label === 'string' &&
    n.label.length > 0
  )
}

/**
 * v3 archive 端点 — 5 端点:
 *   POST /api/chapters/:chapterId/prepare-archive                          (启动)
 *   POST /api/chapters/:chapterId/prepare-archive/cancel                   (撤销审查)
 *   POST /api/chapters/:chapterId/prepare-archive/retry-stage/:stageName    (单 stage 重跑)
 *   GET  /api/chapters/:chapterId/cumulative-graph                         (查累计图谱 / 本章图谱)
 *   POST /api/chapters/:chapterId/cumulative-graph/build                   (AI 生成累计图谱)
 *   POST /api/chapters/:chapterId/archive                                  (确认归档)
 *
 * v3 关键变化 (2026-07-29 收尾):
 *   - 删除所有 updateMany 锁。仅依赖状态机自身 (draft/reviewing/archived) +
 *     UI 按钮 disabled 防双击。
 *   - prepare-archive 调 4 stage 并行 (Promise.all), 各自结果写入
 *     pendingArchiveData.stages[name]。单 stage 失败不影响其他 stage。
 *   - reviewing 期间 Chapter.chapterGraph / cumulativeGraph / cumulativeGraphGeneratedAt
 *     三列整个过程不被读写。所有图谱数据都活在 pendingArchiveData JSON 里。
 *     archive confirm 时从 pendingArchiveData 拷到这三列, 然后清 pendingArchiveData。
 *   - 知识图谱页面只查 archived 章节, 读这三列, 数据是用户终稿。
 *   - 累计图谱编辑后保存走 chaptersApi.update({ pendingArchiveData }) 通路, 不再有独立 PATCH 端点。
 */
export async function chapterArchiveRoutes(app: FastifyInstance) {
  app.post('/api/chapters/:chapterId/prepare-archive', async (request, reply) => {
    const { chapterId } = request.params as any
    const body = parseBody(PrepareArchiveRequestSchema, request, reply)
    if (body === null) return

    const prisma = app.prisma
    const chapter = await getOrThrowChapter(prisma, chapterId, reply)
    if (chapter === null) return

    if (chapter.status !== 'draft' && chapter.status !== 'reviewing') {
      return reply.status(400).send({
        success: false,
        error: `章节当前状态为 ${chapter.status}，只允许 draft 或 reviewing 状态准备归档`
      })
    }

    if (chapter.isSideStory) {
      await prisma.chapter.update({ where: { id: chapterId }, data: { status: 'archived' } })
      return { success: true, data: { sideStory: true, status: 'archived' } }
    }

    if (!chapter.content) {
      await prisma.chapter.update({ where: { id: chapterId }, data: { status: 'archived' } })
      return { success: true, data: { noContent: true, status: 'archived' } }
    }

    const outlineText = chapter.outline || ''
    const contentText = chapter.content || ''
    if (!outlineText.trim()) return reply.status(400).send({ success: false, error: '归档失败：大纲不能为空' })
    if (!contentText.trim()) return reply.status(400).send({ success: false, error: '归档失败：正文不能为空' })
    if (contentText.length < outlineText.length) {
      return reply.status(400).send({
        success: false,
        error: `归档失败：正文长度（${contentText.length}）不能小于大纲长度（${outlineText.length}）`
      })
    }

    // 直接翻 status (无锁; UI 按钮 + 状态机双层防双击)
    await prisma.chapter.update({
      where: { id: chapterId },
      data: { status: 'reviewing', pendingArchiveData: null }
    })

    // Pre-stage: 文本匹配正文 + 现有 Character → matchedCharacters
    const allCharacters = await prisma.character.findMany({
      where: { storyId: chapter.storyId },
      select: { id: true, name: true, slug: true, protagonist: true }
    })
    const matchedCharacters = allCharacters
      .filter((c: any) => contentText.includes(c.name))
      .map((c: any) => ({
        id: c.id,
        name: c.name,
        key: c.slug,
        label: c.name,
        importance: c.protagonist ? 10 : 7
      }))
    const characterNames = matchedCharacters.map((c: any) => c.name)
    const characterKeys = matchedCharacters.map((c: any) => c.key)

    // 查 latestBranchStates (每个 matched character 的最新一条)
    const latestBranchStates = matchedCharacters.length > 0
      ? await prisma.characterBranchState.findMany({
          where: { characterId: { in: matchedCharacters.map((c: any) => c.id) } },
          orderBy: { fromChapterNumber: 'desc' }
        })
      : []
    // 去重每个 character 保留最新
    const latestPerChar = new Map<string, any>()
    for (const s of latestBranchStates) {
      if (!latestPerChar.has(s.characterId)) latestPerChar.set(s.characterId, s)
    }
    const dedupedBranchStates = Array.from(latestPerChar.values())

    // 查 existing arcs (全部状态, consolidator 内部按 status 分流)
    const allExistingArcs = await prisma.plotArc.findMany({ where: { storyId: chapter.storyId } })

    // 查 prev cumulativeGraph 节点 (含 label, 供 stage 按正文预过滤)
    let prevCumulativeGraphNodes: Array<{ type: string; key: string; label: string }> = []
    if (chapter.parentChapterId) {
      const parent = await prisma.chapter.findUnique({
        where: { id: chapter.parentChapterId },
        select: { cumulativeGraph: true }
      })
      prevCumulativeGraphNodes = extractGraphNodes(parent?.cumulativeGraph)
    }
    if (prevCumulativeGraphNodes.length === 0) {
      // 主线回退: 找前一个 number 的章节
      const prev = await prisma.chapter.findFirst({
        where: {
          storyId: chapter.storyId,
          parentChapterId: null,
          number: chapter.number - 1,
          id: { not: chapterId }
        },
        select: { cumulativeGraph: true }
      })
      prevCumulativeGraphNodes = extractGraphNodes(prev?.cumulativeGraph)
    }

    // memory-stage / memory-optimizer 跨章上下文
    //   - protagonistNames: 主角名单,影响 mainEvents 评分粒度
    //   - existingNodeKeys: N-1 节点 type:key,让 AI 复用已有实体
    //   - previousSnapshotNodes: N-1 节点带 importance,按 desc 排序后取 top CAP
    const protagonistNames = matchedCharacters.filter((c: any) => c.protagonist).map((c: any) => c.name)
    const existingNodeKeys = prevCumulativeGraphNodes.map(n => `${n.type}:${n.key}`)
    // prevCumulativeGraphNodes 不带 importance; 重要度统一视为 0,全量进 prompt 由 cap 截断
    const previousSnapshotNodes = prevCumulativeGraphNodes.map(n => ({ ...n }))

    // 4 stage 并行
    const [characterState, memoryState, plotArcState, graphState] = await Promise.all([
      runCharacterStage(app, {
        storyId: chapter.storyId, chapterId, content: contentText, outline: outlineText,
        chapterNumber: chapter.number, matchedCharacters
      }),
      runMemoryStage(app, {
        storyId: chapter.storyId, chapterId, content: contentText, outline: outlineText,
        chapterNumber: chapter.number,
        protagonistNames, characterNames,
        existingNodeKeys, previousSnapshotNodes
      }),
      runPlotArcStage(app, {
        storyId: chapter.storyId, chapterId, content: contentText, outline: outlineText,
        chapterNumber: chapter.number, existingArcs: allExistingArcs as any,
        characterNames, latestBranchStates: dedupedBranchStates
      }),
      runGraphExtractStage(app, {
        storyId: chapter.storyId, chapterId, content: contentText, outline: outlineText,
        chapterNumber: chapter.number, characterNames, prevCumulativeGraphNodes,
        latestBranchStates: dedupedBranchStates
      })
    ])

    // 1.5. Optimize memory(v3 spec D7):
    //   memory-stage success 时, 跑 optimizer, 把融合结果覆盖到 stages.memory.result.memories。
    //   optimizer 失败时该 stage 标记 failed, 不影响 graph / character / plot-arc。
    //   备注: '未来探讨是否可以优化' — 失败时是否回退到 raw result 让用户 review? 暂不实现, 直接标记 failed。
    if (memoryState.status === 'success' && memoryState.result) {
      try {
        const optimized = await optimizeMemories(
          app, chapter.storyId, chapterId,
          memoryState.result as any
        )
        ;(memoryState.result as any).memories = optimized
        app.log.info(
          `[PrepareArchive] optimizer: ${optimized.length} global memories for chapter ${chapter.number}`
        )
      } catch (err: any) {
        app.log.error(`[PrepareArchive] memory-optimizer failed: ${err.message}`)
        memoryState.status = 'failed'
        memoryState.errorMessage = `memory-optimizer: ${err.message}`
      }
    }

    const pendingData: PendingArchiveDataV3 = {
      version: 3,
      stages: {
        character: characterState,
        memory: memoryState,
        plotArc: plotArcState,
        graph: graphState
      },
      meta: {
        extractedAt: new Date().toISOString(),
        chapterNumber: chapter.number
      }
    }

    // reviewing 期间 chapterGraph 数据只活在 pendingArchiveData.stages.graph.result.chapterGraph,
    // Chapter.chapterGraph 列保持 null, archive confirm 时再从 pendingArchiveData 拷过来。
    await prisma.chapter.update({
      where: { id: chapterId },
      data: {
        status: 'reviewing',
        pendingArchiveData: JSON.stringify(pendingData)
      }
    })

    return { success: true, data: pendingData }
  })

  app.post('/api/chapters/:chapterId/prepare-archive/cancel', async (request, reply) => {
    const { chapterId } = request.params as any
    const prisma = app.prisma
    const chapter = await getOrThrowChapter(prisma, chapterId, reply)
    if (chapter === null) return

    if (chapter.status !== 'reviewing') {
      return reply.status(400).send({
        success: false,
        error: `章节当前状态为 ${chapter.status}，只允许 reviewing 状态撤销审查`
      })
    }

    await prisma.chapter.update({
      where: { id: chapterId },
      data: { status: 'draft', pendingArchiveData: null }
    })

    return { success: true, data: { status: 'draft' } }
  })

  // 单 stage 重跑（不重置其他 stage）。txt 第 1 段:失败 stage 单独重新解析。
  // 也允许重跑 success 的 stage（用户对结果不满意时,不必撤销整章）。
  app.post('/api/chapters/:chapterId/prepare-archive/retry-stage/:stageName', async (request, reply) => {
    const { chapterId, stageName } = request.params as any
    const prisma = app.prisma
    const chapter = await getOrThrowChapter(prisma, chapterId, reply)
    if (chapter === null) return

    if (chapter.status !== 'reviewing') {
      return reply.status(400).send({
        success: false,
        error: `章节当前状态为 ${chapter.status}，只允许 reviewing 状态重跑 stage`
      })
    }
    if (!['character', 'memory', 'plotArc', 'graph'].includes(stageName)) {
      return reply.status(400).send({ success: false, error: `未知 stage: ${stageName}` })
    }
    if (!chapter.content) {
      return reply.status(400).send({ success: false, error: '正文为空,无法重跑 stage' })
    }

    // 读已有 pendingArchiveData,只重写目标 stage
    const existing = safeJsonParse<PendingArchiveDataV3 | null>(chapter.pendingArchiveData, null)
    if (!existing || existing.version !== 3) {
      return reply.status(400).send({
        success: false,
        error: '当前章节 pendingArchiveData 缺失或不是 v3,无法单 stage 重跑(请用重新准备归档)'
      })
    }

    const contentText = chapter.content
    const outlineText = chapter.outline || ''

    // 复用 prepare-archive 的 pre-stage 数据加载
    const allCharacters = await prisma.character.findMany({
      where: { storyId: chapter.storyId },
      select: { id: true, name: true, slug: true, protagonist: true }
    })
    const matchedCharacters = allCharacters
      .filter((c: any) => contentText.includes(c.name))
      .map((c: any) => ({
        id: c.id,
        name: c.name,
        key: c.slug,
        label: c.name,
        importance: c.protagonist ? 10 : 7
      }))
    const characterNames = matchedCharacters.map((c: any) => c.name)
    const characterKeys = matchedCharacters.map((c: any) => c.key)

    const latestBranchStates = matchedCharacters.length > 0
      ? await prisma.characterBranchState.findMany({
          where: { characterId: { in: matchedCharacters.map((c: any) => c.id) } },
          orderBy: { fromChapterNumber: 'desc' }
        })
      : []
    const latestPerChar = new Map<string, any>()
    for (const s of latestBranchStates) {
      if (!latestPerChar.has(s.characterId)) latestPerChar.set(s.characterId, s)
    }
    const dedupedBranchStates = Array.from(latestPerChar.values())

    const allExistingArcs = await prisma.plotArc.findMany({ where: { storyId: chapter.storyId } })

    let prevCumulativeGraphNodes: Array<{ type: string; key: string; label: string }> = []
    if (chapter.parentChapterId) {
      const parent = await prisma.chapter.findUnique({
        where: { id: chapter.parentChapterId },
        select: { cumulativeGraph: true }
      })
      prevCumulativeGraphNodes = extractGraphNodes(parent?.cumulativeGraph)
    }
    if (prevCumulativeGraphNodes.length === 0) {
      const prev = await prisma.chapter.findFirst({
        where: {
          storyId: chapter.storyId,
          parentChapterId: null,
          number: chapter.number - 1,
          id: { not: chapterId }
        },
        select: { cumulativeGraph: true }
      })
      prevCumulativeGraphNodes = extractGraphNodes(prev?.cumulativeGraph)
    }

    // 单 stage 执行
    let newStage: any
    try {
      if (stageName === 'character') {
        newStage = await runCharacterStage(app, {
          storyId: chapter.storyId, chapterId, content: contentText, outline: outlineText,
          chapterNumber: chapter.number, matchedCharacters
        })
      } else if (stageName === 'memory') {
        // memory-stage retry 也要补足跨章上下文; protagonistNames / existingNodeKeys / previousSnapshotNodes
        // 与 prepare-archive 路由用同一组数据源。
        const protagonistNames = matchedCharacters.filter((c: any) => c.protagonist).map((c: any) => c.name)
        const existingNodeKeys = prevCumulativeGraphNodes.map(n => `${n.type}:${n.key}`)
        const previousSnapshotNodes = prevCumulativeGraphNodes.map(n => ({ ...n }))
        newStage = await runMemoryStage(app, {
          storyId: chapter.storyId, chapterId, content: contentText, outline: outlineText,
          chapterNumber: chapter.number,
          protagonistNames, characterNames,
          existingNodeKeys, previousSnapshotNodes
        })
        // 跑完 memory-stage 后追加 optimizer,与 prepare-archive 行为一致
        if (newStage.status === 'success' && newStage.result) {
          try {
            const optimized = await optimizeMemories(
              app, chapter.storyId, chapterId,
              newStage.result as any
            )
            ;(newStage.result as any).memories = optimized
          } catch (err: any) {
            app.log.error(`[RetryStage:memory] optimizer failed: ${err.message}`)
            newStage.status = 'failed'
            newStage.errorMessage = `memory-optimizer: ${err.message}`
          }
        }
      } else if (stageName === 'plotArc') {
        newStage = await runPlotArcStage(app, {
          storyId: chapter.storyId, chapterId, content: contentText, outline: outlineText,
          chapterNumber: chapter.number, existingArcs: allExistingArcs as any,
          characterNames, latestBranchStates: dedupedBranchStates
        })
      } else {
        newStage = await runGraphExtractStage(app, {
          storyId: chapter.storyId, chapterId, content: contentText, outline: outlineText,
          chapterNumber: chapter.number, characterNames, prevCumulativeGraphNodes,
          latestBranchStates: dedupedBranchStates
        })
      }
    } catch (err: any) {
      app.log.error(`[RetryStage:${stageName}] ${err.message}`)
      return reply.status(500).send({ success: false, error: `重跑 ${stageName} 失败: ${err.message}` })
    }

    // 合并回 pendingArchiveData(只覆盖目标 stage,其他不动)
    const updatedPending: PendingArchiveDataV3 = {
      ...existing,
      stages: {
        ...existing.stages,
        [stageName]: newStage
      }
    }

    // graph stage 重跑结果只写到 pendingArchiveData.stages.graph.result.chapterGraph,
    // Chapter.chapterGraph 列保持 null (archive confirm 时再拷)。

    await prisma.chapter.update({
      where: { id: chapterId },
      data: {
        pendingArchiveData: JSON.stringify(updatedPending)
      }
    })

    return { success: true, data: updatedPending }
  })

  // GET /api/chapters/:chapterId/cumulative-graph
  // 拉取累计图谱 + generatedAt + 本章图谱; 任意字段未写入时回 null。
  // chapterGraph 来自 Chapter.chapterGraph (archive confirm 阶段写入, 详见本文件 L179-188)。
  // 前端 GraphView 用 chapterGraph 渲染「本章纯净」tab — 见 spec 2026-07-29-graphview-bugfix-design.md。
  app.get('/api/chapters/:chapterId/cumulative-graph', async (request, reply) => {
    const { chapterId } = request.params as any
    const prisma = app.prisma
    const chapter = await getOrThrowChapter(prisma, chapterId, reply)
    if (chapter === null) return

    const generatedAt = chapter.cumulativeGraphGeneratedAt
      ? chapter.cumulativeGraphGeneratedAt.toISOString()
      : null
    const graph = chapter.cumulativeGraph
      ? safeJsonParse<GraphSnapshot | null>(chapter.cumulativeGraph, null)
      : null
    const chapterGraph = chapter.chapterGraph
      ? safeJsonParse<GraphSnapshot | null>(chapter.chapterGraph, null)
      : null

    return { success: true, data: { generatedAt, graph, chapterGraph } }
  })

  // POST /api/chapters/:chapterId/cumulative-graph/build
  // 入参: { chapterGraph: GraphSnapshot }
  // 调 buildCumulativeGraph, 把生成的累计图谱写 pendingArchiveData.cumulativeGraph +
  // cumulativeGraphGeneratedAt(一起放 JSON 里),Chapter 那两列保持 null。
  // archive confirm 时再从 pendingArchiveData 拷到列。
  // 响应含 pendingArchiveData, 前端 ReviewingPanel 直接同步到 props.pending / localData。
  app.post('/api/chapters/:chapterId/cumulative-graph/build', async (request, reply) => {
    const { chapterId } = request.params as any
    const body = request.body as { chapterGraph?: GraphSnapshot } | undefined
    if (!body?.chapterGraph || !Array.isArray(body.chapterGraph.nodes) || !Array.isArray(body.chapterGraph.edges)) {
      return reply.status(400).send({ success: false, error: '缺少 chapterGraph 字段' })
    }

    const prisma = app.prisma
    const chapter = await getOrThrowChapter(prisma, chapterId, reply)
    if (chapter === null) return

    if (chapter.status !== 'draft' && chapter.status !== 'reviewing') {
      return reply.status(400).send({
        success: false,
        error: `章节当前状态为 ${chapter.status},不允许生成累计图谱`,
      })
    }

    // 读 existing pendingArchiveData, 重建并加 cumulativeGraph 字段
    const existing = safeJsonParse<PendingArchiveDataV3 | null>(chapter.pendingArchiveData, null)
    if (!existing || existing.version !== 3) {
      return reply.status(400).send({
        success: false,
        error: '当前章节没有 pendingArchiveData,无法生成累计图谱(请先 prepare-archive)',
      })
    }

    // 查 prev cumulativeGraph (parent 优先, 主线回退) — 读的是已归档章节的 Chapter.cumulativeGraph 列
    let prevCumulative: GraphSnapshot | null = null
    if (chapter.parentChapterId) {
      const parent = await prisma.chapter.findUnique({
        where: { id: chapter.parentChapterId },
        select: { cumulativeGraph: true },
      })
      if (parent?.cumulativeGraph) prevCumulative = safeJsonParse<GraphSnapshot | null>(parent.cumulativeGraph, null)
    }
    if (!prevCumulative) {
      const prev = await prisma.chapter.findFirst({
        where: {
          storyId: chapter.storyId, parentChapterId: null,
          number: chapter.number - 1, id: { not: chapterId },
        },
        select: { cumulativeGraph: true },
      })
      if (prev?.cumulativeGraph) prevCumulative = safeJsonParse<GraphSnapshot | null>(prev.cumulativeGraph, null)
    }

    let result: { cumulativeGraph: GraphSnapshot; aiCalled: boolean }
    try {
      result = await buildCumulativeGraph(app, {
        storyId: chapter.storyId, chapterId,
        chapterGraph: body.chapterGraph,
        prevCumulativeGraph: prevCumulative,
      })
    } catch (err: any) {
      app.log.error(`[CumulativeGraphBuild] ${err.message}`)
      return reply.status(500).send({ success: false, error: `累计图谱生成失败: ${err.message}` })
    }

    const generatedAt = new Date().toISOString()
    const updatedPending: PendingArchiveDataV3 = {
      ...existing,
      cumulativeGraph: result.cumulativeGraph,
      cumulativeGraphGeneratedAt: generatedAt,
    }

    await prisma.chapter.update({
      where: { id: chapterId },
      data: {
        pendingArchiveData: JSON.stringify(updatedPending)
      },
    })

    return {
      success: true,
      data: {
        graph: result.cumulativeGraph,
        generatedAt,
        aiCalled: result.aiCalled,
        pendingArchiveData: updatedPending,
      }
    }
  })

  // 注意: PATCH /api/chapters/:chapterId/cumulative-graph 端点已删除。
  // 用户编辑累计图谱后保存, 走 chaptersApi.update({ pendingArchiveData }) 通路
  // (ReviewingPanel.handleSave → emit('save') → editor.savePendingArchiveData),
  // 与 chapterGraph 走同一条流, 不再有独立的 PATCH 端点。

  app.post('/api/chapters/:chapterId/archive', async (request, reply) => {
    const { chapterId } = request.params as any
    const prisma = app.prisma
    const chapter = await getOrThrowChapter(prisma, chapterId, reply)
    if (chapter === null) return

    if (chapter.status === 'archived') {
      return { success: true, data: { alreadyArchived: true } }
    }
    if (chapter.status !== 'reviewing') {
      return reply.status(400).send({
        success: false,
        error: `章节当前状态为 ${chapter.status}，只允许 reviewing 状态确认归档`
      })
    }
    if (chapter.isSideStory || !chapter.content) {
      await prisma.chapter.update({
        where: { id: chapterId },
        data: { status: 'archived', pendingArchiveData: null }
      })
      return { success: true, data: { skipped: true } }
    }

    const pendingRaw = chapter.pendingArchiveData
    if (!pendingRaw) {
      return reply.status(400).send({
        success: false,
        error: '归档失败：没有找到预归档数据，请先调用 prepare-archive'
      })
    }
    const pending = safeJsonParse<PendingArchiveDataV3 | null>(pendingRaw, null)
    if (!pending || pending.version !== 3) {
      return reply.status(400).send({
        success: false,
        error: '归档失败：pendingArchiveData 版本不匹配，请重新准备归档'
      })
    }
    const failedStages = Object.entries(pending.stages)
      .filter(([_, s]) => (s as any).status !== 'success')
      .map(([name]) => name)
    if (failedStages.length > 0) {
      return reply.status(400).send({
        success: false,
        error: `归档失败：以下 stage 未通过：${failedStages.join(', ')}`
      })
    }

    // 校验: 用户必须先在审查阶段生成累计图谱(pendingArchiveData 里必须有 cumulativeGraph + generatedAt)
    if (!pending.cumulativeGraph || !pending.cumulativeGraphGeneratedAt) {
      return reply.status(400).send({
        success: false,
        error: 'cumulative-graph-not-generated',
      })
    }

    // 拷 pendingArchiveData 数据到 Chapter 三列(chapterGraph / cumulativeGraph / cumulativeGraphGeneratedAt),
    // 清 pendingArchiveData。 Chapter 三列只在 archived 之后才有数据, 知识图谱页面只查 archived 章节, 读这三列。
    const chapterGraph = (pending.stages.graph as any)?.result?.chapterGraph
      ? JSON.stringify((pending.stages.graph as any).result.chapterGraph)
      : null

    // 收集 memory-stage raw + optimizer 融合结果(都来自 memory stage)
    // raw 来自 result 的 mainEvents / sideEvents / emotions / foreshadowing / relationshipChanges / scenes / summary
    // 融合结果: prepare-archive 把 optimizer 输出写到 result.memories[]; 失败或缺省时为空数组(此时不写 global 层)
    const memResult: any = (pending.stages.memory as any)?.result
    const mainEvents: any[] = Array.isArray(memResult?.mainEvents) ? memResult.mainEvents : []
    const sideEvents: any[] = Array.isArray(memResult?.sideEvents) ? memResult.sideEvents : []
    const emotions: string[] = Array.isArray(memResult?.emotions) ? memResult.emotions : []
    const foreshadowing: string[] = Array.isArray(memResult?.foreshadowing) ? memResult.foreshadowing : []
    const relationshipChanges: string[] = Array.isArray(memResult?.relationshipChanges) ? memResult.relationshipChanges : []
    const scenes: any[] = Array.isArray(memResult?.scenes) ? memResult.scenes : []
    const summary: string = typeof memResult?.summary === 'string' ? memResult.summary : ''
    const optimized: OptimizedMemory[] = Array.isArray(memResult?.memories) ? memResult.memories : []

    // plot-consolidator 输出 (PendingPlotArcWrite[]) — archive confirm 时落 PlotArc 表
    const plotArcs: any[] = (pending.stages.plotArc as any)?.result?.plotArcs ?? []

    // 把 'NEW' UID 替换成本章生成的实际 UID
    const newUidHex = (): string => randomBytes(2).toString('hex').toUpperCase()
    const fromChapterNumber = chapter.number

    // 构造每条 Memory 行的写入数据(后端按 layer 规则打 tag, 备注: '未来探讨是否可以优化' — 是否让 raw 也由 AI 给 tag?)
    type MemoryRowData = Parameters<typeof prisma.memory.create>[0]['data']
    const chapterRows: MemoryRowData[] = []
    for (const e of mainEvents) {
      if (!e?.description) continue
      chapterRows.push({
        storyId: chapter.storyId,
        chapterId,
        fromChapterNumber,
        layer: 'chapter',
        content: e.description,
        tags: JSON.stringify(['auto-extracted', 'main-plot']),
        importance: typeof e.importance === 'number' ? e.importance : 5
      })
    }
    for (const e of sideEvents) {
      if (!e?.description) continue
      chapterRows.push({
        storyId: chapter.storyId,
        chapterId,
        fromChapterNumber,
        layer: 'chapter',
        content: e.description,
        tags: JSON.stringify(['auto-extracted']),
        importance: typeof e.importance === 'number' ? e.importance : 5
      })
    }
    for (const e of emotions) {
      if (typeof e !== 'string' || !e) continue
      chapterRows.push({
        storyId: chapter.storyId, chapterId, fromChapterNumber, layer: 'chapter',
        content: e, tags: JSON.stringify(['auto-extracted']), importance: 5
      })
    }
    for (const e of foreshadowing) {
      if (typeof e !== 'string' || !e) continue
      chapterRows.push({
        storyId: chapter.storyId, chapterId, fromChapterNumber, layer: 'chapter',
        content: e, tags: JSON.stringify(['auto-extracted']), importance: 5
      })
    }
    for (const e of relationshipChanges) {
      if (typeof e !== 'string' || !e) continue
      chapterRows.push({
        storyId: chapter.storyId, chapterId, fromChapterNumber, layer: 'chapter',
        content: e, tags: JSON.stringify(['auto-extracted']), importance: 5
      })
    }
    const sceneRows: MemoryRowData[] = scenes.filter(s => s?.location).map(s => ({
      storyId: chapter.storyId, chapterId, fromChapterNumber, layer: 'scene',
      content: `${s.location} | ${s.event || ''}`,
      tags: JSON.stringify(['auto-extracted', 'scene-memory']),
      importance: typeof s.importance === 'number' ? s.importance : 5
    }))
    const globalRows: MemoryRowData[] = optimized.filter(m => m?.content).map(m => ({
      storyId: chapter.storyId, chapterId, fromChapterNumber, layer: 'global',
      content: m.content,
      tags: JSON.stringify(['auto-extracted', m.type === 'state' ? 'state' : 'event']),
      importance: typeof m.importance === 'number' ? m.importance : 5,
      originUid: m.originUid === 'NEW' ? `${fromChapterNumber}#${newUidHex()}` : m.originUid
    }))

    // commit-only: prisma.$transaction 内一次写完三层 + PlotArc + Chapter.summary + Chapter 三列 + 翻 status
    // 备注: CharacterBranchState 写入另文档讨论,本端点不写
    await prisma.$transaction(async (tx) => {
      for (const data of [...chapterRows, ...sceneRows, ...globalRows]) {
        await tx.memory.create({ data })
      }
      // 接通 v3 PlotArc 写库 (修 P0 遗留): consolidator 输出 → PlotArc 表
      await commitPlotArcWrites(tx, chapter.number, plotArcs)
      await tx.chapter.update({
        where: { id: chapterId },
        data: {
          summary,
          status: 'archived',
          pendingArchiveData: null,
          chapterGraph,
          cumulativeGraph: JSON.stringify(pending.cumulativeGraph),
          cumulativeGraphGeneratedAt: pending.cumulativeGraphGeneratedAt
            ? new Date(pending.cumulativeGraphGeneratedAt)
            : null
        }
      })
    })

    return {
      success: true,
      data: {
        archived: true,
        memoryRows: {
          chapter: chapterRows.length,
          scene: sceneRows.length,
          global: globalRows.length
        }
      }
    }
  })
}
