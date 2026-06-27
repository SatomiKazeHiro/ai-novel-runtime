import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { RuntimePromptCompiler } from '@novel-runtime/ai-provider'
import { cleanJsonBlock } from '@novel-runtime/shared'
import { loadRuntimeBase, loadWorkerTask } from './runtime-loader.js'
import { callAIWithLog } from './ai-call-logger.js'
import type { PendingPlotArcWrite } from '@novel-runtime/shared'

/**
 * plot-consolidator v2 — AI 跨章融合 worker (P1 bug 修复第二轮)
 *
 * 设计意图 (用户 2026-06-26 明确指出):
 *   "比对以往的剧情弧线, 相近的剧情主题则更新进度, 若是新的剧情弧线且
 *    在文章中笔墨浓重的、有推动剧情发展的、情感强烈的等等则形成一个新的剧情弧线"
 *
 * 与 v1 的关键区别:
 *   - v1: 把 extractAll 输出的 raw arcs 喂给 consolidator, AI 机械地问
 *         "rawName 是不是 existingName 的别名"。slim prompt 没让 AI 看 existing,
 *         raw arcs 已经过度生成 (6 条 50% prog), consolidator 在症状上做别名
 *         匹配, 永远救不回来。
 *
 *   - v2: consolidator 自己读章节内容 + existingArcs, AI 做真正的语义级判断:
 *         * existing 推进: AI 看 existing + 章节, 决定"笔墨浓重地推进了"的 existing
 *         * 新 arc 识别: AI 看章节, 决定"笔墨浓重 / 推动主线 / 情感强烈"的独立新事件线
 *         * 不把过渡 / 路人 / 一次性对话做成新 arc (AI 擅长的价值判断)
 *
 *   - v2 不再依赖 extractAll 的 plotArcs 字段, slim prompt 删掉 plot 任务3。
 *     plot 是 consolidator 的唯一入口, 读章节 + existing 做判断。
 *
 * AI 返回 contract:
 *   {
 *     "updates": [{ "existingId": "<id>", "progress": 45, ... }],
 *     "newArcs": [{ "name": "...", "type": "main"|"side", "progress": 0-15, ... }]
 *   }
 *
 * 粒度约束 (Zod schema 校验):
 *   - 主线 (type=main) 总数 ≤ 1
 *   - 支线 (type=side) 总数 ≤ 2
 *   - 总 active arc (推进的 existing + 新建) ≤ 3
 *
 * 兜底:
 *   - AI 调用失败 → carry-forward 全部 active existing, 不创建新 arc (避免污染)
 *   - AI 返回幻觉 existingId → 忽略该 update
 *   - 进度单调不减 (AI 推算偏低时取 max)
 *   - 新 arc progress 上限 15 (开篇不应凭空 50%)
 */

// ---------------------------------------------------------------------------
// Types & Zod schemas
// ---------------------------------------------------------------------------

export interface ExistingArcView {
  id: string
  name: string
  type: string
  status: string
  progress: number
  currentStage: string | null
  nextGoal: string | null
  unresolved: string  // JSON-encoded
  summary: string | null
  stages: string  // JSON-encoded
  createdAt: Date
  updatedAt: Date
  // status='closed' 时: 'duplicate' 或其他原因
  closedReason: string | null
  // status='closed' as duplicate 时: 指向被合并到的 arc id
  closedTargetArcId: string | null
}

export type ConsolidatedArcWrite = PendingPlotArcWrite

/** AI 返回的单条 update: 对某条 existing arc 的字段更新 */
const UpdateSchema = z.object({
  existingId: z.string(),
  /** AI 可在 update 时翻转 type (主线↔支线) */
  type: z.enum(['main', 'side']).optional(),
  progress: z.number().min(0).max(100).optional(),
  /** 'stale' 是代码自动设置, AI 不直接写 */
  status: z.enum(['active', 'resolving', 'completed', 'closed']).optional(),
  currentStage: z.string().optional(),
  nextGoal: z.string().optional(),
  unresolved: z.array(z.string()).optional(),
  summary: z.string().optional(),
  /** status='closed' 时必填, 'duplicate' = 与其他弧线重复 */
  closedReason: z.enum(['duplicate']).optional(),
  /** status='closed' 时填, 指向被合并到的 arc id */
  closedTargetArcId: z.string().optional()
})

