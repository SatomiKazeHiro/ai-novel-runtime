import type { FastifyInstance } from 'fastify'
import { randomBytes } from 'crypto'
import { RuntimePromptCompiler } from '@novel-runtime/ai-provider'
import {
  cleanJsonBlock,
  tokenSet,
  jaccardSimilarity,
  safeJsonParse,
  validateTimelinePosition
} from '@novel-runtime/shared'
import { loadRuntimeBase, loadWorkerTask } from './runtime-loader.js'
import { callAIWithLog } from './ai-call-logger.js'

function generateOriginUid(chapterNumber: number): string {
  const hex = randomBytes(2).toString('hex').toUpperCase()
  return `${chapterNumber}#${hex}`
}

/**
 * 把 AI 返回的 importance 数字夹到 [1, 10] 合法范围。
 * AI 偶尔返回 -1 / 0 / 11 / NaN 等非法值, 写库前必须兜底, 否则 DB 出现非法 importance
 * 会污染 memory-engine 的评分排序。
 *
 * 边界策略:
 *   - < 1 / NaN / 非 number → 5 (prompt 约定默认值)
 *   - > 10 → 10 (上限截断)
 *   - 合法范围 [1, 10] → 保留原值 (Math.floor 防止小数)
 *
 * 纯函数: 不写日志, 不读 DB, 不依赖 Fastify。便于单测。
 */
function sanitizeImportance(raw: unknown): number {
  if (typeof raw !== 'number' || isNaN(raw)) {
    return 5
  }
  if (raw < 1) {
    return 5
  }
  if (raw > 10) {
    return 10
  }
  return Math.floor(raw)
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
  timelinePosition: number | null
  summary: string
  scenes: SceneMemory[]       // 推动剧情发展的地点/场景
  // 章内不同时间点的事件 (AI 可能漏字段, 可选)
  timelineEvents?: Array<{ position: number | null; description: string }>
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

importance 评分标准（必须返回 4-8 范围的整数）：
- 7: 本章核心转折/高潮，占大量篇幅
- 6: 重要推进，占中等篇幅
- 5: 有一定作用，占少量篇幅
- 4: 过渡/铺垫，篇幅很短
- 8: 主角参与 + 重要性 7 时（主角加成上限），可达 8

主角参与的事件，自行 +1（4 → 5、5 → 6、6 → 7、7 → 8）；最终 importance 必须在 5~8 范围。

主角参与且最终达到 8 分的事件视为"主要事件"，放入 mainEvents；其他放入 sideEvents。

**重要：mainEvents 和 sideEvents 数组的顺序必须和事件在文章中的出现顺序完全一致，不能打乱，更不能把结尾的事件放到数组开头。**

要求提取以下字段：
- mainEvents: 主要事件（对象数组，每个对象包含 description / participants / importance）
- sideEvents: 次要事件（对象数组，格式同上）
- emotions: 主要角色的情绪变化（字符串数组）
- foreshadowing: 新埋下的伏笔（字符串数组）
- relationshipChanges: 角色关系变化（字符串数组）
- characterStatusChanges: 角色状态变化（对象，如 {"张三": {"rank": "初级", "location": "北京", "relationships": {"李四": "兄弟", "王五": "敌对"}}}）。其中 relationships 子键可选，用于表达该角色与其他角色的关系变化。
- timelinePosition: 本章开篇时间锚点 (Y.DDDHH 实数编码, 能确定则返回数字, 完全无法判断则返回 null; 不要用 -1 / 0 作为占位符)。编码规则: 整数位 = 年 (负号代表纪元前), 小数位 5 位 DDDHH (年内第 1-365 天 + 0-23 时)。例: 1.00106 = 第1年第1天 06时; -2.05018 = 前2年第50天 18时
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
    app.log.info(`[MemoryExtractor] Extracted: ${totalEvents} events (${result.mainEvents?.length || 0} main, ${result.sideEvents?.length || 0} side), position=${result.timelinePosition}, timelineEvents=${result.timelineEvents?.length || 0}`)
    return result
  } catch (err: any) {
    app.log.error(`[MemoryExtractor] Failed: ${err.message}`)
    return null
  }
}

