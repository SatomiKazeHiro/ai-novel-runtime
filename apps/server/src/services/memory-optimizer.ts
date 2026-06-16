import type { FastifyInstance } from 'fastify'
import { randomBytes } from 'crypto'
import { RuntimePromptCompiler } from '@novel-runtime/ai-provider'
import { cleanJsonBlock, safeJsonParse } from '@novel-runtime/shared'
import { loadRuntimeBase, loadWorkerTask } from './runtime-loader.js'
import { callAIWithLog } from './ai-call-logger.js'

export interface OptimizedMemory {
  content: string
  originUid: string
  importance: number
  type: 'event' | 'state'
}

function generateOriginUid(chapterNumber: number): string {
  const hex = randomBytes(2).toString('hex').toUpperCase()
  return `${chapterNumber}#${hex}`
}

/**
 * 记忆优化器：每章归档后调用
 * 基于上一章全局记忆 + 本章原始记忆，生成新的全局记忆
 */
export async function optimizeMemories(
  app: FastifyInstance,
  storyId: string,
  chapterId: string,
  fromChapterNumber: number
): Promise<number> {
  const prisma = app.prisma

  // 1. 获取当前最新的全局记忆（按 originUid 去重，取每个 UID 的最新版本）
  const allGlobal = await prisma.memory.findMany({
    where: { storyId, layer: 'global' },
    orderBy: { fromChapterNumber: 'asc' }
  })

  const globalMap = new Map<string, typeof allGlobal[0]>()
  for (const m of allGlobal) {
    if (!m.originUid) continue
    const existing = globalMap.get(m.originUid)
    if (!existing || (m.fromChapterNumber || 0) > (existing.fromChapterNumber || 0)) {
      globalMap.set(m.originUid, m)
    }
  }
  const latestGlobal = Array.from(globalMap.values())

  // 2. 获取本章的原始记忆
  const rawMemories = await prisma.memory.findMany({
    where: { storyId, chapterId, layer: 'chapter' },
    orderBy: { createdAt: 'asc' }
  })

  if (latestGlobal.length === 0 && rawMemories.length === 0) {
    app.log.info('[MemoryOptimizer] No memories to optimize')
    return 0
  }

  // 区分用户手动编辑的记忆与自动提取的记忆
  const userEditedMemories = rawMemories.filter(m => {
    const tags = safeJsonParse<string[]>(m.tags, [])
    return tags.includes('user-edited')
  })
  const autoExtractedMemories = rawMemories.filter(m => !userEditedMemories.includes(m))

  // 3. 查询主角名单
  const protagonists = await prisma.character.findMany({
    where: { storyId, protagonist: true },
    select: { name: true }
  })

  // 4. 构建 Prompt（只把自动提取的记忆交给 AI 融合）
  const globalText = latestGlobal.length > 0
    ? latestGlobal.map(m => `- [${m.originUid}] (重要度${m.importance}) ${m.content}`).join('\n')
    : '暂无全局记忆'

  const rawText = autoExtractedMemories.length > 0
    ? autoExtractedMemories.map(m => `- (重要度${m.importance}) ${m.content}`).join('\n')
    : '暂无本章原始记忆'

  // 如果有用户编辑的记忆，在 prompt 中说明它们已被锁定并会单独保留
  const lockedText = userEditedMemories.length > 0
    ? `\n\n【用户已锁定的记忆】（这些记忆会在优化后原样保留，不需要 AI 重新生成）\n${userEditedMemories.map(m => `- (重要度${m.importance}) ${m.content}`).join('\n')}`
    : ''

  const prompt = `你是小说记忆优化助手。请基于【当前全局记忆】和【本章原始记忆】，生成新的全局记忆。

本故事主角：${protagonists.map(p => p.name).join('、') || '无明确主角'}

【当前全局记忆】（按事件UID去重后的最新状态）
${globalText}

【本章原始记忆】
${rawText}${lockedText}

【优化原则】
1. 状态快照：描述必须是"当前状态"，不是过程流水账
   - 流水账："许青向姜禾解释...姜禾问...许青安抚..."
   - 状态快照："姜禾拒绝向官方求助，决定暂留许青家中学习现代常识"
2. 继承UID：如果是已有事件的延续/更新，必须继承旧的originUid
3. 新UID：如果是全新事件，originUid设为"NEW"（后端会自动分配）
4. 移除过时：已经解决/完成且不再影响后续剧情的事件，可以不输出
5. 保留核心：关键设定、角色状态必须保留
6. 适当精简：单条不要太长，保留核心内容即可
7. 尊重锁定：用户已锁定的记忆不要修改或与其矛盾，优化结果应与之兼容

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

  try {
    const base = await loadRuntimeBase(storyId, prisma)
    const task = await loadWorkerTask(storyId, 'memory', prisma)

    const compiler = new RuntimePromptCompiler()
    const compiled = compiler.compile(base, task, prompt)

    const raw = await callAIWithLog(app, {
      storyId, chapterId, callType: 'memory_optimize',
      compiled, temperature: 0.3, maxTokens: 4096
    })
    if (!raw) {
      app.log.warn('[MemoryOptimizer] AI call returned empty')
      return 0
    }

    const result: { memories: OptimizedMemory[] } = JSON.parse(cleanJsonBlock(raw))
    const memories = result.memories || []

    // 5. 保存优化后的全局记忆
    for (const mem of memories) {
      let originUid = mem.originUid
      // 校验 UID：如果 AI 返回的 UID 在当前全局中不存在且不是 NEW，视为 NEW
      if (originUid !== 'NEW' && !globalMap.has(originUid)) {
        app.log.warn(`[MemoryOptimizer] Unknown originUid ${originUid}, treating as NEW`)
        originUid = 'NEW'
      }
      // NEW → 生成本章新 UID
      if (originUid === 'NEW') {
        originUid = generateOriginUid(fromChapterNumber)
      }

      await prisma.memory.create({
        data: {
          storyId,
          chapterId,
          fromChapterNumber,
          originUid,
          layer: 'global',
          content: mem.content,
          tags: JSON.stringify(['auto-extracted', mem.type === 'state' ? 'state' : 'event']),
          importance: mem.importance
        }
      })
    }

    // 6. 用户手动编辑过的记忆原样保留为全局记忆，避免被 AI 改写
    for (const mem of userEditedMemories) {
      await prisma.memory.create({
        data: {
          storyId,
          chapterId,
          fromChapterNumber,
          originUid: mem.originUid || generateOriginUid(fromChapterNumber),
          layer: 'global',
          content: mem.content,
          tags: JSON.stringify(['user-edited', 'global']),
          importance: mem.importance
        }
      })
    }

    app.log.info(`[MemoryOptimizer] Generated ${memories.length} global memories for chapter ${fromChapterNumber}, preserved ${userEditedMemories.length} user-edited memories`)
    return memories.length + userEditedMemories.length
  } catch (err: any) {
    app.log.error(`[MemoryOptimizer] Failed: ${err.message}`)
    // 失败不阻塞归档，由调用方决定是否继续
    throw err
  }
}
