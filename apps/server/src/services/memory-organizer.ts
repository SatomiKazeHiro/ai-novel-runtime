import type { FastifyInstance } from 'fastify'
import { RuntimePromptCompiler } from '@novel-runtime/ai-provider'
import { cleanJsonBlock } from '@novel-runtime/shared'
import { getEncoding } from 'js-tiktoken'
import { loadRuntimeBase, loadWorkerTask } from './runtime-loader.js'
import { callAIWithLog } from './ai-call-logger.js'

const enc = getEncoding('cl100k_base')

interface OrganizeAction {
  action: 'merge' | 'update' | 'delete' | 'keep'
  targetIds: string[]
  sourceIds?: string[]
  newContent?: string
  newImportance?: number
  reason: string
}

interface OrganizeResult {
  actions: OrganizeAction[]
}

function tokenSet(text: string): Set<number> {
  return new Set(enc.encode(text))
}

function jaccardSimilarity(a: Set<number>, b: Set<number>): number {
  if (a.size === 0 || b.size === 0) return 0
  const intersection = new Set([...a].filter(x => b.has(x)))
  const union = new Set([...a, ...b])
  return intersection.size / union.size
}

function calculateAverageJaccard(contents: string[]): number {
  const sets = contents.map(c => tokenSet(c))
  let total = 0, count = 0
  for (let i = 0; i < sets.length; i++) {
    for (let j = i + 1; j < sets.length; j++) {
      total += jaccardSimilarity(sets[i], sets[j])
      count++
    }
  }
  return count > 0 ? total / count : 0
}

/**
 * AI 记忆整理器：在 archive 后对增量记忆做语义层面的合并/更新/删除
 * - 只处理本章新提取的记忆 + 最近 20 条相关旧记忆
 * - 保守执行：merge 要求 Jaccard > 0.5（防止 AI 误判），delete 只删明确标记为 duplicate 的
 */
