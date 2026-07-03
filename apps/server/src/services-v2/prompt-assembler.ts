import type { V2PromptConfig } from './config-defaults.js'
import { loadRuntimeBase, loadWorkerTask } from '../services/runtime-loader.js'
import { RuntimePromptCompiler } from '@novel-runtime/ai-provider'


const FALLBACK_SYSTEM = `你是一位专精长篇小说创作的资深作者，擅长构建完整的世界观、人物关系与情节张力。
你需要根据提供的信息生成本章正文。保持文风一致，遵循已有设定，合理推进剧情。`

export interface AssembledPrompt {
  systemMessage: string
  userMessage: string
}

export async function assemblePrompt(
  prisma: any,
  storyId: string,
  config: V2PromptConfig,
  contextLength: number = 64000
): Promise<AssembledPrompt> {
  // System message: 动态编译（identity + behavior + jailbreak + workerTask），失败回退硬编码
  let systemMessage = FALLBACK_SYSTEM
  try {
    const base = await loadRuntimeBase(storyId, prisma)
    const task = await loadWorkerTask(storyId, 'generation', prisma)
    const compiler = new RuntimePromptCompiler()
    const compiled = compiler.compile(base, task, '')
    systemMessage = compiled.systemMessage
  } catch { /* 回退到 FALLBACK_SYSTEM */ }

  // User message: 有条件才拼接
  const sections: string[] = []

  // 作品信息
  const story = await prisma.story.findUnique({
    where: { id: storyId },
    select: { title: true, description: true }
  })
  if (story?.title) {
    const parts = [`作品：《${story.title}》`]
    if (story.description) parts.push(`简介：${story.description}`)
    sections.push(`--- Story ---\n${parts.join('\n')}`)
  }

  // 世界观
  if (config.loreIds.length > 0) {
    const loreItems = await prisma.loreItem.findMany({
      where: { id: { in: config.loreIds } }
    })
    if (loreItems.length > 0) {
      const lines = loreItems.map((l: any) => `【${l.name}】${l.content || ''}`)
      sections.push(`--- Lore ---\n${lines.join('\n')}`)
    }
  }

  // 角色（含最新快照：关系 + 状态）
  if (config.characterIds.length > 0) {
    const chars = await prisma.v2Character.findMany({
      where: { id: { in: config.characterIds } }
    })
    if (chars.length > 0) {
      // 一次查询所有快照，按 chapterNumber desc 排序，首个即为最新
      const allSnapshots = await prisma.v2CharacterSnapshot.findMany({
        where: { characterId: { in: chars.map((c: any) => c.id) } },
        orderBy: { chapterNumber: 'desc' }
      })
      const snapshotMap = new Map<string, any>()
      for (const s of allSnapshots) {
        if (!snapshotMap.has(s.characterId)) snapshotMap.set(s.characterId, s)
      }

      const lines = chars.map((c: any) => {
        const snap = snapshotMap.get(c.id)
        const name = c.isProtagonist ? `${c.name}（主角）` : c.name
        const ctx = { name: c.name, field: '' }
        const identity = safeParseArr(snap?.identity || c.identity, { ...ctx, field: 'identity' })
        const appearance = safeParseArr(snap?.appearance || c.appearance, { ...ctx, field: 'appearance' })
        const temperament = safeParseArr(snap?.temperament || c.temperament, { ...ctx, field: 'temperament' })
        const personality = safeParseArr(snap?.personality || c.personality, { ...ctx, field: 'personality' })
        const speech = safeParseArr(snap?.speechStyle || c.speechStyle, { ...ctx, field: 'speechStyle' })

        const parts: string[] = [`【${name}】`]
        if (identity.length) parts.push(`身份[${identity.join('、')}]`)
        if (appearance.length) parts.push(`外貌[${appearance.join('、')}]`)
        if (temperament.length) parts.push(`气质[${temperament.join('、')}]`)
        if (personality.length) parts.push(`性格[${personality.join('、')}]`)
        if (speech.length) parts.push(`说话风格[${speech.join('、')}]`)

        // 快照字段：关系 + 状态
        if (snap) {
          const rel = safeParseObj(snap.relationships, { ...ctx, field: 'relationships' })
          if (Object.keys(rel).length > 0) {
            const relParts = Object.entries(rel).map(([k, v]) => `${k}：${v}`)
            parts.push(`关系[${relParts.join('；')}]`)
          }
          const st = safeParseObj(snap.status, { ...ctx, field: 'status' })
          if (Object.keys(st).length > 0) {
            const stParts = Object.entries(st).map(([k, v]) => `${k}：${v}`)
            parts.push(`状态[${stParts.join('；')}]`)
          }
        }

        return parts.join(' ')
      })
      sections.push(`--- Character ---\n${lines.join('\n')}`)
    }
  }

  // 场景
  if (config.scene) {
    sections.push(`--- Scene ---\n${config.scene}`)
  }

  // 写作风格
  if (config.styleNotes) {
    sections.push(`--- Style ---\n${config.styleNotes}`)
  }

  // 记忆（含重要度）
  if (config.memoryTypeIds.length > 0) {
    const memIds = config.memoryTypeIds.map(m => m.id)
    const memories = await prisma.v2Memory.findMany({
      where: { id: { in: memIds }, isActive: true }
    })
    if (memories.length > 0) {
      const lines = memories.map((m: any) =>
        `[${categoryLabel(m.category)}] (重要度${m.importance}) ${m.content}`
      )
      sections.push(`--- Memory ---\n${lines.join('\n')}`)
    }
  }

  // 剧情弧线
  if (config.plotArcIds.length > 0) {
    const arcs = await prisma.v2PlotArc.findMany({
      where: { id: { in: config.plotArcIds } }
    })
    if (arcs.length > 0) {
      const lines = arcs.map((a: any) => {
        const typeLabel = a.isMainline ? '主线' : '支线'
        const parts = [`[${typeLabel}] ${a.title}`]
        if (a.description) parts.push(a.description)
        if (a.mainlineNote) parts.push(`要点：${a.mainlineNote}`)
        return parts.join('\n')
      })
      sections.push(`--- Plot Arc ---\n${lines.join('\n\n')}`)
    }
  }

  // 大纲 — 作为输出指令核心，放在 user message 末尾，利用 recency bias
  if (config.outline) {
    sections.push(`--- Output ---\n请根据以下大纲生成本章正文，将大纲中的情节展开为完整的章节叙述：\n\n${config.outline}\n\n`)
  } else {
    sections.push(`--- Output ---\n请根据以上信息生成本章正文。只输出正文内容，不要包含任何解释、分析或元信息。`)
  }

  // Token 预算：总超则按优先级从低到高逐层截断
  const maxChars = Math.floor(contextLength * 0.85) * 2 // 留 15% 给 system message，约 2 chars/token
  const budgetedSections = applyPriorityBudget(sections, maxChars)

  return {
    systemMessage,
    userMessage: budgetedSections.join('\n\n')
  }
}

