import type { FastifyInstance } from 'fastify'
import { RuntimePromptCompiler } from '@novel-runtime/ai-provider'
import { cleanJsonBlock } from '@novel-runtime/shared'
import { loadRuntimeBase, loadWorkerTask } from './runtime-loader.js'
import { callAIWithLog } from './ai-call-logger.js'
import type { PlotArcAnalysis } from './plot-extractor.js'
import type { PendingPlotArcWrite } from '@novel-runtime/shared'

/**
 * plot-consolidator — P1 bug 修复: plot arc 不增长
 *
 * 根因: slim 重构后 extractAll prompt 不再喂 existingArcs, AI 每章返回
 *       新名字的 arc, preparePlotArcWrites 按 name 精确匹配 existing, 全部
 *       走 isNew=true → 6 章 6 条互不关联的 arc 都卡在 50%。
 *
 * 设计: 对齐 graph-organizer 模式 — Phase 2 跨章融合 worker:
 *   Step 1: code fast path — raw.name 精确匹配 existing.name → 更新进度
 *   Step 2: AI reconcile — unmatched raw + 已有 arcs 存在 → 一次小 AI 调用
 *           判断"是否同一条(重命名/别名)" vs "真正新弧线"
 *   Step 3: carry-forward — 未推进的 existing arc 保留 (不被本章节的"未提及"抹掉)
 *
 * 不做的事:
 *   - 不直接调用 prisma 写库 (这是 preparePlotArcWrites + commitPlotArcWrites 的职责)
 *   - 不持有 AI 调用以外的隐式状态
 *   - 不修改现有 arc 的 id/name (归一化只在 AI 决策层做)
 */

export interface ExistingArcView {
  id: string
  name: string
  type: string
  status: string
  progress: number
  currentStage: string | null
  nextGoal: string | null
  /** JSON-encoded unresolved array (matches Prisma schema) */
  unresolved: string
  summary: string | null
  /** JSON-encoded stages array */
  stages: string
  createdAt: Date
  updatedAt: Date
}

export type ConsolidatedArcWrite = PendingPlotArcWrite

/**
 * 跨章融合主入口。返回 PlotArcWrite 列表 (含 isNew / existingId),
 * 可直接喂给 preparePlotArcWrites / commitPlotArcWrites。
 *
 * @param app Fastify app (含 prisma + log)
 * @param storyId 当前故事 id
 * @param chapterId 当前章节 id (用于 ai-call-logger 关联)
 * @param existingArcs 数据库中已有弧线 (按 updatedAt desc 取的活跃 + 近期更新)
 * @param rawArcs extractAll 从 AI 拿到的"本章事实" arc 列表 (mode=slim)
 */
export async function consolidatePlotArcs(
  app: FastifyInstance,
  storyId: string,
  chapterId: string,
  existingArcs: ExistingArcView[],
  rawArcs: PlotArcAnalysis['arcs']
): Promise<ConsolidatedArcWrite[]> {
  // Step 1: code fast path — 按 raw.name 精确匹配 existing.name
  const existingByName = new Map(existingArcs.map(e => [e.name, e]))
  const matched: ConsolidatedArcWrite[] = []
  const matchedExistingIds = new Set<string>()
  const unmatchedRaws: PlotArcAnalysis['arcs'] = []

  for (const raw of rawArcs || []) {
    const existing = existingByName.get(raw.name)
    if (existing) {
      matched.push(mergeRawIntoExisting(storyId, existing, raw))
      matchedExistingIds.add(existing.id)
    } else {
      unmatchedRaws.push(raw)
    }
  }

  // Step 2: AI reconcile — 仅在 unmatched 非空 且 已有 arc 非空时触发
  let reconciled: ConsolidatedArcWrite[] = []
  if (unmatchedRaws.length > 0 && existingArcs.length > 0) {
    try {
      reconciled = await reconcileUnmatchedWithAI(
        app, storyId, chapterId, existingArcs, unmatchedRaws, matchedExistingIds
      )
    } catch (err: any) {
      // 兜底: AI 失败不阻塞归档 — 把所有 unmatched 当作 new, ReviewingPanel 可人工修正
      // 关键: fallback 路径下 existing arc 没被推进, 应被 carry-forward (matchedExistingIds 不变)
      app.log.warn(
        `[PlotConsolidator] AI reconcile failed: ${err.message}, ` +
        `treating ${unmatchedRaws.length} unmatched raw(s) as new arcs`
      )
      reconciled = unmatchedRaws.map(r => newArcFromRaw(storyId, r))
    }
  } else if (unmatchedRaws.length > 0) {
    // 没有 existing → 全部 new
    reconciled = unmatchedRaws.map(r => newArcFromRaw(storyId, r))
  }

  // Step 3: carry-forward — 未推进的 existing active arc (不被本章节的"未提及"抹掉)
  const carryForwarded: ConsolidatedArcWrite[] = []
  for (const existing of existingArcs) {
    if (matchedExistingIds.has(existing.id)) continue  // 已被推进
    if (existing.status === 'completed') continue       // 已完结不重复写入
    carryForwarded.push(carryForwardArc(storyId, existing))
  }

  const total = matched.length + reconciled.length + carryForwarded.length
  app.log.info(
    `[PlotConsolidator] chapter ${chapterId}: ` +
    `${matched.length} updated (code fast path), ` +
    `${reconciled.length} reconciled (${unmatchedRaws.length} unmatched input), ` +
    `${carryForwarded.length} carried forward, ` +
    `${total} total writes`
  )

  return [...matched, ...reconciled, ...carryForwarded]
}

