import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { RuntimePromptCompiler, countTokens } from '@novel-runtime/ai-provider'
import { truncateByParagraph } from '@novel-runtime/prompt-runtime'
import {
  cleanJsonBlock,
  safeJsonParse,
  buildExtractPrompt,
  type PendingArchiveData
} from '@novel-runtime/shared'
import { loadRuntimeBase, loadWorkerTask } from './runtime-loader.js'
import { callAIWithLog } from './ai-call-logger.js'
import { resolveProvider } from './ai-provider-init.js'
import { type MemoryExtractionResult, extractMemoryFromChapter, prepareMemoryWrites, type ArchiveMemoryData } from './memory-extractor.js'
import { type GraphExtractionResult } from './graph-extractor.js'
import { organizeGraph } from './graph-organizer.js'
import { type GraphSnapshot } from './graph-snapshot.js'
import { consolidatePlotArcs } from './plot-consolidator.js'

export interface CombinedExtractionData {
  memories: MemoryExtractionResult | null
  graph: GraphExtractionResult
}

/**
 * AI 合并提取返回值的顶层 schema. 仅校验 2 个顶层字段是否存在 / 类型可识别;
 * 子结构 (memories / graph) 留给下游 service 处理 (与旧实现一致:
 * memories 可能为 null, graph 缺失用 {nodes:[],edges:[]} 兜底).
 *
 * 注: 剧情弧线不再由 extractAll 提取 — plot-consolidator v2 (worker) 自己读
 * 章节 + existing arcs 做语义级判断, 不依赖 AI 在这一步返回 raw arcs.
 *
 * 为什么不 strict:
 *   AI 偶尔会输出辅助字段 (e.g. `_reasoning`, `confidence`), strict 会让
 *   这些合法附带信息被误判为 "格式错误" 触发 retry,反而更不稳.
 *   顶层结构对齐 prompt 任务即可.
 */
const CombinedExtractResultSchema = z.object({
  memories: z.unknown().nullable(),
  graph: z.unknown().optional()
})
type CombinedExtractResult = z.infer<typeof CombinedExtractResultSchema>

/**
 * 把 AI 原始响应解析成 CombinedExtractResult. 两步:
 *   1. cleanJsonBlock + JSON.parse: 修 fence / 裸 &, 仍可能抛 (非法 JSON)
 *   2. CombinedExtractResultSchema.parse: 顶层结构校验
 * 任一步失败抛错, 上游 retry 块兜底.
 */
function parseCombinedResult(raw: string): CombinedExtractResult {
  const json = JSON.parse(cleanJsonBlock(raw))
  return CombinedExtractResultSchema.parse(json) as CombinedExtractResult
}

/** N-1 inventory cap: 防 prompt 爆炸；超出按 importance desc 截断 */
export const PREV_SNAPSHOT_INVENTORY_CAP = 500

// ---- Estimation vs Validation 边界 (P0 #8 收口, 2026-06-22) ----
// 本节 heuristic 是 **规划意图** (planning),不是真 token 数。
//   - CONTENT_BUDGET_* 算出来的 charBudget/tokenBudget → 喂给 truncateByParagraph 截段
//   - 截段后真值由 `countTokens(truncatedContent)` 在 line ~241 重算
//   - 真值与预算的差 (usageRatio >= CONTENT_BUDGET_HEADROOM) 触发 app.log.warn
// 因此: heuristic 失真只影响"截多少",不影响"AI 看到的最终内容长度"。
// 见 docs/ISSUES.md P0 #8 "estimation vs validation" 说明。