/** AI 返回的单条新 arc: 章节中识别的新事件线 */
const NewArcSchema = z.object({
  name: z.string(),
  type: z.enum(['main', 'side']),
  status: z.enum(['active', 'resolving', 'completed']),
  progress: z.number().min(0).max(100),
  currentStage: z.string(),
  nextGoal: z.string(),
  unresolved: z.array(z.string()),
  summary: z.string()
})

/** AI 返回的顶层结构 */
const ConsolidateResponseSchema = z.object({
  updates: z.array(UpdateSchema),
  newArcs: z.array(NewArcSchema)
})

type ConsolidateResponse = z.infer<typeof ConsolidateResponseSchema>

/** 软约束常量 — 超出仅 warn, 不阻塞流程 */
const SOFT_MAX_MAIN_ARCS = 5
const SOFT_MAX_SIDE_ARCS = 10

// ---------------------------------------------------------------------------
// Main entry
// ---------------------------------------------------------------------------

/**
 * 跨章融合剧情弧线: 比对已有弧线 + 阅读章节, AI 决定推进哪些 / 新增哪些。
 *
 * @param app Fastify app (含 prisma + log)
 * @param storyId 当前故事 id
 * @param chapterId 当前章节 id
 * @param existingArcs 数据库中已有弧线 (全部, 不限状态 — completed 由内部分流跳过)
 * @param chapterContent 章节正文 (已被 truncateByParagraph 处理过的截断版也可)
 * @param chapterOutline 章节大纲 (可选)
 */
export async function consolidatePlotArcs(
  app: FastifyInstance,
  storyId: string,
  chapterId: string,
  existingArcs: ExistingArcView[],
  chapterContent: string,
  chapterOutline?: string
): Promise<ConsolidatedArcWrite[]> {
  const storyId_ = storyId

  // 兜底: 没有 existing 且 没有内容 → 直接返回 []
  if (existingArcs.length === 0 && !chapterContent.trim()) {
    return []
  }

  let response: ConsolidateResponse
  try {
    response = await callConsolidateAI(app, storyId_, chapterId, existingArcs, chapterContent, chapterOutline)
  } catch (err: any) {
    // AI 失败兜底: carry-forward 全部 active existing, 不创建新 arc (避免污染)
    app.log.warn(
      `[PlotConsolidator] AI consolidate failed: ${err.message}, ` +
      `falling back to carry-forward ${existingArcs.length} existing arc(s)`
    )
    return existingArcs
      .filter(e => e.status !== 'completed' && e.status !== 'closed')
      .map(e => carryForwardArc(storyId_, e))
  }

  // 应用响应 → 写库格式
  const existingById = new Map(existingArcs.map(e => [e.id, e]))
  const writes: ConsolidatedArcWrite[] = []
  const advancedExistingIds = new Set<string>()

  // 1. 处理 updates
  for (const update of response.updates) {
    const existing = existingById.get(update.existingId)
    if (!existing) continue  // AI 幻觉, 忽略
    writes.push(mergeUpdateIntoExisting(storyId_, existing, update))
    advancedExistingIds.add(existing.id)
  }

  // 2. 处理 newArcs
  for (const newArc of response.newArcs) {
    writes.push(newArcFromAI(storyId_, newArc))
  }

  // 3. carry-forward 未推进的 active existing (completed/closed 终态不重写)
  for (const existing of existingArcs) {
    if (advancedExistingIds.has(existing.id)) continue
    if (existing.status === 'completed' || existing.status === 'closed') continue
    writes.push(carryForwardArc(storyId_, existing))
  }

  // 4. 粒度约束校验
  validateGranularity(writes, app)

  app.log.info(
    `[PlotConsolidator] chapter ${chapterId}: ` +
    `${response.updates.length} AI updates, ` +
    `${response.newArcs.length} AI new arcs, ` +
    `${writes.length - response.updates.length - response.newArcs.length} carried forward, ` +
    `${writes.length} total writes`
  )

  return writes
}

// ---------------------------------------------------------------------------
// AI call + parsing
// ---------------------------------------------------------------------------

