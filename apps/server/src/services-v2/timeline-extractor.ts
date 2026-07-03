import { resolveProvider } from '../services/ai-provider-init.js'
import { truncateByParagraph } from '@novel-runtime/prompt-runtime'
import { fail, ok, type ExtractorResult } from './extractor-types.js'

export interface V2ExtractedTimelineEvent {
  title: string
  summary: string
  participants: string
  location: string
  importance: 'major' | 'normal' | 'minor'
  timeExpression: {
    raw: string
    type: 'relative' | 'absolute' | 'era' | 'ambiguous' | 'none'
    confidence: 'high' | 'medium' | 'low'
  } | null
  narrativeOrder: number
}

export interface V2TimelineExtractResult {
  events: V2ExtractedTimelineEvent[]
  defaultAnchorName: string
}

export async function extractTimeline(
  prisma: any,
  storyId: string,
  content: string,
  contentCharBudget: number
): Promise<ExtractorResult<V2TimelineExtractResult>> {
  // 按 model contextLength 动态算的预算 + 段落级截断 (替代 8000 字硬切)
  const truncated = truncateByParagraph(content, contentCharBudget)

  const systemMessage = `你是一位专精小说时间线分析的专业编辑。你需要从给定的小说正文中提取所有可识别的事件及其时间信息。
返回严格的 JSON 格式，不要包含任何解释、markdown 标记或额外文字。`

  const userMessage = `请分析以下小说章节正文，提取所有发生的事件。

【正文】
${truncated}

请返回 JSON 对象，包含以下字段：
- events: 事件数组，每个事件包含：
  - title: 事件标题（简短，如"许青拜师"、"第一次宗门比试"）
  - summary: 事件摘要（1-2 句话描述事件内容）
  - participants: 参与者名称，逗号分隔，如 "许青,姜禾,青玄真人"。若没有明确参与者填空字符串 ""
  - location: 事件发生地点，如 "青玄宗大殿"。若没有明确地点填空字符串 ""
  - importance: 事件重要性，"major"（浓墨重彩、推动剧情）、"normal"（常规事件）、"minor"（一笔带过）
  - timeExpression: 时间表达，对象包含：
    - raw: 原文中的时间描述（如"三天后"、"当天夜里"、"第二纪元"、"很久以后"），若文中无明显时间描述填空字符串
    - type: 时间类型，"relative"（相对上一事件）、"absolute"（绝对日期）、"era"（纪元/时代）、"ambiguous"（模糊表达如"后来"、"某一天"）、"none"（无时间信息）
    - confidence: 你对这个时间判断的把握，"high"、"medium" 或 "low"
  - narrativeOrder: 事件在章节中出现的顺序，从 1 开始递增
- defaultAnchorName: 本章事件所属的默认时间轴名称（通常为"主线"，若本章是回忆/插叙/平行世界则根据内容判断）

注意：
1. 按叙事顺序提取事件
2. 不要编造正文中不存在的事件
3. 文中明确描述了"发生了某事"才算事件，单纯的心理活动、景色描写不算
4. 时间表达保留原文措辞，不要转换成绝对时间
5. 若对时间信息不确定，confidence 设为"low"，不要猜测

返回格式示例：
{"events":[{"title":"许青拜师","summary":"许青在青玄宗大殿正式拜青玄真人为师","participants":"许青,青玄真人","location":"青玄宗大殿","importance":"major","timeExpression":{"raw":"三日后","type":"relative","confidence":"high"},"narrativeOrder":1}],"defaultAnchorName":"主线"}`

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

  const parsed = parseAIJson(raw)

  if (!parsed || typeof parsed !== 'object') {
    return fail('AI 返回数据格式错误：期望对象')
  }

  const events: V2ExtractedTimelineEvent[] = (parsed.events || []).map((item: any, i: number) => ({
    title: item.title || `事件${i + 1}`,
    summary: item.summary || '',
    participants: item.participants || '',
    location: item.location || '',
    importance: ['major', 'normal', 'minor'].includes(item.importance) ? item.importance : 'normal',
    timeExpression: item.timeExpression && typeof item.timeExpression === 'object'
      ? {
          raw: item.timeExpression.raw || '',
          type: ['relative', 'absolute', 'era', 'ambiguous', 'none'].includes(item.timeExpression.type) ? item.timeExpression.type : 'none',
          confidence: ['high', 'medium', 'low'].includes(item.timeExpression.confidence) ? item.timeExpression.confidence : 'medium'
        }
      : null,
    narrativeOrder: typeof item.narrativeOrder === 'number' ? item.narrativeOrder : i + 1
  }))

  return ok({
    events,
    defaultAnchorName: parsed.defaultAnchorName || '主线'
  })
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
