import { resolveProvider } from '../services/ai-provider-init.js'
import { fail, ok, type ExtractorResult } from './extractor-types.js'

export interface V2ExtractedMemory {
  type: 'global' | 'chapter' | 'scene' | 'temporary'
  category: 'relationship_change' | 'foreshadowing' | 'emotional_change' | 'event_memory'
  content: string
  importance: number
  participants?: string
}

export interface V2MemoryExtractResult {
  chapterMemories: V2ExtractedMemory[]
  globalMemories: V2ExtractedMemory[]
  sceneMemories: V2ExtractedMemory[]
}

const EXTRACT_SYSTEM = `你是一位专精长篇小说记忆管理的专业编辑。你需要从给定的小说正文中提取三类记忆。
返回严格的 JSON 格式，不要包含任何解释、markdown 标记或额外文字。`

const EXTRACT_USER = `请从以下章节正文中提取记忆信息。返回一个 JSON 对象，包含三个数组：

【正文】
{content}

【已有全局记忆（仅供参考，不需要修改）】
{existingGlobals}

---

### chapterMemories（章节记忆）
当前章节独有的、非贯穿全文的信息。每条格式：
- type: "chapter"
- category: "relationship_change" | "foreshadowing" | "emotional_change" | "event_memory"
- content: 记忆内容描述
  - 关系变化: "XX与YY因ZZ事件关系变为NN"
  - 伏笔: "XX事件暗示了YY可能性"
  - 情绪情感变化: "XX对YY因为ZZ事件在态度/情绪/认知上变成了NN"
  - 事件记忆: "事件描述 | 参与者：XX、YY、ZZ"
- importance: 1-10 整数，根据记忆在文中的作用评分（默认4-6，主角参与+1，推动剧情+1，情感强烈+1）
- participants: 参与者姓名，逗号分隔

### sceneMemories（场景记忆）
重要场景信息（浓墨描写、推动剧情发展的场景）：
- type: "scene"
- category: "event_memory"
- content: 场景发生了什么事
- importance: 同上规则
- participants: 同上

### globalMemories（全局记忆）
贯穿全文、笔墨重、经常提到的信息：
- type: "global"
- 其他字段同上

注意：
1. 不要重复已有全局记忆中的内容
2. 只提取本章明确出现的信息，不要编造
3. importance 必须是 1-10 的整数

返回格式：
{"chapterMemories":[],"sceneMemories":[],"globalMemories":[]}`

const MERGE_SYSTEM = `你是一位专精长篇小说记忆管理的专业编辑。你需要将新的全局记忆合并到已有的全局记忆集中。
返回严格的 JSON 格式，不要包含任何解释、markdown 标记或额外文字。`

const MERGE_USER = `请合并以下全局记忆。

【已有全局记忆】
{existingGlobals}

【新增全局记忆】
{newGlobals}

合并规则：
1. 去重：内容高度相似的记忆，保留更完整/更精炼的一条
2. 提炼：同一主题的多条记忆可以合并为一条更精炼的
3. 补充：新增记忆中确实新颖的信息应加入
4. 保持每条记忆的 type 为 "global"
5. 保持 importance 评分一致性（同一主题合并取较高的 importance）

返回合并后的全局记忆 JSON 数组，格式与输入一致。`

export async function extractMemories(
  prisma: any,
  storyId: string,
  chapterNumber: number,
  content: string
): Promise<ExtractorResult<V2MemoryExtractResult>> {
  const resolved = await resolveProvider(prisma, storyId)
  if (!resolved?.provider?.generate) {
    return fail('未配置 AI provider')
  }

  // 加载已有全局记忆
  const existingGlobals = await prisma.v2Memory.findMany({
    where: { storyId, type: 'global', isActive: true },
    select: { category: true, content: true, importance: true, participants: true }
  })

  const globalSummary = existingGlobals.length > 0
    ? existingGlobals.map((m: any) => `[${m.category}] ${m.content} (重要度:${m.importance})`).join('\n')
    : '（暂无）'

  // 截断过长内容（8000 字），避免 token 超限
  const truncated = content.length > 8000 ? content.substring(0, 8000) : content

  // 第一次 AI 调用：提取章节记忆
  const extractPrompt = EXTRACT_USER
    .replace('{content}', truncated)
    .replace('{existingGlobals}', globalSummary)

  let raw: string
  try {
    raw = await resolved.provider.generate(extractPrompt, { system: EXTRACT_SYSTEM, temperature: 0.3 })
  } catch (err: any) {
    return fail(`AI 调用失败: ${err?.message || '未知错误'}`)
  }
  const extracted = parseAIJson(raw)

  if (!extracted || typeof extracted !== 'object') {
    return fail('AI 返回数据格式错误：期望对象')
  }

  const chapterMemories: V2ExtractedMemory[] = (extracted.chapterMemories || []).map(normalizeMemory)
  const sceneMemories: V2ExtractedMemory[] = (extracted.sceneMemories || []).map(normalizeMemory)
  let newGlobals: V2ExtractedMemory[] = (extracted.globalMemories || []).map(normalizeMemory)

  // 第二次 AI 调用：合并全局记忆
  if (newGlobals.length > 0 && existingGlobals.length > 0) {
    const mergePrompt = MERGE_USER
      .replace('{existingGlobals}', globalSummary)
      .replace('{newGlobals}', newGlobals.map(m => `[${m.category}] ${m.content} (重要度:${m.importance})`).join('\n'))

    let mergeRaw: string
    try {
      mergeRaw = await resolved.provider.generate(mergePrompt, { system: MERGE_SYSTEM, temperature: 0.3 })
    } catch (err: any) {
      return fail(`AI 合并全局记忆失败: ${err?.message || '未知错误'}`)
    }
    const merged = parseAIJson(mergeRaw)
    if (!Array.isArray(merged)) {
      return fail('AI 合并全局记忆返回数据格式错误：期望数组')
    }
    newGlobals = merged.map(normalizeMemory)
  }

  return ok({ chapterMemories, globalMemories: newGlobals, sceneMemories })
}

function normalizeMemory(raw: any): V2ExtractedMemory {
  const category = ['relationship_change', 'foreshadowing', 'emotional_change', 'event_memory'].includes(raw.category)
    ? raw.category
    : 'event_memory'
  const importance = clampImportance(raw.importance)
  return {
    type: raw.type || 'chapter',
    category,
    content: raw.content || '',
    importance,
    participants: raw.participants || undefined
  }
}

function clampImportance(v: any): number {
  const n = typeof v === 'number' ? v : parseInt(v, 10)
  if (!Number.isFinite(n)) return 4
  return Math.max(0, Math.min(10, Math.round(n)))
}

function parseAIJson(raw: string): any {
  let text = raw.trim()
  if (text.startsWith('```')) {
    text = text.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '')
  }
  try { return JSON.parse(text) } catch {
    const objMatch = text.match(/\{[\s\S]*\}/)
    if (objMatch) {
      try { return JSON.parse(objMatch[0]) } catch { /* fall through */ }
    }
    return null
  }
}