async function callConsolidateAI(
  app: FastifyInstance,
  storyId: string,
  chapterId: string,
  existingArcs: ExistingArcView[],
  chapterContent: string,
  chapterOutline?: string
): Promise<ConsolidateResponse> {
  const prisma = app.prisma
  const base = await loadRuntimeBase(storyId, prisma)
  const task = await loadWorkerTask(storyId, 'memory', prisma)

  const prompt = buildConsolidatePrompt(existingArcs, chapterContent, chapterOutline)
  const compiler = new RuntimePromptCompiler()
  const compiled = compiler.compile(base, task, prompt)

  const raw = await callAIWithLog(app, {
    storyId, chapterId, callType: 'plot_consolidate',
    compiled, temperature: 0.2, maxTokens: 4096
  })
  if (!raw) throw new Error('AI consolidate 返回为空')

  let parsed: unknown
  try {
    parsed = JSON.parse(cleanJsonBlock(raw))
  } catch (parseErr: any) {
    throw new Error(`AI consolidate JSON parse failed: ${parseErr.message}`)
  }

  const result = ConsolidateResponseSchema.safeParse(parsed)
  if (!result.success) {
    throw new Error(`AI consolidate schema 校验失败: ${result.error.message}`)
  }
  return result.data
}

function buildConsolidatePrompt(
  existingArcs: ExistingArcView[],
  chapterContent: string,
  chapterOutline?: string
): string {
  const existingList = existingArcs.map(a =>
    `- id: ${a.id} | name: ${a.name} | type: ${a.type} | status: ${a.status} | progress: ${a.progress} | currentStage: ${a.currentStage || '(无)'} | nextGoal: ${a.nextGoal || '(无)'} | summary: ${a.summary || '(无)'}`
  ).join('\n')

  return `你是小说剧情弧线整理助手。

【任务】
阅读"章节大纲 + 章节内容", 比对"已有剧情弧线", 完成两项判断:

1. 【推进已有弧线】对每条已有弧线, 判断本章是否"笔墨浓重地推进了"它:
   - 推进的标志: 章节中有该弧线的实质性新进展 (重要事件 / 阶段转折 / 关系演变)
   - 如果推进: 在 updates 数组里输出一条, 包含 existingId + 新的 progress/currentStage/nextGoal/unresolved/summary
   - 如果没推进: 不在 updates 里出现, 系统会自动保留原状

2. 【识别新弧线】基于章节内容, 判断是否有"笔墨浓重 / 推动剧情 / 情感强烈"的全新事件线值得开成新弧线。
   开新弧线的标准:
   - 笔墨浓重: 章节中花了显著篇幅描写
   - 推动剧情: 直接影响主线进展或核心冲突
   - 情感强烈: 涉及主角重要情感 / 关系 / 内心变化
   - 独立主线: 不是已有弧线的延续, 而是新的事件线
   - 在 newArcs 数组里输出, progress 限制 0-15 (开篇不应过高)

   不要把以下做成新弧线:
   - 一次性对话 / 路人提及
   - 纯环境描写 / 过渡铺垫
   - 已有弧线的小进展 (应该走 updates)

3. 【已有弧线管理】
   - 比对已有弧线 (含 status), 若主题/冲突/角色与已有高度重叠, 在 updates 里推进已有弧线,
     不要创建重复的 newArcs。
   - 若两条已有弧线中只有一条值得保留, 关闭另一条:
     在 updates 里写 status='closed' + closedReason='duplicate' + closedTargetArcId=<保留条id>。
   - 主线支线 (type) 跟章节 POV 绑定: 主角参与的剧情线可以标 main, 主角不参与的标 side。
     type 可随章节变化, 不用守"只能 1 条 main"。
   - 剧情自然收尾时, status='completed'; 与其他弧线重复时, status='closed'。

【已有剧情弧线 (数据库 N-1 状态)】
${existingList || '(暂无, 这是故事开篇)'}

【章节大纲】
${chapterOutline || '(无大纲)'}

【章节内容】
${chapterContent}

【返回格式】严格 JSON, 不要 markdown 代码块:
{
  "updates": [
    {
      "existingId": "<id>",
      "progress": 0-100,
      "currentStage": "本章结束时该弧线处于什么阶段 (≤30字)",
      "nextGoal": "下一步要推进什么 (≤30字)",
      "unresolved": ["本章新增的悬念"],
      "summary": "本章该弧线推进的一句话总结"
    }
  ],
  "newArcs": [
    {
      "name": "新弧线名称",
      "type": "main" | "side",
      "status": "active" | "resolving" | "completed",
      "progress": 0-15,
      "currentStage": "本章结束时该弧线处于什么阶段 (≤30字)",
      "nextGoal": "下一步要推进什么 (≤30字)",
      "unresolved": ["悬念列表"],
      "summary": "本章该弧线开启的一句话总结"
    }
  ]
}`
}

