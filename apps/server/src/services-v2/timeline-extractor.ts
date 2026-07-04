import { truncateByParagraph } from '@novel-runtime/prompt-runtime'
import { runAiExtraction } from './extractor-base.js'
import type { ExtractorResult } from './extractor-types.js'

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

  const systemMessage = `你是一位专精小说时间线分析的专业编辑。
你的任务是从给定章节正文中筛选并精炼出**真正重要**的事件进入 timeline,而非逐条流水账记录所有动作。

原则:
- 优先笔墨浓重 / 推动剧情 / 转折高潮 / 情感强烈的事件
- 同一核心事件的多次复述 / 换视角呈现 / 不同时间点重复描述要合并为一条
- 一笔带过、路人甲乙、纯心理、纯景色、过渡场景、重复状态确认 — 不入 timeline
- 一章数量上限: 短章节 2–3 条; 普通章节 3–5 条; 长章节最多 7 条

返回严格的 JSON 格式, 不要包含任何解释、markdown 标记或额外文字。`

  const userMessage = `请分析以下小说章节正文, 提取并精炼本章真正重要的事件(非流水账)。

【正文】
${truncated}

请返回 JSON 对象, 包含以下字段:
- events: 事件数组, 每个事件包含:
  - title: 事件标题(简短, 如"许青拜师"、"第一次宗门比试")
  - summary: 事件摘要(**一句话**精炼概括核心事件, 不超过 30 字)
  - participants: 参与者名称, 逗号分隔, 如 "许青,姜禾,青玄真人"。若没有明确参与者填空字符串 ""
  - location: 事件发生地点, 如 "青玄宗大殿"。若没有明确地点填空字符串 ""
  - importance: 事件重要性, 严格按下方"重要性重定义"判断
  - timeExpression: 时间表达, 对象包含:
    - raw: 原文中的时间描述(如"三天后"、"当天夜里"、"第二纪元"、"很久以后"), 若文中无明显时间描述填空字符串
    - type: 时间类型, "relative"(相对上一事件)、"absolute"(绝对日期)、"era"(纪元/时代)、"ambiguous"(模糊表达如"后来"、"某一天")、"none"(无时间信息)
    - confidence: 你对这个时间判断的把握, "high"、"medium" 或 "low"
  - narrativeOrder: 事件在章节中出现的顺序, 从 1 开始递增
- defaultAnchorName: 本章事件所属的默认时间轴名称(通常为"主线", 若本章是回忆/插叙/平行世界则根据内容判断)

【去重与精炼】(严格遵守)
1. **去重合并**: 同一核心事件若在文中被多次复述 / 换视角呈现 / 在不同时间点
   重复描述(例如"许青入门"→"许青拜师"→"许青入宗门"是同一件事的不同侧面),
   合并为一条。仅当标题与叙事功能可清晰区分(如"拜师"vs"修炼")时, 才保留多条。
2. **数量上限**: 短章节 2–3 条; 普通章节 3–5 条; 长章节最多 7 条。
   超过时优先保留 importance=major, 砍掉 minor 与重复状态的 normal。
3. **排除不入 timeline**: 一笔带过 / 路人甲乙 / 单纯景色 / 纯心理活动 / 过渡场景 /
   重复状态确认(角色状态在前面事件已记录)。
4. **importance 重定义**:
   - major: 推动剧情 / 转折 / 浓墨重彩 / 情感爆发(占此章大半篇幅, 全文反复呼应)
   - normal: 有一定叙事作用但篇幅不长
   - minor: 过渡 / 铺垫(多数会被数量上限过滤, 慎用)

返回格式示例:
{"events":[{"title":"许青拜师","summary":"许青在青玄宗大殿正式拜青玄真人为师","participants":"许青,青玄真人","location":"青玄宗大殿","importance":"major","timeExpression":{"raw":"三日后","type":"relative","confidence":"high"},"narrativeOrder":1}],"defaultAnchorName":"主线"}

注意:
1. 不要编造正文中不存在的事件
2. 时间表达保留原文措辞, 不要转换成绝对时间
3. 若对时间信息不确定, confidence 设为"low", 不要猜测`

  return runAiExtraction<V2TimelineExtractResult>({
    prisma,
    storyId,
    system: systemMessage,
    prompt: userMessage,
    context: 'timeline-extractor',
    validate: (raw) => {
      if (!raw || typeof raw !== 'object') return null
      const r = raw as any
      const events: V2ExtractedTimelineEvent[] = (r.events || []).map((item: any, i: number) => ({
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

      return {
        events,
        defaultAnchorName: r.defaultAnchorName || '主线'
      }
    }
  })
}