export interface MemoryWrite {
  storyId: string
  chapterId: string
  fromChapterNumber: number
  layer: string
  content: string
  tags: string
  importance: number
  originUid?: string
}

export interface CharacterStateWrite {
  characterId: string
  fromChapterNumber: number
  status: string
  relationships: string
}

export interface TimelineEventWrite {
  storyId: string
  fromChapterNumber: number
  position: number
  events: string
}

export interface ArchiveMemoryData {
  memories: MemoryWrite[]
  characterStates: CharacterStateWrite[]
  timelineEvents: TimelineEventWrite[]
  summary: string | null
  timelinePosition: number | null
}

/**
 * 准备待写入的记忆数据（纯数据准备，不写入数据库）
 * 返回的数据后续需要在事务中统一提交
 */
export function prepareMemoryWrites(
  storyId: string,
  chapterId: string,
  result: MemoryExtractionResult,
  fromChapterNumber?: number
): ArchiveMemoryData {
  const chNum = fromChapterNumber ?? 0
  const memories: MemoryWrite[] = []
  const characterStates: CharacterStateWrite[] = []
  let timelineEvents: TimelineEventWrite[] = []
  let summary: string | null = null
  let timelinePosition: number | null = null

  // 1. 主要事件记忆
  for (const event of result.mainEvents || []) {
    const content = `${event.description} | 参与者：${event.participants.join('、')}`
    const originUid = generateOriginUid(chNum)
    memories.push({ storyId, chapterId, fromChapterNumber: chNum, layer: 'chapter', content, tags: JSON.stringify(['auto-extracted', 'main-plot']), importance: sanitizeImportance(event.importance), originUid })
  }

  // 2. 次要事件记忆
  for (const event of result.sideEvents || []) {
    const content = `${event.description} | 参与者：${event.participants.join('、')}`
    const originUid = generateOriginUid(chNum)
    memories.push({ storyId, chapterId, fromChapterNumber: chNum, layer: 'chapter', content, tags: JSON.stringify(['auto-extracted']), importance: sanitizeImportance(event.importance), originUid })
  }

  // 3. 情绪/伏笔/关系变化
  if (result.emotions?.length) {
    for (const e of result.emotions) {
      memories.push({ storyId, chapterId, fromChapterNumber: chNum, layer: 'chapter', content: `情绪：${e}`, tags: JSON.stringify(['auto-extracted']), importance: 5 })
    }
  }
  if (result.foreshadowing?.length) {
    for (const e of result.foreshadowing) {
      memories.push({ storyId, chapterId, fromChapterNumber: chNum, layer: 'chapter', content: `伏笔：${e}`, tags: JSON.stringify(['auto-extracted']), importance: 5 })
    }
  }
  if (result.relationshipChanges?.length) {
    for (const e of result.relationshipChanges) {
      memories.push({ storyId, chapterId, fromChapterNumber: chNum, layer: 'chapter', content: `关系：${e}`, tags: JSON.stringify(['auto-extracted']), importance: 5 })
    }
  }

  // 4. 场景记忆
  for (const scene of result.scenes || []) {
    const sceneContent = scene.description
      ? `【${scene.location}】${scene.description} | 事件：${scene.event}`
      : `【${scene.location}】事件：${scene.event}`
    memories.push({ storyId, chapterId, fromChapterNumber: chNum, layer: 'scene', content: sceneContent, tags: JSON.stringify(['auto-extracted', 'scene-memory']), importance: sanitizeImportance(scene.importance) })
  }

  // 5. 全局记忆（角色状态变化）
  for (const [charName, changes] of Object.entries(result.characterStatusChanges || {})) {
    memories.push({
      storyId, chapterId, fromChapterNumber: chNum,
      layer: 'global',
      content: `【${charName}】状态更新：${JSON.stringify(changes)}`,
      tags: JSON.stringify(['auto-extracted', 'character-status']),
      importance: 8
    })

    // 准备 CharacterBranchState 写入数据
    const { relationships: relChanges, ...statusChanges } = changes as Record<string, any>
    characterStates.push({
      characterId: charName, // 注意：这里存的是名字，实际写入时需要根据 storyId+name 查找 character.id
      fromChapterNumber: chNum,
      status: JSON.stringify(statusChanges),
      relationships: relChanges && typeof relChanges === 'object'
        ? JSON.stringify(relChanges)
        : '{}'
    })
  }

  // 6. 时间线
  //    双层数据源:
  //    - 顶层 timelinePosition: 章首时间锚点 (旧路径)
  //    - result.timelineEvents[]: AI 返回的章内时间点事件 (新路径)
  //    行为:
  //      a) 顶层 valid → 章首 row 写入 (携 mainEvents 描述), 数组里 position 独立 row
  //      b) 顶层 null + 数组 valid → 用数组第一条 position 作章首, 章首 row 写入 (携 mainEvents)
  //      c) 顶层 null + 数组空/全 null → 不合成, 输出空
  //    validateTimelinePosition 在写库前兜底, 非法值丢弃
  let anchorPosition: number | null = null
  if (typeof result.timelinePosition === 'number' &&
      validateTimelinePosition(result.timelinePosition).ok) {
    anchorPosition = result.timelinePosition
  }

  // 先扫描数组, 收集所有 valid position 事件 (每条 events 仅含自身 description)
  const perEventWrites: TimelineEventWrite[] = []
  for (const ev of result.timelineEvents || []) {
    if (typeof ev?.position !== 'number') continue
    if (!validateTimelinePosition(ev.position).ok) continue
    perEventWrites.push({
      storyId,
      fromChapterNumber: chNum,
      position: ev.position,
      events: JSON.stringify([ev.description])
    })
  }

  // 顶层缺位 + 数组有效 → 用数组第一条 position 作章首
  if (anchorPosition === null && perEventWrites.length > 0) {
    anchorPosition = perEventWrites[0].position
  }

  // 章首 row: 若 anchor 位置尚无 row, 写入一条章首 row 携带 mainEvents 描述
  // 若数组第一条 position 已是 anchor (典型情况), 把那条 row 的 events
  // 合并: mainEvents 描述 + 原数组 row 的描述 (不覆盖, 避免丢失章首的原文表述)
  // mainEvents 空时退化为保留原数组 row 的描述
  if (anchorPosition !== null) {
    const eventDescs = (result.mainEvents || []).map(e => e.description)
    const existingIdx = perEventWrites.findIndex(w => w.position === anchorPosition)
    if (existingIdx >= 0) {
      const originalEvents = safeJsonParse<string[]>(perEventWrites[existingIdx].events, [])
      const merged = [...eventDescs, ...originalEvents]
      perEventWrites[existingIdx] = {
        ...perEventWrites[existingIdx],
        events: JSON.stringify(merged)
      }
    } else {
      perEventWrites.push({
        storyId,
        fromChapterNumber: chNum,
        position: anchorPosition,
        events: JSON.stringify(eventDescs)
      })
    }
  }
  // 同 fromChapterNumber 范围内聚类去重 (2026-06-27 兜底):
  //   AI 在 mainEvents / timelineEvents 用不同措辞写同一事件 (Jaccard ≈ 0.7+),
  //   直接落库会产生"看似不同但语义相同"的 row。聚类用 tokenSet + jaccardSimilarity
  //   (已有 helper, @novel-runtime/shared), 阈值 0.7。匹配到现有 row 就把新 events
  //   合并到该 row.events 数组, 不匹配独立成 row。
  //   历史数据不回填, 只影响未来 archive。
  const JACCARD_THRESHOLD = 0.7
  const clustered: TimelineEventWrite[] = []
  for (const candidate of perEventWrites) {
    const candidateEvents = safeJsonParse<string[]>(candidate.events, [])
    let mergedInto: TimelineEventWrite | null = null
    for (const existing of clustered) {
      const existingEvents = safeJsonParse<string[]>(existing.events, [])
      for (const candDesc of candidateEvents) {
        const candSet = tokenSet(candDesc)
        for (const ed of existingEvents) {
          const sim = jaccardSimilarity(candSet, tokenSet(ed))
          if (sim >= JACCARD_THRESHOLD) {
            mergedInto = existing
            break
          }
        }
        if (mergedInto) break
      }
      if (mergedInto) break
    }
    if (mergedInto) {
      const mergedEvents = [
        ...safeJsonParse<string[]>(mergedInto.events, []),
        ...candidateEvents
      ]
      mergedInto.events = JSON.stringify(mergedEvents)
    } else {
      clustered.push(candidate)
    }
  }
  timelineEvents = clustered
  timelinePosition = anchorPosition

  // 7. 摘要
  if (result.summary) {
    summary = result.summary
  }

  return { memories, characterStates, timelineEvents, summary, timelinePosition }
}