// 章节内容 token 预算（借鉴 graph-organizer 的 SAFETY_MARGIN / BUDGET_HEADROOM 模式）
// tokenBudget = floor(contextLength × RATIO) − maxTokens − SAFETY
//   0.6 留给 system + lore + memory + ...; 真实生产数据校准前先保守
// TODO: 真实生产数据校准 CONTENT_BUDGET_CONTEXT_RATIO
//       (system + lore 在不同故事下占比差很大, 当前是粗估)
const CONTENT_BUDGET_CONTEXT_RATIO = 0.6
const CONTENT_BUDGET_SAFETY_MARGIN_TOKENS = 2000
// CJK mixed content: ~1.5 chars/token, 取保守值 2.0 留 buffer
//   (宁可少放内容也不要超 contextLength 把整段 prompt 截断)
//   此处仅用于 charBudget 规划; 截段后用 countTokens 算真值校验。
const CONTENT_BUDGET_CHARS_PER_TOKEN = 2.0
// 实际 token 使用率 ≥ 此值时打 TODO warn（供将来接"告警面板"用, 当前不阻断流程）
// 校验点在 line ~241 (countTokens(truncatedContent) / tokenBudget)
const CONTENT_BUDGET_HEADROOM = 0.9
// aiConfig 缺失时的兜底（与 .env DEEPSEEK_CONTEXT_LENGTH 默认值一致）
const CONTENT_BUDGET_FALLBACK_CONTEXT = 64000
const CONTENT_BUDGET_FALLBACK_MAX_TOKENS = 4096

/**
 * 纯函数: 给定模型 contextLength 与 maxTokens, 算出章节内容可用 char / token 预算。
 * 借鉴 graph-organizer 的"先 compile 一次测 nonContentTokens"模式，但这里用 0.6 粗估
 * 留出 system + lore + memory 空间, 避免双次 compile 的开销。
 */
export function computeContentCharBudget(
  contextLength: number,
  maxTokens: number
): { charBudget: number; tokenBudget: number } {
  const tokenBudget = Math.max(
    0,
    Math.floor(contextLength * CONTENT_BUDGET_CONTEXT_RATIO) - maxTokens - CONTENT_BUDGET_SAFETY_MARGIN_TOKENS
  )
  const charBudget = Math.floor(tokenBudget * CONTENT_BUDGET_CHARS_PER_TOKEN)
  return { charBudget, tokenBudget }
}

// Re-export the shared `PendingArchiveData` so existing imports
// (`from '../services/combined-extractor.js'`) keep working unchanged.
// The shared type is the single source of truth for the shape parked in
// `Chapter.pendingArchiveData`; both server and web must agree on it.
export type { PendingArchiveData }

/**
 * 合并提取：记忆 + 图谱 + 剧情弧线，一次 API 调用完成
 * 纯提取，不写入数据库。写入请在外层事务中统一执行。
 */
