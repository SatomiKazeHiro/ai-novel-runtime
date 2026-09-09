import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { RuntimePromptCompiler } from '@novel-runtime/ai-provider'
import { cleanJsonBlock } from '@novel-runtime/shared'
import { loadRuntimeBase, loadWorkerTask } from './runtime-loader.js'
import { callAIWithLog } from './ai-call-logger.js'

/**
 * plot-consolidator v3 — 事实 + 派生状态。
 *
 * AI 只输出「本章的推进点（可打 isEnd）+ 相似关闭」，不输出 progress/stages/
 * currentStage/nextGoal/unresolved/summary，也不直接打「完成」。
 * 弧线状态由 plot-arc-status.ts 的 derivePlotArcStatus 在归档后推导。
 *
 * AI 返回 contract:
 *   {
 *     "arcUpdates": [{ "arcId", "content", "isEnd" }],
 *     "newArcs":    [{ "name", "isMainline", "content", "isEnd" }],
 *     "closes":     [{ "arcId", "targetArcId" }]
 *   }
 *
 * 失败行为：AI 失败直接抛错（让 stage 标 failed，用户 retry），不再 carry-forward 兜底。
 */

export interface PlotArcWriteRow {
  storyId: string
  arcId: string | null
  name: string
  isMainline: boolean
  content: string
  isEnd: boolean
  action: 'create' | 'update' | 'close'
  targetArcId?: string
}

export interface ExistingArcView {
  id: string
  name: string
  isMainline: boolean
  status: string
  firstChapterNumber: number
  closedBy: string | null
  closedTargetArcId: string | null
}

// ---------------------------------------------------------------------------
// Zod schemas
// ---------------------------------------------------------------------------

const ArcUpdateSchema = z.object({
  arcId: z.string(),
  content: z.string().min(1),
  isEnd: z.boolean().default(false)
})

const NewArcSchema = z.object({
  name: z.string().min(1),
  isMainline: z.boolean(),
  content: z.string().min(1),
  isEnd: z.boolean().default(false)
})

const CloseSchema = z.object({
  arcId: z.string(),
  targetArcId: z.string()
})

const ConsolidateResponseSchema = z.object({
  arcUpdates: z.array(ArcUpdateSchema),
  newArcs: z.array(NewArcSchema),
  closes: z.array(CloseSchema)
})

type ConsolidateResponse = z.infer<typeof ConsolidateResponseSchema>

// ---------------------------------------------------------------------------
// Main entry
// ---------------------------------------------------------------------------

export async function consolidatePlotArcs(
  app: FastifyInstance,
  storyId: string,
  chapterId: string,
  existingArcs: ExistingArcView[],
  chapterContent: string,
  chapterOutline?: string
): Promise<PlotArcWriteRow[]> {
  if (existingArcs.length === 0 && !chapterContent.trim()) return []

  const response = await callConsolidateAI(app, storyId, chapterId, existingArcs, chapterContent, chapterOutline)

  const existingById = new Map(existingArcs.map(e => [e.id, e]))
  const writes: PlotArcWriteRow[] = []

  for (const u of response.arcUpdates) {
    const existing = existingById.get(u.arcId)
    if (!existing) continue // AI 幻觉 id，忽略
    writes.push({
      storyId,
      arcId: existing.id,
      name: existing.name,
      isMainline: existing.isMainline,
      content: u.content,
      isEnd: u.isEnd,
      action: 'update'
    })
  }

  for (const n of response.newArcs) {
    writes.push({
      storyId,
      arcId: null,
      name: n.name,
      isMainline: n.isMainline,
      content: n.content,
      isEnd: n.isEnd,
      action: 'create'
    })
  }

  for (const c of response.closes) {
    if (!existingById.has(c.arcId)) continue
    writes.push({
      storyId,
      arcId: c.arcId,
      name: '',
      isMainline: false,
      content: '',
      isEnd: false,
      action: 'close',
      targetArcId: c.targetArcId
    })
  }

  app.log.info(
    `[PlotConsolidator] chapter ${chapterId}: ${response.arcUpdates.length} updates, ` +
    `${response.newArcs.length} new arcs, ${response.closes.length} closes`
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
    `- id: ${a.id} | name: ${a.name} | isMainline: ${a.isMainline} | status: ${a.status} | firstChapter: ${a.firstChapterNumber}`
  ).join('\n')

  return `你是小说剧情弧线整理助手。

【任务】
阅读"章节大纲 + 章节内容", 比对"已有剧情弧线", 完成以下判断:

1. 【推进已有弧线】对每条已有弧线, 判断本章是否推进了它:
   - 若推进: 在 arcUpdates 里输出一条, 含 arcId + content(本章推进内容, 一句话核心简练) + isEnd
   - 若没推进: 不在 arcUpdates 里出现

2. 【识别新弧线】判断是否有"笔墨浓重 / 推动剧情 / 情感强烈"的全新事件线值得开成新弧线:
   - 在 newArcs 里输出, 含 name + isMainline + content + isEnd
   - 不要把一次性对话 / 路人提及 / 纯环境描写做成新弧线

3. 【相似弧线管理】
   - 若两条弧线主题/冲突/角色高度重叠, 只保留重要的一条, 用 closes 关闭另一条(指向保留条)
   - 主线/支线(isMainline)跟章节 POV 绑定: 主角参与的标 true, 主角不参与的标 false

4. 【完成标记】
   - 若该弧线本章到尾声, 把该弧线本章推进点的 isEnd 设为 true(这是"可能结束"的参考标记, 不是终态)
   - 不要直接输出"完成"状态, 系统会自己判断

【已有剧情弧线】
${existingList || '(暂无, 这是故事开篇)'}

【章节大纲】
${chapterOutline || '(无大纲)'}

【章节内容】
${chapterContent}

【返回格式】严格 JSON, 不要 markdown 代码块:
{
  "arcUpdates": [
    { "arcId": "<已有弧线 id>", "content": "本章该弧线的推进内容(一句话)", "isEnd": false }
  ],
  "newArcs": [
    { "name": "新弧线标题", "isMainline": true, "content": "本章开启该弧线的推进内容", "isEnd": false }
  ],
  "closes": [
    { "arcId": "<要关闭的弧线 id>", "targetArcId": "<合并到的目标弧线 id>" }
  ]
}`
}
