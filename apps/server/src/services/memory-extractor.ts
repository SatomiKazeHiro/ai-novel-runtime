import type { FastifyInstance } from 'fastify'
import { randomBytes } from 'crypto'
import { RuntimePromptCompiler } from '@novel-runtime/ai-provider'
import { cleanJsonBlock } from '@novel-runtime/shared'
import { loadRuntimeBase, loadWorkerTask } from './runtime-loader.js'
import { callAIWithLog } from './ai-call-logger.js'
import { getEncoding } from 'js-tiktoken'

const enc = getEncoding('cl100k_base')

function tokenSet(text: string): Set<number> {
  return new Set(enc.encode(text))
}

function generateOriginUid(chapterNumber: number): string {
  const hex = randomBytes(2).toString('hex').toUpperCase()
  return `${chapterNumber}#${hex}`
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

export interface ExtractedEvent {
  description: string    // 简洁描述"有什么人做了什么"
  participants: string[] // 参与该事件的所有角色
  importance: number     // 事件在本章的重要性（4~7），主角参与时 AI 自行 +1，最终 5~8
}

export interface MemoryExtractionResult {
  mainEvents: ExtractedEvent[]  // 主要事件（importance >= 8 或剧情核心）
  sideEvents: ExtractedEvent[]  // 次要事件
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

  // 查询本故事的主角名单
  const protagonists = await prisma.character.findMany({
    where: { storyId, protagonist: true },
    select: { name: true }
  })
  const protagonistNames = protagonists.map(p => p.name)

  // 加载 Runtime Base + Memory Worker Task
  const base = await loadRuntimeBase(storyId, prisma)
  const task = await loadWorkerTask(storyId, 'memory', prisma)

  const extractPrompt = `请分析以下小说章节，提取关键信息并以严格 JSON 格式返回。不要返回 markdown 代码块，不要返回任何解释文字，只返回纯 JSON 对象。

本故事主角：${protagonistNames.join('、') || '无明确主角'}

提取原则：
1. 【事件结构化】每条事件必须明确：有什么人做了什么，还有哪些角色参与。
2. 【重要性自评】根据事件在本章的篇幅占比和剧情推动作用，为每条事件评定 importance（4~7）。
3. 【主角加成】如果事件有主角参与，请在 importance 基础上自行 +1，最终 importance 范围为 5~8。
4. 【去重过滤】只提取对剧情有实质推动作用的事件，路人提及、环境描写、过渡段落不要提取。

importance 评分标准：
- 7: 本章核心转折/高潮，占大量篇幅
- 6: 重要推进，占中等篇幅
- 5: 有一定作用，占少量篇幅
- 4: 过渡/铺垫，篇幅很短

主角参与且最终达到 8 分的事件视为"主要事件"，放入 mainEvents；其他放入 sideEvents。

**重要：mainEvents 和 sideEvents 数组的顺序必须和事件在文章中的出现顺序完全一致，不能打乱，更不能把结尾的事件放到数组开头。**

要求提取以下字段：
- mainEvents: 主要事件（对象数组，每个对象包含 description / participants / importance）
- sideEvents: 次要事件（对象数组，格式同上）
- emotions: 主要角色的情绪变化（字符串数组）
- foreshadowing: 新埋下的伏笔（字符串数组）
- relationshipChanges: 角色关系变化（字符串数组）
- characterStatusChanges: 角色状态变化（对象，如 {"张三": {"rank": "初级", "location": "北京"}}}）
- timelineDay: 本章发生在第几天（数字，不确定则返回 null）
- summary: 本章一句话摘要（50字以内）
- scenes: 场景记忆数组（见下方说明）

事件格式示例：
{
  "description": "许青向姜禾解释现代社会的身份制度和法律危险",
  "participants": ["许青", "姜禾"],
  "importance": 6
}

【场景记忆 scenes 提取规则】
- 只提取"推动剧情发展的地点"或"承担主要事件的地点"
- 路人提及、一笔带过、无事件发生的地点不要提取
- 同一地点在本章多次出现，只提取一次
- 场景描写（description）如果章节中有详细描写则提取，否则可省略

scenes 格式：
[{ "location": "光明顶", "description": "海拔极高，常年云雾缭绕", "event": "六大门派围攻明教总坛", "importance": 9 }]

场景 importance 标准：
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
  fromChapterNumber?: number
) {
  const prisma = app.prisma
  const chNum = fromChapterNumber ?? 0

  // 预加载最近 50 条记忆用于去重
  const recentMemories = await prisma.memory.findMany({
    where: { storyId },
    orderBy: { createdAt: 'desc' },
    take: 50,
    select: { content: true }
  })
  let recentSets = recentMemories.map(m => tokenSet(m.content))
  let skipped = 0

  async function saveIfUnique(content: string, layer: string, tags: string[], importance: number, originUid?: string) {
    if (await checkDuplicateMemory(prisma, storyId, content, recentSets)) {
      skipped++
      return
    }
    await prisma.memory.create({
      data: { storyId, chapterId, fromChapterNumber: chNum, layer, content, tags: JSON.stringify(tags), importance, originUid }
    })
    recentSets.unshift(tokenSet(content))
    if (recentSets.length > 50) recentSets.pop()
  }

  // 1. 保存主要事件记忆
  for (const event of result.mainEvents || []) {
    const content = `${event.description} | 参与者：${event.participants.join('、')}`
    const originUid = generateOriginUid(chNum)
    await saveIfUnique(content, 'chapter', ['auto-extracted', 'main-plot'], event.importance, originUid)
  }

  // 2. 保存次要事件记忆
  for (const event of result.sideEvents || []) {
    const content = `${event.description} | 参与者：${event.participants.join('、')}`
    const originUid = generateOriginUid(chNum)
    await saveIfUnique(content, 'chapter', ['auto-extracted'], event.importance, originUid)
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

  // 5. 保存全局记忆（角色状态变化）+ 同步更新 CharacterBranchState（历史快照模式）
  for (const [charName, changes] of Object.entries(result.characterStatusChanges || {})) {
    // 5a. 保存到记忆表
    await saveIfUnique(
      `【${charName}】状态更新：${JSON.stringify(changes)}`,
      'global',
      ['auto-extracted', 'character-status'],
      8
    )

    // 5b. 插入新的 CharacterBranchState 历史记录
    try {
      const character = await prisma.character.findFirst({
        where: { storyId, name: charName }
      })
      if (character) {
        const latestState = await prisma.characterBranchState.findFirst({
          where: { characterId: character.id },
          orderBy: { fromChapterNumber: 'desc' }
        })
        const currentStatus = latestState ? JSON.parse(latestState.status || '{}') : {}
        const mergedStatus = { ...currentStatus, ...changes }
        const currentRelationships = latestState ? JSON.parse(latestState.relationships || '{}') : {}
        await prisma.characterBranchState.create({
          data: {
            characterId: character.id,
            fromChapterNumber: chNum,
            status: JSON.stringify(mergedStatus),
            relationships: JSON.stringify(currentRelationships)
          }
        })
        app.log.info(`[MemoryExtractor] Updated character status: ${charName} [第${chNum}章] -> ${JSON.stringify(changes)}`)
      }
    } catch (err: any) {
      app.log.warn(`[MemoryExtractor] Failed to update character status for ${charName}: ${err.message}`)
    }
  }

  // 6. 更新时间线
  if (result.timelineDay && typeof result.timelineDay === 'number') {
    const existing = await prisma.timelineEvent.findUnique({
      where: { storyId_day: { storyId, day: result.timelineDay } }
    })

    const dayEvents = (result.mainEvents || []).map(e => e.description)
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
          fromChapterNumber: chNum,
          day: result.timelineDay,
          events: JSON.stringify(dayEvents)
        }
      })
    }
    app.log.info(`[MemoryExtractor] Timeline updated: Day ${result.timelineDay}`)
  }

  // 7. 更新章节摘要
  if (result.summary) {
    await prisma.chapter.update({
      where: { id: chapterId },
      data: { summary: result.summary }
    })
  }

  // 8. 记忆压缩已废弃，由 memory-optimizer 替代
  app.log.info(`[MemoryExtractor] Skipped compression (replaced by memory-optimizer)`)

  app.log.info(`[MemoryExtractor] Saved memories and synced character status`)
}