export async function extractAll(
  app: FastifyInstance,
  chapterId: string,
  storyId: string,
  content: string,
  outline?: string,
  fromChapterNumber?: number,
  previousSnapshot?: GraphSnapshot | null
): Promise<CombinedExtractionData | null> {
  const prisma = app.prisma
  const chNum = fromChapterNumber ?? 0

  // 查询本故事的主角名单
  const protagonists = await prisma.character.findMany({
    where: { storyId, protagonist: true },
    select: { name: true }
  })
  const protagonistNames = protagonists.map(p => p.name)

  // 加载已有节点（用于去重提示）：从 latest archived chapter 的 cumulativeGraph
  // 读 — v3 唯一 source-of-truth。GraphNode 表已弃用。
  // 按原"character 全部 + 其他取最近 100 个"语义切两组。
  const latestArchived = await prisma.chapter.findFirst({
    where: { storyId, status: 'archived', id: { not: chapterId } },
    orderBy: { number: 'desc' },
    select: { cumulativeGraph: true }
  })
  const prevSnapshotNodes: any[] = latestArchived?.cumulativeGraph
    ? (safeJsonParse<GraphSnapshot | null>(latestArchived.cumulativeGraph, null)?.nodes || [])
    : []
  const characterNodes = prevSnapshotNodes.filter((n) => n.type === 'character')
  const recentOtherNodes = prevSnapshotNodes
    .filter((n) => n.type !== 'character')
    .slice(-100) // cumulativeGraph 数组顺序 = 累计顺序；取末尾 100
  const existingKeys = new Set(prevSnapshotNodes.map((n) => `${n.type}:${n.key}`))

  app.log.info(
    `[CombinedExtractor] Context injection: ${characterNodes.length} characters, ${recentOtherNodes.length} recent nodes`
  )

  // 解析当前章节 / 故事 / 全局默认的 AI Provider 配置, 用于算 content 预算
  // (借鉴 graph-organizer.ts:49 的 resolveProvider 模式)
  const resolvedAi = await resolveProvider(prisma, storyId, chapterId)
  const aiContextLength = resolvedAi?.config?.contextLength || CONTENT_BUDGET_FALLBACK_CONTEXT
  const aiMaxTokens = resolvedAi?.config?.maxTokens || CONTENT_BUDGET_FALLBACK_MAX_TOKENS
  const { charBudget: contentCharBudget, tokenBudget: contentTokenBudget } =
    computeContentCharBudget(aiContextLength, aiMaxTokens)
  // 一次性 truncate, 后续 warn 复用同一份结果, 避免双次计算
  const truncatedContent = truncateByParagraph(content, contentCharBudget)

  // Inject N-1 entity inventory so the AI reuses existing type:key values
  // instead of inventing new ones. Cap at 500 to defend against extremely
  // large graphs; trim by descending importance when capped.
  // NOTE: previousEntitiesBlock 现在只在 buildExtractPrompt('full') 内部构造;
  // 'slim' 模式不消费这些跨章上下文, AI 只输出本章事实。
  // existingArcs 由独立的 plot-consolidator v2 worker 自己读 DB 获取,
  // 不再喂给 extract prompt (v1 的 slim 模式喂 existingArcs 但没用,
  // v2 设计意图是 consolidator 自己读章节做语义判断)。
  const extractPrompt = buildExtractPrompt(
    {
      protagonistNames,
      existingNodeKeys: Array.from(existingKeys),
      previousSnapshotNodes: previousSnapshot?.nodes || [],
      content: truncatedContent,
      outline
    },
    { mode: 'slim' }
  )

  app.log.info(`[CombinedExtractor] Calling AI for chapter ${chapterId} (mode=slim)`)

  // compiled 提到 try 外面声明：retry 块也要复用同一份 prompt，
  // 必须在 raw 已成功（说明 try 块成功）的代码路径上能访问 compiled。
  let raw: string | null
  let compiled: ReturnType<RuntimePromptCompiler['compile']> | null = null
  try {
    const base = await loadRuntimeBase(storyId, prisma)
    const task = await loadWorkerTask(storyId, 'memory', prisma)

    const compiler = new RuntimePromptCompiler()
    compiled = compiler.compile(base, task, extractPrompt)

    // 章节内容若被 truncate → TODO warn（供将来接"告警面板"用, 当前不阻断流程）
    //   借鉴 graph-organizer.ts:72-80 的 90% headroom 模式
    //   不在 prompt 模板里写, 是因为 truncateByParagraph 可能在 content 短于
    //   预算时不截断 — 用实际截断后长度判断更准确
    if (content.length > contentCharBudget) {
      const actualContentTokens = countTokens(truncatedContent)
      const usageRatio = actualContentTokens / Math.max(1, contentTokenBudget)
      if (usageRatio >= CONTENT_BUDGET_HEADROOM) {
        app.log.warn(
          `[TODO][CombinedExtractor] Chapter ${chapterId} content exceeds budget: ` +
          `${truncatedContent.length}/${contentCharBudget} chars ` +
          `(${actualContentTokens}/${contentTokenBudget} tokens, ${(usageRatio * 100).toFixed(0)}%). ` +
          `Consider splitting the chapter or raising model contextLength.`
        )
      }
    }

    // 不传 maxTokens → 由 provider `options?.maxTokens ?? aiConfig.maxTokens`
    // 链回退到用户在 ModelManager 配置的值。合并提取把记忆+图谱+弧线压
    // 在一次调用里，4096 的硬编码预算经常不够，会被 maxTokens 截断导致
    // markdown fence 不闭合、JSON.parse 失败（旧实现还会吞掉这个错误）。
    raw = await callAIWithLog(app, {
      storyId, chapterId, callType: 'combined_extract',
      compiled, temperature: 0.3
    })
  } catch (err: any) {
    app.log.error(`[CombinedExtractor] AI call failed: ${err.message}`)
    return null
  }
  if (!raw || !compiled) return null

  // JSON 解析失败（含 cleanJsonBlock 检测到的不完整 fence）直接抛给上游。
  // 路由 chapters.ts:603 的 catch 会把 err.message 透传到前端，让用户看
  // 到真实错误（"响应被截断，请增大 maxTokens…"）而不是误导的
  // "AI 提取返回为空"。
  //
  // 兜底：cleanJsonBlock 已经能修"裸 &"（value 位置出现 &）等小问题。
  // 对于修不了的结构损坏，按用户约束"以稳为主、允许多调几次 AI 兜底"
  // 重试一次（带不同 callType 让 PromptLog 区分两次调用），抽风是偶发
  // 性，重试大概率能拿到合法 JSON。第二次仍失败才抛错。
  let result: CombinedExtractResult
  try {
    result = parseCombinedResult(raw)
  } catch (firstErr: any) {
    app.log.warn(
      `[CombinedExtractor] Parse/validate failed (${firstErr.message.slice(0, 200)}), retrying AI call once`
    )
    let retryRaw: string | null
    try {
      // 注意：retry 复用同一份 compiled prompt，不修改 prompt 内容。
      // LLM 抽风是偶发性（temperature > 0 + 采样），同一 prompt 多次调用
      // 大概率能得到合法 JSON。temperature 从 0.3 降到 0.1 进一步压低采样
      // 噪声；compiled prompt 文本不改。真正治本需要在 prompt 里加格式约
      // 束（已在 extractPrompt 里加"所有字段值必须是合法 JSON"提示）。
      retryRaw = await callAIWithLog(app, {
        storyId, chapterId, callType: 'combined_extract_retry',
        compiled, temperature: 0.1
      })
    } catch (retryApiErr: any) {
      throw new Error(
        `AI 返回格式错误（第一次: ${firstErr.message.slice(0, 200)}），` +
        `重试时 AI 调用也失败: ${retryApiErr.message}`
      )
    }
    if (!retryRaw) {
      throw new Error(
        `AI 返回格式错误（第一次: ${firstErr.message.slice(0, 200)}），` +
        `重试时 AI 返回为空`
      )
    }
    try {
      result = parseCombinedResult(retryRaw)
      app.log.info(`[CombinedExtractor] Retry succeeded`)
    } catch (retryErr: any) {
      throw new Error(
        `AI 返回格式错误，已重试一次仍失败。` +
        `第一次错误: ${firstErr.message.slice(0, 200)}；` +
        `重试错误: ${retryErr.message.slice(0, 200)}`
      )
    }
  }

  // schema 只校验顶层字段存在;子结构交给下游 service 兜底(与旧实现语义一致)
  const memories = (result.memories ?? null) as MemoryExtractionResult | null
  const graph = (result.graph || { nodes: [], edges: [] }) as GraphExtractionResult

  // 统计
  const memCount = (memories?.mainEvents?.length || 0) +
                   (memories?.sideEvents?.length || 0) +
                   (memories?.emotions?.length || 0) +
                   (memories?.foreshadowing?.length || 0) +
                   (memories?.relationshipChanges?.length || 0) +
                   (memories?.scenes?.length || 0) +
                   Object.keys(memories?.characterStatusChanges || {}).length

  app.log.info(
    `[CombinedExtractor] Extracted: ${memCount} memories, ${graph.nodes?.length || 0} nodes, ${graph.edges?.length || 0} edges`
  )

  return { memories, graph }
}

