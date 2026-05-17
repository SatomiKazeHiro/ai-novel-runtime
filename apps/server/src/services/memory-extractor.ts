import type { FastifyInstance } from 'fastify'
import { createProvider, RuntimePromptCompiler } from '@novel-runtime/ai-provider'
import { loadRuntimeBase, loadWorkerTask } from './runtime-loader.js'
import { maybeCompressMemories } from './memory-compressor.js'

export interface MemoryExtractionResult {
  mainEvents: string[]        // 主线事件（重要剧情推进）
  sideEvents: string[]        // 支线/旁支事件
  emotions: string[]
  foreshadowing: string[]
  relationshipChanges: string[]
  characterStatusChanges: Record<string, Record<string, string>>
  timelineDay: number | null
  summary: string
}

export async function extractMemoryFromChapter(
  app: FastifyInstance,
  chapterId: string,
  storyId: string,
  content: string
): Promise<MemoryExtractionResult | null> {
  const prisma = app.prisma

  const aiConfig = await prisma.aiProviderConfig.findFirst({ where: { isDefault: true } })
  const provider = aiConfig
    ? createProvider({
        name: aiConfig.name,
        apiKey: aiConfig.apiKey || undefined,
        baseUrl: aiConfig.baseUrl || undefined,
        model: aiConfig.model,
        maxTokens: aiConfig.maxTokens,
        temperature: aiConfig.temperature
      })
    : null

  if (!provider?.generateWithRuntime) {
    app.log.warn('[MemoryExtractor] No provider configured, skipping memory extraction')
    return null
  }

  // 加载 Runtime Base + Memory Worker Task
  const base = await loadRuntimeBase(storyId, prisma)
  const task = await loadWorkerTask(storyId, 'memory', prisma)

  const extractPrompt = `请分析以下玄幻修仙小说章节，提取关键信息并以严格 JSON 格式返回。不要返回 markdown 代码块，不要返回任何解释文字，只返回纯 JSON 对象。

提取原则：
1. 【主线事件合并】同一主线剧情链上的连续事件应合并为一个整体事件描述，不要拆分。例如"明教内部分裂→成昆偷袭→六大门派围攻→张无忌出手化解"应合并为一条主线事件。
2. 【支线独立】与主线并行的独立支线（如第三方势力暗中观察、配角个人线）作为独立条目。
3. 【去重过滤】只提取对剧情有实质推动作用的事件，路人提及、环境描写、过渡段落不要提取。

要求提取以下字段：
- mainEvents: 主线事件（字符串数组，每个元素是一段完整的主线剧情描述）
- sideEvents: 支线/旁支事件（字符串数组）
- emotions: 主要角色的情绪变化（字符串数组）
- foreshadowing: 新埋下的伏笔（字符串数组）
- relationshipChanges: 角色关系变化（字符串数组）
- characterStatusChanges: 角色状态变化（对象，如 {"林凡": {"realm": "筑基", "location": "后山"}}）
- timelineDay: 本章发生在第几天（数字，不确定则返回 null）
- summary: 本章一句话摘要（50字以内，概括主线进展）

章节内容如下：
${content.slice(0, 8000)}`

  app.log.info(`[MemoryExtractor] Calling AI for chapter ${chapterId}`)

  try {
    const compiler = new RuntimePromptCompiler()
    const compiled = compiler.compile(base, task, extractPrompt)

    const raw = await provider.generateWithRuntime(compiled, {
      temperature: 0.3,
      maxTokens: 2048
    })

    const jsonStr = raw.replace(/```json\s*/g, '').replace(/```\s*$/g, '').trim()
    const result: MemoryExtractionResult = JSON.parse(jsonStr)

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
  result: MemoryExtractionResult
) {
  const prisma = app.prisma

  // 1. 保存主线事件记忆（高重要性）
  for (const event of result.mainEvents || []) {
    await prisma.memory.create({
      data: {
        storyId,
        chapterId,
        layer: 'chapter',
        content: `主线：${event}`,
        tags: JSON.stringify(['auto-extracted', 'main-plot']),
        importance: 9
      }
    })
  }

  // 2. 保存支线事件记忆（中等重要性）
  for (const event of result.sideEvents || []) {
    await prisma.memory.create({
      data: {
        storyId,
        chapterId,
        layer: 'chapter',
        content: `支线：${event}`,
        tags: JSON.stringify(['auto-extracted', 'side-plot']),
        importance: 6
      }
    })
  }

  // 3. 保存情绪/伏笔/关系变化
  const otherMemories: string[] = []
  if (result.emotions?.length) otherMemories.push(...result.emotions.map(e => `情绪：${e}`))
  if (result.foreshadowing?.length) otherMemories.push(...result.foreshadowing.map(e => `伏笔：${e}`))
  if (result.relationshipChanges?.length) otherMemories.push(...result.relationshipChanges.map(e => `关系：${e}`))

  for (const mem of otherMemories) {
    await prisma.memory.create({
      data: {
        storyId,
        chapterId,
        layer: 'chapter',
        content: mem,
        tags: JSON.stringify(['auto-extracted']),
        importance: 5
      }
    })
  }

  // 4. 保存全局记忆（角色状态变化）+ 同步更新 Character 表
  for (const [charName, changes] of Object.entries(result.characterStatusChanges || {})) {
    // 4a. 保存到记忆表
    await prisma.memory.create({
      data: {
        storyId,
        layer: 'global',
        content: `【${charName}】状态更新：${JSON.stringify(changes)}`,
        tags: JSON.stringify(['auto-extracted', 'character-status']),
        importance: 8
      }
    })

    // 4b. 同步更新 Character 表的 status 字段
    try {
      const character = await prisma.character.findFirst({
        where: { storyId, name: charName }
      })
      if (character) {
        const currentStatus = JSON.parse(character.status || '{}')
        const mergedStatus = { ...currentStatus, ...changes }
        await prisma.character.update({
          where: { id: character.id },
          data: { status: JSON.stringify(mergedStatus) }
        })
        app.log.info(`[MemoryExtractor] Updated character status: ${charName} -> ${JSON.stringify(mergedStatus)}`)
      }
    } catch (err: any) {
      app.log.warn(`[MemoryExtractor] Failed to update character status for ${charName}: ${err.message}`)
    }
  }

  // 5. 更新时间线
  if (result.timelineDay && typeof result.timelineDay === 'number') {
    const existing = await prisma.timelineEvent.findUnique({
      where: { storyId_day: { storyId, day: result.timelineDay } }
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
          day: result.timelineDay,
          events: JSON.stringify(dayEvents)
        }
      })
    }
    app.log.info(`[MemoryExtractor] Timeline updated: Day ${result.timelineDay}`)
  }

  // 6. 更新章节摘要
  if (result.summary) {
    await prisma.chapter.update({
      where: { id: chapterId },
      data: { summary: result.summary }
    })
  }

  // 7. 触发记忆压缩（每 5 章自动压缩一次）
  try {
    await maybeCompressMemories(app, storyId)
  } catch (err: any) {
    app.log.error(`[MemoryExtractor] Compression check failed: ${err.message}`)
  }

  app.log.info(`[MemoryExtractor] Saved memories and synced character status`)
}
