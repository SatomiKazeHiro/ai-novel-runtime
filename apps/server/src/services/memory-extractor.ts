import type { FastifyInstance } from 'fastify'
import { RuntimePromptCompiler } from '@novel-runtime/ai-provider'
import { cleanJsonBlock } from '@novel-runtime/shared'
import { loadRuntimeBase, loadWorkerTask } from './runtime-loader.js'
import { callAIWithLog } from './ai-call-logger.js'
import { maybeCompressMemories } from './memory-compressor.js'
import { getEncoding } from 'js-tiktoken'

const enc = getEncoding('cl100k_base')

function tokenSet(text: string): Set<number> {
  return new Set(enc.encode(text))
}

function jaccardSimilarity(a: Set<number>, b: Set<number>): number {
  if (a.size === 0 || b.size === 0) return 0
  const intersection = new Set([...a].filter(x => b.has(x)))
  const union = new Set([...a, ...b])
  return intersection.size / union.size
}

/**
 * 检查新记忆是否与最近已有记忆近似重复（Jaccard > 0.82）
 */
async function checkDuplicateMemory(
  prisma: any,
  storyId: string,
  content: string,
  recentSets: Set<number>[],
  threshold = 0.82
): Promise<boolean> {
  const newSet = tokenSet(content)
  return recentSets.some(rs => jaccardSimilarity(newSet, rs) >= threshold)
}

export interface SceneMemory {
  location: string      // 地点名称
  description?: string  // 场景描写（可选）
  event: string         // 该地点发生的主要事件概括
  importance?: number   // AI 判断的重要性 1-10，默认 7
}

export interface MemoryExtractionResult {
  mainEvents: string[]        // 主线事件（重要剧情推进）
  sideEvents: string[]        // 支线/旁支事件
  emotions: string[]
  foreshadowing: string[]
  relationshipChanges: string[]
  characterStatusChanges: Record<string, Record<string, string>>
  timelineDay: number | null
  summary: string
  scenes: SceneMemory[]       // 推动剧情发展的地点/场景
}

export async function extractMemoryFromChapter(
  app: FastifyInstance,
  chapterId: string,
  storyId: string,
  content: string
): Promise<MemoryExtractionResult | null> {
  const prisma = app.prisma

  // 加载 Runtime Base + Memory Worker Task
  const base = await loadRuntimeBase(storyId, prisma)
  const task = await loadWorkerTask(storyId, 'memory', prisma)

  const extractPrompt = `请分析以下小说章节，提取关键信息并以严格 JSON 格式返回。不要返回 markdown 代码块，不要返回任何解释文字，只返回纯 JSON 对象。

提取原则：
1. 【主线事件合并】同一主线剧情链上的连续事件应合并为一个整体事件描述，不要拆分。
2. 【支线独立】与主线并行的独立支线作为独立条目。
3. 【去重过滤】只提取对剧情有实质推动作用的事件，路人提及、环境描写、过渡段落不要提取。

要求提取以下字段：
- mainEvents: 主线事件（字符串数组）
- sideEvents: 支线/旁支事件（字符串数组）
- emotions: 主要角色的情绪变化（字符串数组）
- foreshadowing: 新埋下的伏笔（字符串数组）
- relationshipChanges: 角色关系变化（字符串数组）
- characterStatusChanges: 角色状态变化（对象，如 {"张三": {"rank": "初级", "location": "北京"}}）
- timelineDay: 本章发生在第几天（数字，不确定则返回 null）
- summary: 本章一句话摘要（50字以内）
- scenes: 场景记忆数组（见下方说明）

【场景记忆 scenes 提取规则】
- 只提取"推动剧情发展的地点"或"承担主要事件的地点"
- 路人提及、一笔带过、无事件发生的地点不要提取
- 同一地点在本章多次出现，只提取一次
- 场景描写（description）如果章节中有详细描写则提取，否则可省略

scenes 格式：
[{ "location": "光明顶", "description": "海拔极高，常年云雾缭绕", "event": "六大门派围攻明教总坛", "importance": 9 }]

importance 标准：
- 7-10：核心剧情地点（决战、关键转折、贯穿全书的场所）
- 4-6：有一定事件发生的地点
- 1-3：路人提及、一笔带过、无实质事件

章节内容如下：
${content.slice(0, 8000)}`

  app.log.info(`[MemoryExtractor] Calling AI for chapter ${chapterId}`)

  try {
    const compiler = new RuntimePromptCompiler()
    const compiled = compiler.compile(base, task, extractPrompt)

    const raw = await callAIWithLog(app, {
      storyId, chapterId, callType: 'memory_extract',
      compiled, temperature: 0.3, maxTokens: 2048
    })
    if (!raw) return null

    const result: MemoryExtractionResult = JSON.parse(cleanJsonBlock(raw))

    const totalEvents = (result.mainEvents?.length || 0) + (result.sideEvents?.length || 0)
    app.log.info(`[MemoryExtractor] Extracted: ${totalEvents} events (${result.mainEvents?.length || 0} main, ${result.sideEvents?.length || 0} side), day=${result.timelineDay}`)
    return result
  } catch (err: any) {
    app.log.error(`[MemoryExtractor] Failed: ${err.message}`)
    return null
  }
}