/**
 * 准备归档数据：提取 + 整理，但不写入数据库
 * 返回的数据可直接序列化存储在 Chapter.pendingArchiveData 中
 */
export async function prepareArchiveData(
  app: FastifyInstance,
  chapterId: string,
  storyId: string,
  content: string,
  outline: string | null,
  fromChapterNumber: number,
  parentChapterId: string | null
): Promise<PendingArchiveData | null> {
  const prisma = app.prisma

  // 0. 查找上一章全局图谱 snapshot（必须在 extractAll 之前准备好，
  //    这样 combined_extract 就能注入 N-1 实体清单帮 AI 复用 type:key。
  //    同一份 previousSnapshot 后面 graph-organize 也会用（避免重查）。）
  let previousSnapshot: GraphSnapshot | null = null
  if (parentChapterId) {
    const parent = await prisma.chapter.findUnique({
      where: { id: parentChapterId },
      select: { cumulativeGraph: true }
    })
    if (parent?.cumulativeGraph) {
      previousSnapshot = safeJsonParse(parent.cumulativeGraph, null)
    }
  }
  if (!previousSnapshot) {
    const lastArchived = await prisma.chapter.findFirst({
      where: { storyId, status: 'archived', id: { not: chapterId } },
      orderBy: { number: 'desc' },
      select: { cumulativeGraph: true }
    })
    if (lastArchived?.cumulativeGraph) {
      previousSnapshot = safeJsonParse(lastArchived.cumulativeGraph, null)
    }
  }

  // 1. 纯提取（传 N-1 图谱快照，combined_extract 注入 N-1 实体清单帮 AI 复用 key）
  //    同一份 previousSnapshot 后面 graph-organize 也会用（避免重查）
  const extraction = await extractAll(
    app, chapterId, storyId, content, outline || undefined, fromChapterNumber, previousSnapshot
  )
  if (!extraction || !extraction.memories) {
    return null
  }

  // 3. 整理图谱
  const graphRaw = extraction.graph || { nodes: [], edges: [] }
  const graphOrganized = await organizeGraph(app, storyId, chapterId, previousSnapshot, graphRaw)

  // 4. 准备记忆写入数据
  const memoryData = prepareMemoryWrites(storyId, chapterId, extraction.memories, fromChapterNumber)

  // 5. 跨章融合剧情弧线 (P1 bug fix: plot arc 不增长)
  //    v2 设计 (用户 2026-06-26): consolidator 自己读章节内容 + existingArcs,
  //    AI 做语义判断 — 不再依赖 extractAll.plotArcs (slim prompt 没喂 existingArcs,
  //    raw arcs 名字已经歪, 喂给 consolidator 只是把错误传下去)。
  //    AI prompt 提示 "笔墨浓重/推动剧情/情感强烈" 才开新 arc, 避免把过渡/路人做成 arc。
  //    注: 这里查全量 arc (不限于 active), 因为 carry-forward 需要看到 completed 之外的
  //       所有状态才能正确判断"是否被本章节推进过"。
  const allExistingArcs = await prisma.plotArc.findMany({ where: { storyId } })
  const plotArcWrites = await consolidatePlotArcs(
    app, storyId, chapterId, allExistingArcs, content, outline || undefined
  )

  return {
    memories: memoryData,
    graph: {
      mergedGraph: graphOrganized.mergedGraph,
      chapterGraph: graphOrganized.chapterGraph
    },
    plotArcs: plotArcWrites,
    meta: {
      extractedAt: new Date().toISOString(),
      chapterNumber: fromChapterNumber
    }
  }
}

// 兼容旧接口
export { extractMemoryFromChapter }