// ---------------------------------------------------------------------------
// Step 1 helpers — code fast path
// ---------------------------------------------------------------------------

function mergeRawIntoExisting(
  storyId: string,
  existing: ExistingArcView,
  raw: NonNullable<PlotArcAnalysis['arcs']>[number]
): ConsolidatedArcWrite {
  return {
    storyId,
    name: existing.name,  // 沿用 existing.name (raw.name 一致才能进 fast path, 所以保留现有名)
    type: raw.type || existing.type,
    status: raw.status || existing.status,
    progress: monotonicMax(existing.progress, raw.progress),
    stages: mergeStages(existing.stages, raw),
    currentStage: raw.currentStage || existing.currentStage || '',
    nextGoal: raw.nextGoal || existing.nextGoal || '',
    unresolved: raw.unresolved ? JSON.stringify(raw.unresolved) : existing.unresolved,
    summary: raw.summary || existing.summary || '',
    isNew: false,
    existingId: existing.id
  }
}

function newArcFromRaw(
  storyId: string,
  raw: NonNullable<PlotArcAnalysis['arcs']>[number]
): ConsolidatedArcWrite {
  return {
    storyId,
    name: raw.name,
    type: raw.type,
    status: raw.status,
    progress: raw.progress,
    stages: initialStagesFromRaw(raw),
    currentStage: raw.currentStage || '',
    nextGoal: raw.nextGoal || '',
    unresolved: JSON.stringify(raw.unresolved || []),
    summary: raw.summary || '',
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
    existingId: existing.id
  }
}

// ---------------------------------------------------------------------------
// Step 2 helpers — AI reconcile (small prompt, only when needed)
// ---------------------------------------------------------------------------

interface ReconcileDecision {
  rawName: string
  /** null = 真正新弧线; non-null = 与已有弧线同名/别名, 应归一化到该 existing.name */
  matchExistingName: string | null
}

interface ReconcileResult {
  decisions: ReconcileDecision[]
}

async function reconcileUnmatchedWithAI(
  app: FastifyInstance,
  storyId: string,
  chapterId: string,
  existingArcs: ExistingArcView[],
  unmatchedRaws: NonNullable<PlotArcAnalysis['arcs']>[number][],
  matchedExistingIds: Set<string>
): Promise<ConsolidatedArcWrite[]> {
  const prisma = app.prisma
  const base = await loadRuntimeBase(storyId, prisma)
  const task = await loadWorkerTask(storyId, 'memory', prisma)  // 与 plot-extractor 保持一致

  const prompt = buildReconcilePrompt(existingArcs, unmatchedRaws)
  const compiler = new RuntimePromptCompiler()
  const compiled = compiler.compile(base, task, prompt)

  const raw = await callAIWithLog(app, {
    storyId, chapterId, callType: 'plot_reconcile',
    compiled, temperature: 0.1, maxTokens: 1024
  })
  if (!raw) throw new Error('AI reconcile 返回为空')

  let result: ReconcileResult
  try {
    result = JSON.parse(cleanJsonBlock(raw)) as ReconcileResult
  } catch (parseErr: any) {
    throw new Error(`AI reconcile JSON parse failed: ${parseErr.message}`)
  }

  if (!result || !Array.isArray(result.decisions)) {
    throw new Error('AI reconcile 返回格式错误 (缺少 decisions 数组)')
  }

  const existingByName = new Map(existingArcs.map(e => [e.name, e]))
  const writes: ConsolidatedArcWrite[] = []
  const decidedRawNames = new Set<string>()

  for (const decision of result.decisions) {
    const rawArc = unmatchedRaws.find(r => r.name === decision.rawName)
    if (!rawArc) continue  // AI 幻觉, 忽略
    decidedRawNames.add(decision.rawName)

    const matchedExisting = decision.matchExistingName
      ? existingByName.get(decision.matchExistingName)
      : null

    if (matchedExisting) {
      // 归一化到 existing.name + 用 raw 的其他字段
      // 关键: 记录 matchedExistingIds, 防止外层 carry-forward 重复加入
      matchedExistingIds.add(matchedExisting.id)
      writes.push(mergeRawIntoExisting(storyId, matchedExisting, rawArc))
    } else {
      writes.push(newArcFromRaw(storyId, rawArc))
    }
  }

  // 兜底: AI 没给决策的 unmatched raw → 当 new 处理
  for (const raw of unmatchedRaws) {
    if (!decidedRawNames.has(raw.name)) {
      writes.push(newArcFromRaw(storyId, raw))
    }
  }

  return writes
}

