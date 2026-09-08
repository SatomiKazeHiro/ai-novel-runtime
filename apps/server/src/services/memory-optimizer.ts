import type { FastifyInstance } from 'fastify'
import { RuntimePromptCompiler } from '@novel-runtime/ai-provider'
import { cleanJsonBlock } from '@novel-runtime/shared'
import { loadRuntimeBase, loadWorkerTask } from './runtime-loader.js'
import { callAIWithLog } from './ai-call-logger.js'

/**
 * memory-optimizer 融合结果(v3 memory system, 2026-07-30 spec D8)
 *
 *   - content: AI 给的状态快照描述
 *   - originUid: AI 输出的 UID
 *       * 继承: AI 返回旧 UID, 必须是 globalMap 里有的(否则视为 NEW)
 *       * NEW: AI 表示新事件, 调用方在 prepare-archive 路径上生成
 *   - importance: 1-10, AI 给
 *   - type: 'event' (情节) / 'state' (状态快照)
 *
 * 注意: 此函数**只产融合结果, 不写库**。prepare-archive 端点拿到返回值后覆盖
 * pendingArchiveData.stages.memory.result.memories; archive confirm 再统一写 Memory
 * 表三层 + Chapter.summary。tags 由后端按 layer 规则添加 ('auto-extracted' 前缀),
 * AI 不输出 tag。
 */
export interface OptimizedMemory {
  content: string
  /** 继承的旧 UID 或 'NEW'。prepare-archive 路径会把 'NEW' 替换为生成的 UID。 */
  originUid: string
  importance: number
  type: 'event' | 'state'
}

/** 喂给 optimizer 的 raw 记忆,来自 memory-stage result 字段(不是 DB)。 */
export interface MemoryStageRawResult {
  mainEvents: Array<{ description: string; participants: string[]; importance: number }>
  sideEvents: Array<{ description: string; participants: string[]; importance: number }>
  emotions: string[]
  foreshadowing: string[]
  relationshipChanges: string[]
  scenes: Array<{ location: string; event: string; importance: number }>
  summary: string
}

/**
 * 跨章记忆融合。
 *
 * 流程:
 *   1. 查 layer='global' 现有所有行, 按 originUid 分组取每个 UID 最新一条 (fromChapterNumber desc)
 *   2. raw = 调用方传入的 memory-stage result 字段(不读 DB, 因为 archive confirm 还没写)
 *   3. 把 globalMap 摘要 + raw 摘要喂给 AI, AI 输出新 global 记忆
 *   4. AI 输出 originUid:
 *      - 继承: 必须是 globalMap 里有的
 *      - 'NEW': 新事件, 由调用方分配 UID
 *
 * @returns AI 给的融合结果(originUid 校验后)。**不**调 prisma.memory.create。
 */
export async function optimizeMemories(
  app: FastifyInstance,
  storyId: string,
  chapterId: string,
  raw: MemoryStageRawResult
): Promise<OptimizedMemory[]> {
  const prisma = app.prisma

  // 1. 查现有 global 记忆, 按 originUid 分组取最新版本
  const allGlobal = await prisma.memory.findMany({
    where: { storyId, layer: 'global' },
    orderBy: { fromChapterNumber: 'desc' }
  })

  const globalMap = new Map<string, typeof allGlobal[0]>()
  for (const m of allGlobal) {
    if (!m.originUid) continue
    if (!globalMap.has(m.originUid)) globalMap.set(m.originUid, m)
  }
  const latestGlobal = Array.from(globalMap.values())

  // 2. 拼 raw 文本
  const rawLines: string[] = []
  for (const e of raw.mainEvents) rawLines.push(`- (重要度${e.importance}) ${e.description}`)
  for (const e of raw.sideEvents) rawLines.push(`- (重要度${e.importance}) ${e.description}`)
  for (const s of raw.scenes) rawLines.push(`- (地点:${s.location}, 重要度${s.importance}) ${s.event}`)
  for (const e of raw.emotions) rawLines.push(`- 情绪: ${e}`)
  for (const f of raw.foreshadowing) rawLines.push(`- 伏笔: ${f}`)
  for (const r of raw.relationshipChanges) rawLines.push(`- 关系变化: ${r}`)
  const rawText = rawLines.length > 0 ? rawLines.join('\n') : '暂无本章原始记忆'

  if (latestGlobal.length === 0 && rawLines.length === 0) {
    app.log.info('[MemoryOptimizer] No memories to optimize')
    return []
  }

  // 3. 查主角名单
  const protagonists = await prisma.character.findMany({
    where: { storyId, protagonist: true },
    select: { name: true }
  })

  // 4. prompt
  const globalText = latestGlobal.length > 0
    ? latestGlobal.map(m => `- [${m.originUid}] (重要度${m.importance}) ${m.content}`).join('\n')
    : '暂无全局记忆'

  const prompt = `你是小说记忆优化助手。请基于【当前全局记忆】和【本章原始记忆】，生成新的全局记忆。

本故事主角：${protagonists.map(p => p.name).join('、') || '无明确主角'}

【当前全局记忆】（按事件UID去重后的最新状态）
${globalText}

【本章原始记忆】
${rawText}

【优化原则】
1. 状态快照：描述必须是"当前状态"，不是过程流水账
   - 流水账："许青向姜禾解释...姜禾问...许青安抚..."
   - 状态快照："姜禾拒绝向官方求助，决定暂留许青家中学习现代常识"
2. 继承UID：如果是已有事件的延续/更新，originUid 必须填表中的旧UID 之一
3. 新UID：如果是全新事件，originUid 设为字符串 "NEW"（后端会自动分配）
4. 移除过时：已经解决/完成且不再影响后续剧情的事件，可以不输出
5. 保留核心：关键设定、角色状态必须保留
6. 适当精简：单条不要太长，保留核心内容即可

【输出格式】
严格JSON，不要markdown：
{
  "memories": [
    {
      "content": "状态快照描述",
      "originUid": "继承的旧UID或NEW",
      "importance": 4~8,
      "type": "event" | "state"
    }
  ]
}`

  const base = await loadRuntimeBase(storyId, prisma)
  const task = await loadWorkerTask(storyId, 'memory', prisma)
  const compiler = new RuntimePromptCompiler()
  const compiled = compiler.compile(base, task, prompt)

  const raw_ai = await callAIWithLog(app, {
    storyId, chapterId, callType: 'memory_optimize',
    compiled, temperature: 0.3, maxTokens: 4096
  })
  if (!raw_ai) {
    app.log.warn('[MemoryOptimizer] AI call returned empty')
    return []
  }

  const result: { memories: OptimizedMemory[] } = JSON.parse(cleanJsonBlock(raw_ai))
  const memories = (result.memories || []).filter(m => m && typeof m.content === 'string')

  // 校验 originUid: 继承的必须在 globalMap, 否则视为 NEW
  for (const mem of memories) {
    if (mem.originUid !== 'NEW' && !globalMap.has(mem.originUid)) {
      app.log.warn(`[MemoryOptimizer] Unknown originUid ${mem.originUid}, treating as NEW`)
      mem.originUid = 'NEW'
    }
  }

  app.log.info(
    `[MemoryOptimizer] Generated ${memories.length} global memories (chapterId=${chapterId}, from existing global=${latestGlobal.length})`
  )
  return memories
}
