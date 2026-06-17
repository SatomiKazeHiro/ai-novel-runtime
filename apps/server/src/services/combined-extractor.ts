import type { FastifyInstance } from 'fastify'
import { RuntimePromptCompiler, estimateTokens } from '@novel-runtime/ai-provider'
import { truncateByParagraph } from '@novel-runtime/prompt-runtime'
import { cleanJsonBlock, safeJsonParse, type PendingArchiveData } from '@novel-runtime/shared'
import { loadRuntimeBase, loadWorkerTask } from './runtime-loader.js'
import { callAIWithLog } from './ai-call-logger.js'
import { resolveProvider } from './ai-provider-init.js'
import { type MemoryExtractionResult, extractMemoryFromChapter, prepareMemoryWrites, type ArchiveMemoryData } from './memory-extractor.js'
import { type GraphExtractionResult } from './graph-extractor.js'
import { type PlotArcAnalysis, extractPlotArcs, preparePlotArcWrites, type PlotArcWrite } from './plot-extractor.js'
import { organizeGraph } from './graph-organizer.js'
import { type GraphSnapshot } from './graph-snapshot.js'

export interface CombinedExtractionData {
  memories: MemoryExtractionResult | null
  graph: GraphExtractionResult
  plotArcs: PlotArcAnalysis | null
}

/** N-1 inventory cap: 防 prompt 爆炸；超出按 importance desc 截断 */
export const PREV_SNAPSHOT_INVENTORY_CAP = 500