// ---------------------------------------------------------------------------
// Write format conversion
// ---------------------------------------------------------------------------

function mergeUpdateIntoExisting(
  storyId: string,
  existing: ExistingArcView,
  update: z.infer<typeof UpdateSchema>
): ConsolidatedArcWrite {
  const mergedProgress = monotonicMax(existing.progress, update.progress ?? existing.progress)

  return {
    storyId,
    name: existing.name,
    type: update.type ?? existing.type,
    status: update.status ?? existing.status,
    progress: mergedProgress,
    stages: mergeStages(existing.stages, update.currentStage || existing.currentStage || '', update.status ?? existing.status, update.summary || existing.summary || ''),
    currentStage: update.currentStage ?? existing.currentStage ?? '',
    nextGoal: update.nextGoal ?? existing.nextGoal ?? '',
    unresolved: update.unresolved ? JSON.stringify(update.unresolved) : existing.unresolved,
    summary: update.summary ?? existing.summary ?? '',
    isNew: false,
    existingId: existing.id,
    source: 'ai-update',
    closedReason: update.closedReason,
    closedTargetArcId: update.closedTargetArcId
  }
}

function newArcFromAI(
  storyId: string,
  newArc: z.infer<typeof NewArcSchema>
): ConsolidatedArcWrite {
  return {
    storyId,
    name: newArc.name,
    type: newArc.type,
    status: newArc.status,
    progress: Math.min(newArc.progress, 15),  // 硬上限: 新 arc 开篇不应超 15%
    stages: JSON.stringify([{
      stage: newArc.currentStage,
      completed: newArc.status === 'completed',
      description: newArc.summary
    }]),
    currentStage: newArc.currentStage,
    nextGoal: newArc.nextGoal,
    unresolved: JSON.stringify(newArc.unresolved),
    summary: newArc.summary,
    isNew: true
  }
}

function carryForwardArc(storyId: string, existing: ExistingArcView): ConsolidatedArcWrite {
  return {
    storyId,
    name: existing.name,
    type: existing.type,
    status: existing.status,
    progress: existing.progress,
    stages: existing.stages,
    currentStage: existing.currentStage || '',
    nextGoal: existing.nextGoal || '',
    unresolved: existing.unresolved,
    summary: existing.summary || '',
    isNew: false,
    existingId: existing.id,
    source: 'carry-forward'
  }
}

// ---------------------------------------------------------------------------
// Granularity validation (主线 ≤ 1, 支线 ≤ 2)
// ---------------------------------------------------------------------------

function validateGranularity(writes: ConsolidatedArcWrite[], app: FastifyInstance): void {
  // 仅统计"活跃追踪中"的 arc (排除 completed / closed 终态)
  // stale 算活跃 (AI 可能重新激活)
  const activeStatuses = (s: string) => s !== 'completed' && s !== 'closed'
  const mainCount = writes.filter(w => w.type === 'main' && activeStatuses(w.status)).length
  const sideCount = writes.filter(w => w.type === 'side' && activeStatuses(w.status)).length

  if (mainCount > SOFT_MAX_MAIN_ARCS) {
    app.log.warn(`[PlotConsolidator] main arc count ${mainCount} exceeds soft cap ${SOFT_MAX_MAIN_ARCS}`)
  }
  if (sideCount > SOFT_MAX_SIDE_ARCS) {
    app.log.warn(`[PlotConsolidator] side arc count ${sideCount} exceeds soft cap ${SOFT_MAX_SIDE_ARCS}`)
  }
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

function monotonicMax(existingProgress: number, rawProgress: number): number {
  if (typeof rawProgress !== 'number' || isNaN(rawProgress)) return existingProgress
  if (typeof existingProgress !== 'number' || isNaN(existingProgress)) return rawProgress
  return Math.max(existingProgress, rawProgress)
}

function mergeStages(
  existingStagesJson: string,
  newStage: string,
  newStatus: string,
  newDescription: string
): string {
  let stages: any[] = []
  try {
    stages = JSON.parse(existingStagesJson)
    if (!Array.isArray(stages)) stages = []
  } catch {
    stages = []
  }

  if (newStage && !stages.some((s: any) => s.stage === newStage)) {
    stages.push({
      stage: newStage,
      completed: newStatus === 'completed',
      description: newDescription
    })
  }

  return JSON.stringify(stages)
}