export async function saveExtractedMemory(
  app: FastifyInstance,
  chapterId: string,
  storyId: string,
  result: MemoryExtractionResult,
  versionBranchId?: string
) {
  const prisma = app.prisma
  const vbId = versionBranchId ?? ''

  // 预加载最近 50 条记忆用于去重（同分支）
  const recentMemories = await prisma.memory.findMany({
    where: { storyId, versionBranchId: vbId },
    orderBy: { createdAt: 'desc' },
    take: 50,
    select: { content: true }
  })
  let recentSets = recentMemories.map(m => tokenSet(m.content))
  let skipped = 0

  async function saveIfUnique(content: string, layer: string, tags: string[], importance: number) {
    if (await checkDuplicateMemory(prisma, storyId, content, recentSets)) {
      skipped++
      return
    }
    await prisma.memory.create({
      data: { storyId, chapterId, versionBranchId: vbId, layer, content, tags: JSON.stringify(tags), importance }
    })
    recentSets.unshift(tokenSet(content))
    if (recentSets.length > 50) recentSets.pop()
  }

  // 1. 保存主线事件记忆（高重要性）
  for (const event of result.mainEvents || []) {
    await saveIfUnique(`主线：${event}`, 'chapter', ['auto-extracted', 'main-plot'], 9)
  }

  // 2. 保存支线事件记忆（中等重要性）
  for (const event of result.sideEvents || []) {
    await saveIfUnique(`支线：${event}`, 'chapter', ['auto-extracted', 'side-plot'], 6)
  }

  // 3. 保存情绪/伏笔/关系变化
  const otherMemories: string[] = []
  if (result.emotions?.length) otherMemories.push(...result.emotions.map(e => `情绪：${e}`))
  if (result.foreshadowing?.length) otherMemories.push(...result.foreshadowing.map(e => `伏笔：${e}`))
  if (result.relationshipChanges?.length) otherMemories.push(...result.relationshipChanges.map(e => `关系：${e}`))

  for (const mem of otherMemories) {
    await saveIfUnique(mem, 'chapter', ['auto-extracted'], 5)
  }

  // 4. 保存场景记忆（推动剧情发展的地点）
  for (const scene of result.scenes || []) {
    const sceneContent = scene.description
      ? `【${scene.location}】${scene.description} | 事件：${scene.event}`
      : `【${scene.location}】事件：${scene.event}`
    await saveIfUnique(sceneContent, 'scene', ['auto-extracted', 'scene-memory'], scene.importance ?? 7)
  }

  // 5. 保存全局记忆（角色状态变化）+ 同步更新 Character 表
  for (const [charName, changes] of Object.entries(result.characterStatusChanges || {})) {
    // 4a. 保存到记忆表
    await saveIfUnique(
      `【${charName}】状态更新：${JSON.stringify(changes)}`,
      'global',
      ['auto-extracted', 'character-status'],
      8
    )

    // 4b. 同步更新 CharacterBranchState 的 status 字段（按分支隔离）
    try {
      const character = await prisma.character.findFirst({
        where: { storyId, name: charName }
      })
      if (character) {
        const branchState = await prisma.characterBranchState.findUnique({
          where: { characterId_versionBranchId: { characterId: character.id, versionBranchId: vbId } }
        })
        if (branchState) {
          const currentStatus = JSON.parse(branchState.status || '{}')
          const mergedStatus = { ...currentStatus, ...changes }
          await prisma.characterBranchState.update({
            where: { id: branchState.id },
            data: { status: JSON.stringify(mergedStatus) }
          })
        } else {
          await prisma.characterBranchState.create({
            data: {
              characterId: character.id,
              versionBranchId: vbId,
              status: JSON.stringify(changes),
              relationships: '{}'
            }
          })
        }
        app.log.info(`[MemoryExtractor] Updated character status: ${charName} [${vbId}] -> ${JSON.stringify(changes)}`)
      }
    } catch (err: any) {
      app.log.warn(`[MemoryExtractor] Failed to update character status for ${charName}: ${err.message}`)
    }
  }

  // 6. 更新时间线（按分支隔离）
  if (result.timelineDay && typeof result.timelineDay === 'number') {
    const existing = await prisma.timelineEvent.findUnique({
      where: { storyId_versionBranchId_day: { storyId, versionBranchId: vbId, day: result.timelineDay } }
    })

    const dayEvents = [...(result.mainEvents || [])]
    if (existing) {
      const oldEvents = JSON.parse(existing.events || '[]')
      await prisma.timelineEvent.update({
        where: { id: existing.id },
        data: { events: JSON.stringify([...oldEvents, ...dayEvents]) }
      })
    } else {
      await prisma.timelineEvent.create({
        data: {
          storyId,
          versionBranchId: vbId,
          day: result.timelineDay,
          events: JSON.stringify(dayEvents)
        }
      })
    }
    app.log.info(`[MemoryExtractor] Timeline updated: Day ${result.timelineDay} [${vbId}]`)
  }

  // 7. 更新章节摘要
  if (result.summary) {
    await prisma.chapter.update({
      where: { id: chapterId },
      data: { summary: result.summary }
    })
  }

  // 8. 触发记忆压缩（每 5 章自动压缩一次）
  try {
    await maybeCompressMemories(app, storyId)
  } catch (err: any) {
    app.log.error(`[MemoryExtractor] Compression check failed: ${err.message}`)
  }

  app.log.info(`[MemoryExtractor] Saved memories and synced character status`)
}