export async function organizeMemoriesAfterArchive(
  app: FastifyInstance,
  storyId: string,
  chapterId: string
): Promise<{ merged: number; updated: number; deleted: number }> {
  const prisma = app.prisma

  // 1. 获取本章新提取的记忆
  const newMemories = await prisma.memory.findMany({
    where: { storyId, chapterId },
    orderBy: { importance: 'desc' }
  })
  if (newMemories.length === 0) return { merged: 0, updated: 0, deleted: 0 }

  // 2. 获取可能相关的旧记忆（最近 20 条重要性 >= 5 的）
  const oldMemories = await prisma.memory.findMany({
    where: { storyId, NOT: { chapterId }, importance: { gte: 5 } },
    orderBy: { createdAt: 'desc' },
    take: 20
  })
  if (oldMemories.length === 0) return { merged: 0, updated: 0, deleted: 0 }

  app.log.info(`[MemoryOrganizer] Analyzing ${newMemories.length} new vs ${oldMemories.length} old memories`)

  // 3. 构造整理 Prompt
  const oldText = oldMemories.map((m, i) =>
    `old-${i + 1} [${m.layer}·重要性${m.importance}] ${m.content}`
  ).join('\n')

  const newText = newMemories.map((m, i) =>
    `new-${i + 1} [${m.layer}·重要性${m.importance}] ${m.content}`
  ).join('\n')

  const organizePrompt = `你是小说记忆整理助手。请分析以下新旧记忆的关系，给出整理建议。

【整理原则】
- merge（合并）：多条记忆描述同一事件/状态的不同侧面，应合并为一条更完整、更精炼的描述。合并后保留最高重要性。
- update（更新）：新记忆覆盖/更新了旧记忆中的部分信息（如角色状态变化、地点变更），应更新旧记忆的内容。
- delete（删除）：新记忆与某条旧记忆完全重复，或旧记忆已被新信息明确覆盖且不再有价值，建议删除。
- keep（保留）：独立信息，无需处理。

【安全规则】
- 不同角色的事件绝不合并
- 不同时间点的独立事件绝不合并
- 只有当新旧记忆明显描述同一主题时才允许 merge/update

【已有记忆（旧）】
${oldText}

【新记忆】
${newText}

返回严格 JSON，不要 markdown：
{
  "actions": [
    {"action": "merge", "targetIds": ["old-1"], "sourceIds": ["new-2"], "newContent": "合并后的内容", "newImportance": 9, "reason": "同一事件的不同描述"},
    {"action": "update", "targetIds": ["old-3"], "sourceIds": ["new-1"], "newContent": "更新后的内容", "newImportance": 8, "reason": "状态已变更"},
    {"action": "delete", "targetIds": ["old-5"], "reason": "被新记忆完全覆盖"},
    {"action": "keep", "targetIds": ["new-4"], "reason": "独立事件"}
  ]
}

注意：
- targetIds 和 sourceIds 使用列表中的编号（如 "old-1", "new-2"）
- 不要对 global 层的角色状态更新做 delete，只做 update
- 如果无法确定关系，一律返回 keep`

  try {
    const base = await loadRuntimeBase(storyId, prisma)
    const task = await loadWorkerTask(storyId, 'memory', prisma)

    const compiler = new RuntimePromptCompiler()
    const compiled = compiler.compile(base, task, organizePrompt)

    const raw = await callAIWithLog(app, {
      storyId, chapterId, callType: 'memory_organize',
      compiled, temperature: 0.2, maxTokens: 4096
    })
    if (!raw) return { merged: 0, updated: 0, deleted: 0 }

    const result: OrganizeResult = JSON.parse(cleanJsonBlock(raw))

    let merged = 0, updated = 0, deleted = 0

    for (const action of result.actions || []) {
      try {
        // 解析编号为实际 ID
        const targetIds = (action.targetIds || [])
          .map((id: string) => {
            const match = id.match(/^old-(\d+)$/)
            if (match) return oldMemories[parseInt(match[1]) - 1]?.id
            return null
          })
          .filter(Boolean) as string[]

        const sourceIds = (action.sourceIds || [])
          .map((id: string) => {
            const match = id.match(/^new-(\d+)$/)
            if (match) return newMemories[parseInt(match[1]) - 1]?.id
            return null
          })
          .filter(Boolean) as string[]

        if (targetIds.length === 0) continue

        if (action.action === 'merge' && action.newContent) {
          // 保守校验：被合并的记忆之间 Jaccard 应 > 0.5
          const targetContents = targetIds.map(id =>
            oldMemories.find(m => m.id === id)?.content || ''
          )
          const sourceContents = sourceIds.map(id =>
            newMemories.find(m => m.id === id)?.content || ''
          )
          const allContents = [...targetContents, ...sourceContents]
          if (allContents.length >= 2) {
            const avgSim = calculateAverageJaccard(allContents)
            if (avgSim < 0.5) {
              app.log.warn(`[MemoryOrganizer] Skip merge: avg Jaccard ${avgSim.toFixed(2)} < 0.5`)
              continue
            }
          }

          // 保留第一条，更新内容，删除其余
          const keepId = targetIds[0]
          await prisma.memory.update({
            where: { id: keepId },
            data: {
              content: action.newContent,
              importance: action.newImportance || 8
            }
          })
          const deleteIds = [...targetIds.slice(1), ...sourceIds].filter(id => id !== keepId)
          for (const id of deleteIds) {
            await prisma.memory.delete({ where: { id } }).catch(() => {})
          }
          merged++
          app.log.info(`[MemoryOrganizer] Merged ${allContents.length} memories into: ${action.newContent.slice(0, 50)}`)
        }

        else if (action.action === 'update' && action.newContent) {
          await prisma.memory.update({
            where: { id: targetIds[0] },
            data: {
              content: action.newContent,
              importance: action.newImportance || 8
            }
          })
          updated++
          app.log.info(`[MemoryOrganizer] Updated memory: ${action.newContent.slice(0, 50)}`)
        }

        else if (action.action === 'delete') {
          // 保守策略：只删除旧记忆，不删新记忆（新记忆是刚提取的）
          for (const id of targetIds) {
            await prisma.memory.delete({ where: { id } }).catch(() => {})
          }
          deleted += targetIds.length
          app.log.info(`[MemoryOrganizer] Deleted ${targetIds.length} outdated memories`)
        }
      } catch (err: any) {
        app.log.error(`[MemoryOrganizer] Action failed: ${err.message}`)
      }
    }

    app.log.info(`[MemoryOrganizer] Done: merged=${merged}, updated=${updated}, deleted=${deleted}`)
    return { merged, updated, deleted }
  } catch (err: any) {
    app.log.error(`[MemoryOrganizer] Failed: ${err.message}`)
    return { merged: 0, updated: 0, deleted: 0 }
  }
}