// 章节内容 token 预算（借鉴 graph-organizer 的 SAFETY_MARGIN / BUDGET_HEADROOM 模式）
// tokenBudget = floor(contextLength × RATIO) − maxTokens − SAFETY
//   0.6 留给 system + lore + memory + ...; 真实生产数据校准前先保守
// TODO: 真实生产数据校准 CONTENT_BUDGET_CONTEXT_RATIO
//       (system + lore 在不同故事下占比差很大, 当前是粗估)
const CONTENT_BUDGET_CONTEXT_RATIO = 0.6
const CONTENT_BUDGET_SAFETY_MARGIN_TOKENS = 2000
// CJK mixed content: ~1.5 chars/token, 取保守值 2.0 留 buffer
//   (宁可少放内容也不要超 contextLength 把整段 prompt 截断)
const CONTENT_BUDGET_CHARS_PER_TOKEN = 2.0
// 实际 token 使用率 ≥ 此值时打 TODO warn（供将来接"告警面板"用, 当前不阻断流程）
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

  // 加载已有弧线：只保留活跃/待收尾/待启动的 + 近期（30天内）更新过的
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
  const existingArcs = await prisma.plotArc.findMany({
    where: {
      storyId,
      OR: [
        { status: { in: ['active', 'resolving', 'pending'] } },
        { updatedAt: { gte: thirtyDaysAgo } }
      ]
    }
  })
  const existingArcsText = existingArcs.length > 0
    ? existingArcs.map(a => `- ${a.name} (${a.type}, ${a.status}, 进度${a.progress}%)`).join('\n')
    : '暂无已追踪的剧情弧线'

  // 加载已有节点（用于去重提示）：角色节点全部保留 + 其他类型只保留最近100个
  const [characterNodes, recentOtherNodes] = await Promise.all([
    prisma.graphNode.findMany({ where: { storyId, type: 'character' } }),
    prisma.graphNode.findMany({
      where: { storyId, type: { not: 'character' } },
      orderBy: { createdAt: 'desc' },
      take: 100
    })
  ])
  const combinedNodes = [...characterNodes, ...recentOtherNodes]
  const existingKeys = new Set(combinedNodes.map(n => `${n.type}:${n.key}`))

  app.log.info(
    `[CombinedExtractor] Context injection: ${existingArcs.length} arcs, ${characterNodes.length} characters, ${recentOtherNodes.length} recent nodes`
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
  let previousEntitiesBlock = ''
  if (previousSnapshot && previousSnapshot.nodes.length > 0) {
    const sorted = [...previousSnapshot.nodes]
      .sort((a, b) => {
        const ai = (a.data?.importance as number) || 0
        const bi = (b.data?.importance as number) || 0
        return bi - ai
      })
    const trimmed = sorted.slice(0, PREV_SNAPSHOT_INVENTORY_CAP)
    const lines = trimmed.map(n => `- ${n.type}:${n.key} (${n.label})`)
    previousEntitiesBlock = `\n\n=== N-1 全局图谱中的实体清单（用于 key 复用） ===\n本故事 N-1 章后的图谱共有 ${previousSnapshot.nodes.length} 个实体，请严格复用以下 type:key，禁止再造新 key：\n${lines.join('\n')}\n注意：N-1 没有出现的实体才允许创建新 key。新 key 必须用英文小写、下划线分隔。`
  }

  const extractPrompt = `请分析以下小说章节，同时完成【记忆提取】、【实体关系提取】和【剧情弧线分析】三个任务。返回严格 JSON 格式，不要 markdown 代码块，不要解释文字。

=== 严格 JSON 格式要求（不要违反，否则会解析失败）===
- 所有字段值必须是合法 JSON 值（数字、字符串、布尔、null、数组、对象）。绝对不要用 "&" 或 "..." 或 "etc" 之类占位符
- 字符串里的 "&" 必须转义为 "&"（或者直接用"和"代替）
- 数字字段（importance、progress 等）必须是 0-10 的整数或小数，不要用任何非数字字符
- 字段值如果不知道，请用 null 或空数组 []，不要用任何替代字符

=== 任务1：记忆提取 ===
提取对剧情有实质推动作用的信息。
本故事主角：${protagonistNames.join('、') || '无明确主角'}

每条事件必须包含：
- description: 简洁描述"有什么人做了什么"
- participants: 参与该事件的所有角色名单
- importance: 事件在本章的重要性（4~7）。如果事件有主角参与，请自行+1，最终为5~8。

importance 评分标准：
- 7: 本章核心转折/高潮，占大量篇幅
- 6: 重要推进，占中等篇幅
- 5: 有一定作用，占少量篇幅
- 4: 过渡/铺垫，篇幅很短

主角参与且达到 8 分的事件视为"主要事件"，放入 mainEvents；其他放入 sideEvents。

**重要：mainEvents 和 sideEvents 数组的顺序必须和事件在文章中的出现顺序完全一致，不能打乱，更不能把结尾的事件放到数组开头。**

事件格式示例：
{
  "description": "许青向姜禾解释现代社会的身份制度和法律危险",
  "participants": ["许青", "姜禾"],
  "importance": 6
}

提取字段：
- mainEvents: 主要事件（对象数组，每个对象包含 description / participants / importance）
- sideEvents: 次要事件（对象数组，格式同上）
- emotions: 主要角色情绪变化（字符串数组）
- foreshadowing: 新埋下的伏笔（字符串数组）
- relationshipChanges: 角色关系变化（字符串数组）
- characterStatusChanges: 角色状态变化（对象，如 {"张三": {"rank": "初级", "location": "北京", "relationships": {"李四": "兄弟", "王五": "敌对"}}}）。其中 relationships 子键可选，用于表达该角色与其他角色的关系变化。
- timelineDay: 本章发生在第几天（数字，不确定则 null）
- summary: 本章一句话摘要（50字以内）
- scenes: 推动剧情的关键地点（对象数组，如 [{ "location": "名称", "description": "场景描写（可选）", "event": "在此发生的事件概括", "importance": 1-10 }]）
  场景 importance 标准：7-10 核心剧情地点，4-6 有一定事件，1-3 路人提及/无实质事件

=== 任务2：实体与关系提取 ===
提取 importance >= 6 的核心实体和它们之间的关系：
- nodes: [{ type: "character"|"faction"|"event"|"item", key: "唯一标识（英文小写）", label: "显示名称", importance: 1-10, data: {...} }]
- edges: [{ fromKey, fromType, toKey, toType, relation, importance: 1-10 }]
  relation 应该是一个简洁的核心词或短语（2-6字为佳），直接表达两实体间的核心联系，不要带状语、从句或补充说明

=== 节点质量约束（重要）===
只提取能推动剧情发展的实体：
- 角色：仅当本章发生了状态变化（修为/位置/身份/阵营/关系）或剧情转折点
- 势力：仅当本章发生存亡/合并/对抗/结盟等变化
- 物品：仅当本章有归属变更、能力觉醒、用于关键事件
- 事件：仅当本章明确发生或被揭示
禁止提取：路人甲乙丙、纯环境描述、一次性对话提及、无后续影响的设定

已有实体（不要重复提取，但可补充新属性）：${Array.from(existingKeys).join(', ') || '无'}${previousEntitiesBlock}

=== 任务3：剧情弧线分析 ===
分析已有弧线的推进，标注未解悬念：
现有弧线：
${existingArcsText}

返回弧线列表：
- arcs: [{ name, type: "main"|"side", status: "pending"|"active"|"resolving"|"completed", progress: 0-100, currentStage, nextGoal, unresolved: [], summary }]

=== 返回格式 ===
{
  "memories": { mainEvents, sideEvents, emotions, foreshadowing, relationshipChanges, characterStatusChanges, timelineDay, summary, scenes },
  "graph": { "nodes": [...], "edges": [...] },
  "plotArcs": { "arcs": [...] }
}

章节大纲：${outline || '无大纲'}
章节内容如下：
${truncatedContent}`

  app.log.info(`[CombinedExtractor] Calling AI for chapter ${chapterId}`)

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
      const actualContentTokens = estimateTokens(truncatedContent)
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
  let result: any
  try {
    result = JSON.parse(cleanJsonBlock(raw))
  } catch (firstErr: any) {
    app.log.warn(
      `[CombinedExtractor] JSON parse failed (${firstErr.message.slice(0, 200)}), retrying AI call once`
    )
    let retryRaw: string | null
    try {
      // 注意：retry 复用同一份 compiled prompt，不修改 prompt 内容。
      // LLM 抽风是偶发性（temperature > 0 + 采样），同一 prompt 多次调用
      // 大概率能得到合法 JSON。真正治本需要在 prompt 里加格式约束（已
      // 在 extractPrompt 里加"所有字段值必须是合法 JSON"提示），这里只
      // 是兜底。
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
      result = JSON.parse(cleanJsonBlock(retryRaw))
      app.log.info(`[CombinedExtractor] Retry succeeded`)
    } catch (retryErr: any) {
      throw new Error(
        `AI 返回格式错误，已重试一次仍失败。` +
        `第一次错误: ${firstErr.message.slice(0, 200)}；` +
        `重试错误: ${retryErr.message.slice(0, 200)}`
      )
    }
  }

  const memories: MemoryExtractionResult = result.memories
  const graph: GraphExtractionResult = result.graph || { nodes: [], edges: [] }
  const plotArcs: PlotArcAnalysis = result.plotArcs

  // 统计
  const memCount = (memories?.mainEvents?.length || 0) +
                   (memories?.sideEvents?.length || 0) +
                   (memories?.emotions?.length || 0) +
                   (memories?.foreshadowing?.length || 0) +
                   (memories?.relationshipChanges?.length || 0) +
                   (memories?.scenes?.length || 0) +
                   Object.keys(memories?.characterStatusChanges || {}).length

  app.log.info(
    `[CombinedExtractor] Extracted: ${memCount} memories, ${graph.nodes?.length || 0} nodes, ${graph.edges?.length || 0} edges, ${plotArcs?.arcs?.length || 0} arcs`
  )

  return { memories, graph, plotArcs }
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
      select: { graphSnapshot: true }
    })
    if (parent?.graphSnapshot) {
      previousSnapshot = safeJsonParse(parent.graphSnapshot, null)
    }
  }
  if (!previousSnapshot) {
    const lastArchived = await prisma.chapter.findFirst({
      where: { storyId, status: 'archived', id: { not: chapterId } },
      orderBy: { number: 'desc' },
      select: { graphSnapshot: true }
    })
    if (lastArchived?.graphSnapshot) {
      previousSnapshot = safeJsonParse(lastArchived.graphSnapshot, null)
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

  // 5. 准备剧情弧线写入数据
  const plotArcWrites = extraction.plotArcs
    ? await preparePlotArcWrites(prisma, storyId, extraction.plotArcs.arcs)
    : []

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