// 截断优先级：数字越小越先被截。输出指令不在表中 = 永不截断
const LAYER_PRIORITY: Record<string, number> = {
  '--- Lore ---': 1,
  '--- Style ---': 2,
  '--- Scene ---': 3,
  '--- Memory ---': 4,
  '--- Plot Arc ---': 5,
  '--- Story ---': 6,
  '--- Character ---': 7,
}

function applyPriorityBudget(sections: string[], maxChars: number): string[] {
  const parsed = sections.map((section, i) => {
    const nl = section.indexOf('\n')
    const label = nl >= 0 ? section.slice(0, nl) : ''
    return {
      label,
      content: nl >= 0 ? section.slice(nl + 1) : section,
      priority: LAYER_PRIORITY[label] ?? Infinity,
      index: i
    }
  })

  const totalChars = () =>
    parsed.reduce((sum, p) => sum + (p.label ? p.label.length + 1 + p.content.length : p.content.length), 0)
    + (parsed.length > 1 ? (parsed.length - 1) * 2 : 0) // \n\n 分隔符

  if (totalChars() <= maxChars) return sections

  // 按优先级升序：低优先级的层先截
  const order = parsed
    .filter(p => p.priority !== Infinity && p.content.length > 20)
    .sort((a, b) => a.priority - b.priority)

  for (const item of order) {
    if (totalChars() <= maxChars) break
    const overflow = totalChars() - maxChars
    if (overflow <= 0) break

    const p = parsed[item.index]
    const targetLen = Math.max(20, p.content.length - overflow)
    if (targetLen < p.content.length) {
      p.content = truncateByParagraph(p.content, targetLen)
    }
  }

  return parsed.map(p => p.label ? p.label + '\n' + p.content : p.content)
}

function truncateByParagraph(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text
  const paragraphs = text.split(/\n\n+/)
  const kept: string[] = []
  let used = 0
  for (const p of paragraphs) {
    const cost = kept.length === 0 ? p.length : p.length + 2
    if (used + cost > maxChars) {
      if (kept.length === 0) return p.slice(0, maxChars) + '...'
      break
    }
    kept.push(p)
    used += cost
  }
  return kept.join('\n\n') + '\n...'
}

function safeParseArr(raw: any, ctx: { name: string; field: string }): string[] {
  if (Array.isArray(raw)) return raw
  if (raw == null || raw === '') return []
  if (typeof raw === 'string') {
    try {
      const v = JSON.parse(raw)
      return Array.isArray(v) ? v : []
    } catch {
      throw new Error(`角色「${ctx.name}」的 ${ctx.field} 字段 JSON 解析失败: ${raw.slice(0, 80)}`)
    }
  }
  return []
}

function safeParseObj(raw: any, ctx: { name: string; field: string }): Record<string, string> {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) return raw as Record<string, string>
  if (raw == null || raw === '') return {}
  if (typeof raw === 'string') {
    try {
      const v = JSON.parse(raw)
      return (v && typeof v === 'object' && !Array.isArray(v)) ? v : {}
    } catch {
      throw new Error(`角色「${ctx.name}」的 ${ctx.field} 字段 JSON 解析失败: ${raw.slice(0, 80)}`)
    }
  }
  return {}
}

function categoryLabel(cat: string): string {
  const map: Record<string, string> = {
    relationship_change: '关系变化',
    foreshadowing: '伏笔',
    emotional_change: '情感变化',
    event_memory: '事件记忆'
  }
  return map[cat] || cat
}