function buildReconcilePrompt(
  existingArcs: ExistingArcView[],
  unmatchedRaws: NonNullable<PlotArcAnalysis['arcs']>[number][]
): string {
  const existingList = existingArcs.map(a =>
    `- name: ${a.name} | type: ${a.type} | status: ${a.status} | progress: ${a.progress} | summary: ${a.summary}`
  ).join('\n')

  const rawList = unmatchedRaws.map(r =>
    `- name: ${r.name} | type: ${r.type} | status: ${r.status} | progress: ${r.progress} | summary: ${r.summary}`
  ).join('\n')

  return `你是小说剧情弧线整理助手。

【任务】
判断下列"本章新提取的剧情弧线"中，每条是否与"已有剧情弧线"中的某一条是同一条弧线
（重命名 / 别名 / 视角差异 / 合并自多条 earlier 弧线）。返回每条 raw 弧线的归属决策。

【已有剧情弧线（数据库 N-1 状态）】
${existingList}

【本章新提取（未匹配）】
${rawList}

【判定规则】
1. 如果 raw 与 existing 指代同一条弧线（同名 / 别名 / 同一主线的不同表述 / 视角不同但核心是同一事件线），返回 matchExistingName=该 existing.name
2. 如果 raw 是真正的新弧线（已有列表里没有对应），返回 matchExistingName=null
3. 不要捏造不存在于"已有剧情弧线"列表里的 matchExistingName
4. 不要漏掉 raw — 每条 raw 必须对应一个 decision

【返回格式】
严格 JSON，不要 markdown：
{
  "decisions": [
    { "rawName": "<raw.name>", "matchExistingName": "<existing.name 或 null>" }
  ]
}`
}

// ---------------------------------------------------------------------------
// Pure helpers — 不依赖 AI / DB, 便于单测
// ---------------------------------------------------------------------------

/**
 * 进度单调不减: existing=35, raw=25 → 返回 35 (不回退)。
 * 用户真实痛点: AI 不擅长算百分比, 经常返回低于现有的进度。
 */
function monotonicMax(existingProgress: number, rawProgress: number): number {
  if (typeof rawProgress !== 'number' || isNaN(rawProgress)) return existingProgress
  if (typeof existingProgress !== 'number' || isNaN(existingProgress)) return rawProgress
  return Math.max(existingProgress, rawProgress)
}

/**
 * 合并 stages 列表: 已有 stages + 当前 new stage (若不重复)
 *
 * 与 plot-extractor.preparePlotArcWrites 逻辑一致 (line ~136-143):
 *   if (currentStage && !stages.some(s => s.stage === currentStage)) {
 *     stages.push({ stage, completed: status === 'completed', description: summary })
 *   }
 *
 * 抽出到这里因为 consolidator 需要在写库前合并 stages (现有 stages 不能丢)。
 */
function mergeStages(
  existingStagesJson: string,
  raw: NonNullable<PlotArcAnalysis['arcs']>[number]
): string {
  let stages: any[] = []
  try {
    stages = JSON.parse(existingStagesJson)
    if (!Array.isArray(stages)) stages = []
  } catch {
    stages = []
  }

  if (raw.currentStage && !stages.some((s: any) => s.stage === raw.currentStage)) {
    stages.push({
      stage: raw.currentStage,
      completed: raw.status === 'completed',
      description: raw.summary
    })
  }

  return JSON.stringify(stages)
}

/**
 * 新弧线初始 stages — 包含当前 stage (若存在)
 */
function initialStagesFromRaw(raw: NonNullable<PlotArcAnalysis['arcs']>[number]): string {
  if (!raw.currentStage) return '[]'
  return JSON.stringify([{
    stage: raw.currentStage,
    completed: raw.status === 'completed',
    description: raw.summary
  }])
}