/**
 * 在事务中提交记忆写入
 * 注意：characterStates 中的 characterId 是角色名字，需要在这里解析为实际 ID
 */
export async function commitMemoryWrites(
  tx: any,
  chapterId: string,
  storyId: string,
  data: ArchiveMemoryData,
  existingCharacterMap?: Map<string, string> // name -> id
): Promise<void> {
  // 1. 写入 Memory
  for (const mem of data.memories) {
    await tx.memory.create({ data: mem })
  }

  // 2. 写入 CharacterBranchState（需要解析 characterId）
  if (data.characterStates.length > 0) {
    const charMap = existingCharacterMap || new Map<string, string>()
    if (!existingCharacterMap) {
      const characters = await tx.character.findMany({
        where: { storyId },
        select: { id: true, name: true }
      })
      for (const c of characters) charMap.set(c.name, c.id)
    }

    for (const state of data.characterStates) {
      const characterId = charMap.get(state.characterId)
      if (!characterId) continue

      // 查最新状态做 merge
      const latestState = await tx.characterBranchState.findFirst({
        where: { characterId },
        orderBy: { fromChapterNumber: 'desc' }
      })
      const currentStatus = safeJsonParse<Record<string, any>>(latestState?.status, {})
      const currentRelationships = safeJsonParse<Record<string, any>>(latestState?.relationships, {})
      const newStatus = safeJsonParse<Record<string, any>>(state.status, {})
      const newRelationships = safeJsonParse<Record<string, any>>(state.relationships, {})

      const mergedStatus = { ...currentStatus, ...newStatus }
      const mergedRelationships = { ...currentRelationships, ...newRelationships }

      await tx.characterBranchState.create({
        data: {
          characterId,
          fromChapterNumber: state.fromChapterNumber,
          status: JSON.stringify(mergedStatus),
          relationships: JSON.stringify(mergedRelationships)
        }
      })
    }
  }

  // 3. 写入 TimelineEvent (compound key: storyId + position)
  //    合并去重 (2026-06-27): 同 (storyId, position) 已存在 row 时, 朴素拼接
  //    events JSON 数组会让相似措辞 (Jaccard ≥ 0.7) 在同一 row 内重复。
  //    典型场景: 章节重新归档, 旧 events + 新 events 在同 row 叠加。
  //    兜底: 合并前按 Jaccard 去重, 保留老 entries (历史优先)。
  const MERGE_JACCARD_THRESHOLD = 0.7
  for (const te of data.timelineEvents) {
    const existing = await tx.timelineEvent.findUnique({
      where: { storyId_position: { storyId: te.storyId, position: te.position } }
    })
    if (existing) {
      const oldEvents = safeJsonParse<string[]>(existing.events, [])
      const newEvents = safeJsonParse<string[]>(te.events, [])
      // 预计算老 entries 的 token Set, 减少重复 tokenize
      const oldTokenSets = oldEvents.map(e => ({ text: e, set: tokenSet(e) }))
      const dedupedNew: string[] = []
      for (const newDesc of newEvents) {
        const newSet = tokenSet(newDesc)
        const isDup = oldTokenSets.some(ot =>
          jaccardSimilarity(newSet, ot.set) >= MERGE_JACCARD_THRESHOLD
        )
        if (!isDup) dedupedNew.push(newDesc)
      }
      await tx.timelineEvent.update({
        where: { id: existing.id },
        data: { events: JSON.stringify([...oldEvents, ...dedupedNew]) }
      })
    } else {
      await tx.timelineEvent.create({ data: te })
    }
  }
}

