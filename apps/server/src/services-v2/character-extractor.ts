import { resolveProvider } from '../services/ai-provider-init.js'
import { fail, ok, type ExtractorResult } from './extractor-types.js'

export interface V2ExtractedCharacter {
  name: string
  slug: string
  identity: string[]
  appearance: string[]
  temperament: string[]
  personality: string[]
  speechStyle: string[]
  relationships: Record<string, string>
  status: Record<string, string>
  matchedCharacterId: string | null
  isNew: boolean
}

export interface V2CharacterExtractResult {
  characters: V2ExtractedCharacter[]
}

export async function extractCharacters(
  prisma: any,
  storyId: string,
  content: string
): Promise<ExtractorResult<V2CharacterExtractResult>> {
  const existingChars = await prisma.v2Character.findMany({
    where: { storyId },
    select: { id: true, name: true, slug: true }
  })

  const existingList = existingChars.map((c: any) => `- ${c.name}（标识: ${c.slug}）`).join('\n')

  // 截断过长内容（8000 字），避免 token 超限
  const truncated = content.length > 8000 ? content.substring(0, 8000) : content

  const systemMessage =`你是一位专精长篇小说角色分析的专业编辑。你需要从给定的小说正文中提取所有出场角色及其属性变化。
返回严格的 JSON 格式，不要包含任何解释、markdown 标记或额外文字。`

  const userMessage = `请分析以下小说章节正文，提取所有出场角色的信息。

【已有角色】
${existingList || '（暂无）'}

【正文】
${truncated}

请返回 JSON 数组，每个角色包含以下字段：
- name: 角色姓名
- slug: 角色标识（英文拼音，如 "zhang-san"）
- identity: 身份描述数组，如 ["某某门派弟子", "主角好友"]
- appearance: 外貌描述数组，如 ["身高八尺", "剑眉星目"]
- temperament: 气质描述数组，如 ["沉稳", "冷峻"]
- personality: 性格描述数组，如 ["果断", "重情义"]
- speechStyle: 说话风格数组，如 ["简洁", "常带反问"]
- relationships: 关系变化对象，如 {"张三": "因为某事变成了敌人", "李四": "初次相识"}
- status: 状态变化对象，如 {"修为": "突破到金丹期", "伤势": "左臂受伤"}
- matchedName: 若角色与已有角色为同一人，填写已有角色的姓名；若无法匹配或不确定，填写 null

注意：
1. 同一角色只出现一次
2. 仅在章节中出现且可识别的角色才提取
3. 关系变化只记录本章中发生的改变
4. 状态变化只记录本章中发生的变化
5. 不要编造章节中不存在的信息

返回格式示例：
[{"name":"张三","slug":"zhang-san","identity":["散修"],"appearance":[],"temperament":["冷静"],"personality":[],"speechStyle":[],"relationships":{"李四":"初次见面"},"status":{"修为":"突破元婴"},"matchedName":"张三"}]`

  const resolved = await resolveProvider(prisma, storyId)
  if (!resolved?.provider?.generate) {
    return fail('未配置 AI provider')
  }

  let raw: string
  try {
    raw = await resolved.provider.generate(userMessage, { system: systemMessage, temperature: 0.3 })
  } catch (err: any) {
    return fail(`AI 调用失败: ${err?.message || '未知错误'}`)
  }
  const extracted = parseAIJson(raw)

  if (!Array.isArray(extracted)) {
    return fail('AI 返回数据格式错误：期望数组')
  }

  const nameToId = new Map<string, string>(existingChars.map((c: any) => [c.name as string, c.id as string]))
  const slugToId = new Map<string, string>(existingChars.map((c: any) => [c.slug as string, c.id as string]))

  const characters: V2ExtractedCharacter[] = extracted.map((item: any) => {
    const matchedName = item.matchedName || null
    let matchedId: string | null = null

    if (matchedName) {
      matchedId = nameToId.get(matchedName) ?? slugToId.get(matchedName) ?? null
    }
    // fallback: match by name or slug directly
    if (!matchedId && item.name) {
      matchedId = nameToId.get(item.name) ?? slugToId.get(item.name) ?? null
    }

    return {
      name: item.name || '',
      slug: item.slug || toSlug(item.name || ''),
      identity: ensureArr(item.identity),
      appearance: ensureArr(item.appearance),
      temperament: ensureArr(item.temperament),
      personality: ensureArr(item.personality),
      speechStyle: ensureArr(item.speechStyle),
      relationships: ensureObj(item.relationships),
      status: ensureObj(item.status),
      matchedCharacterId: matchedId,
      isNew: !matchedId
    }
  })

  return ok({ characters })
}

function parseAIJson(raw: string): any {
  let text = raw.trim()
  // 去掉可能的 markdown 代码块包装
  if (text.startsWith('```')) {
    text = text.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '')
  }
  try { return JSON.parse(text) } catch {
    // 尝试提取第一个 JSON 数组
    const arrMatch = text.match(/\[[\s\S]*\]/)
    if (arrMatch) {
      try { return JSON.parse(arrMatch[0]) } catch { /* fall through */ }
    }
    return null
  }
}

function ensureArr(v: any): string[] {
  if (Array.isArray(v)) return v
  return []
}

function ensureObj(v: any): Record<string, string> {
  if (v && typeof v === 'object' && !Array.isArray(v)) return v
  return {}
}

function toSlug(name: string): string {
  return name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9一-鿿-]/g, '')
}
