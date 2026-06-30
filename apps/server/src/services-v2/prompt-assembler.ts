import type { V2PromptConfig } from './config-defaults.js'

const SYSTEM_MESSAGE = `你是一位专精长篇小说创作的资深作者，擅长构建完整的世界观、人物关系与情节张力。
你需要根据提供的信息续写下一个章节。保持文风一致，遵循已有设定，合理推进剧情。
只输出正文内容，不要包含任何解释、分析或元信息。`

export interface AssembledPrompt {
  systemMessage: string
  userMessage: string
}

export async function assemblePrompt(
  prisma: any,
  storyId: string,
  config: V2PromptConfig
): Promise<AssembledPrompt> {
  const sections: string[] = []

  // 角色
  if (config.characterIds.length > 0) {
    const chars = await prisma.v2Character.findMany({
      where: { id: { in: config.characterIds } }
    })
    if (chars.length > 0) {
      const lines = chars.map((c: any) => {
        const parts = [c.name]
        const identity = safeParseArr(c.identity)
        const appearance = safeParseArr(c.appearance)
        const temperament = safeParseArr(c.temperament)
        const personality = safeParseArr(c.personality)
        const speech = safeParseArr(c.speechStyle)
        if (identity.length) parts.push(`身份：${identity.join('、')}`)
        if (appearance.length) parts.push(`外貌：${appearance.join('、')}`)
        if (temperament.length) parts.push(`气质：${temperament.join('、')}`)
        if (personality.length) parts.push(`性格：${personality.join('、')}`)
        if (speech.length) parts.push(`说话风格：${speech.join('、')}`)
        return parts.join(' | ')
      })
      sections.push(`【角色信息】\n${lines.join('\n')}`)
    }
  }

  // 记忆
  if (config.memoryTypeIds.length > 0) {
    const memIds = config.memoryTypeIds.map(m => m.id)
    const memories = await prisma.v2Memory.findMany({
      where: { id: { in: memIds }, isActive: true }
    })
    if (memories.length > 0) {
      const lines = memories.map((m: any) => {
        const catLabel = categoryLabel(m.category)
        return `[${catLabel}] ${m.content}`
      })
      sections.push(`【相关记忆】\n${lines.join('\n')}`)
    }
  }

  // 剧情弧线
  if (config.plotArcIds.length > 0) {
    const arcs = await prisma.v2PlotArc.findMany({
      where: { id: { in: config.plotArcIds } }
    })
    if (arcs.length > 0) {
      const lines = arcs.map((a: any) => {
        const parts = [`【${a.title}】`]
        if (a.description) parts.push(a.description)
        if (a.mainlineNote) parts.push(`要点：${a.mainlineNote}`)
        return parts.join('\n')
      })
      sections.push(`【剧情弧线】\n${lines.join('\n\n')}`)
    }
  }

  // 大纲
  if (config.outline) {
    sections.push(`【本章大纲】\n${config.outline}`)
  }

  // 风格备注
  if (config.styleNotes) {
    sections.push(`【风格备注】\n${config.styleNotes}`)
  }

  return {
    systemMessage: SYSTEM_MESSAGE,
    userMessage: sections.join('\n\n') || '请根据已有信息续写下一个章节。'
  }
}

function safeParseArr(raw: any): string[] {
  if (Array.isArray(raw)) return raw
  if (typeof raw === 'string') {
    try { const v = JSON.parse(raw); return Array.isArray(v) ? v : [] } catch { return [] }
  }
  return []
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