/**
 * 兼容旧接口：直接写入数据库（非事务模式）
 * 已废弃，新代码请使用 prepareMemoryWrites + commitMemoryWrites
 */
export async function saveExtractedMemory(
  app: FastifyInstance,
  chapterId: string,
  storyId: string,
  result: MemoryExtractionResult,
  fromChapterNumber?: number
) {
  const prisma = app.prisma
  const data = prepareMemoryWrites(storyId, chapterId, result, fromChapterNumber)

  // 预加载角色映射
  const characters = await prisma.character.findMany({
    where: { storyId },
    select: { id: true, name: true }
  })
  const charMap = new Map<string, string>()
  for (const c of characters) charMap.set(c.name, c.id)

  // 去重：查询最近 50 条记忆
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
      data: { storyId, chapterId, fromChapterNumber: fromChapterNumber ?? 0, layer, content, tags: JSON.stringify(tags), importance, originUid }
    })
    recentSets.unshift(tokenSet(content))
    if (recentSets.length > 50) recentSets.pop()
  }

  // 写入 chapter 层记忆（去重）
  for (const mem of data.memories) {
    if (mem.layer === 'chapter' || mem.layer === 'scene') {
      const tags = safeJsonParse<string[]>(mem.tags, [])
      await saveIfUnique(mem.content, mem.layer, tags, mem.importance, mem.originUid)
    } else {
      await prisma.memory.create({ data: mem })
    }
  }

  // 写入 CharacterBranchState
  for (const state of data.characterStates) {
    const cid = charMap.get(state.characterId)
    if (!cid) continue
    const latestState = await prisma.characterBranchState.findFirst({
      where: { characterId: cid },
      orderBy: { fromChapterNumber: 'desc' }
    })
    const currentStatus = safeJsonParse<Record<string, any>>(latestState?.status, {})
    const currentRelationships = safeJsonParse<Record<string, any>>(latestState?.relationships, {})
    const newStatus = safeJsonParse<Record<string, any>>(state.status, {})
    const newRelationships = safeJsonParse<Record<string, any>>(state.relationships, {})
    const mergedStatus = { ...currentStatus, ...newStatus }
    const mergedRelationships = { ...currentRelationships, ...newRelationships }
    await prisma.characterBranchState.create({
      data: {
        characterId: cid,
        fromChapterNumber: state.fromChapterNumber,
        status: JSON.stringify(mergedStatus),
        relationships: JSON.stringify(mergedRelationships)
      }
    })
  }

  // 写入 TimelineEvent (compound key: storyId + position)
  for (const te of data.timelineEvents) {
    const existing = await prisma.timelineEvent.findUnique({
      where: { storyId_position: { storyId: te.storyId, position: te.position } }
    })
    if (existing) {
      const oldEvents = safeJsonParse(existing.events, [])
      const newEvents = safeJsonParse(te.events, [])
      await prisma.timelineEvent.update({
        where: { id: existing.id },
        data: { events: JSON.stringify([...oldEvents, ...newEvents]) }
      })
    } else {
      await prisma.timelineEvent.create({ data: te })
    }
  }

  // 更新章节摘要
  if (data.summary) {
    await prisma.chapter.update({
      where: { id: chapterId },
      data: { summary: data.summary }
    })
  }

  app.log.info(`[MemoryExtractor] Saved memories and synced character status${skipped > 0 ? ` (${skipped} duplicates skipped)` : ''}`)
}
