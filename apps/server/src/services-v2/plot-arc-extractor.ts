import { truncateByParagraph } from '@novel-runtime/prompt-runtime'
import { runAiExtraction } from './extractor-base.js'
import type { ExtractorResult } from './extractor-types.js'

export interface V2ExtractedPlotArc {
  action: 'create' | 'update' | 'close'
  plotArcId?: string
  title: string
  description: string
  status: 'active' | 'interrupted' | 'completed' | 'closed'
  isMainline: boolean
  mergeInfo?: string
}

export interface V2PlotArcExtractResult {
  arcs: V2ExtractedPlotArc[]
}

const SYSTEM = `你是一位专精长篇小说剧情分析的专业编辑。你需要从章节正文中分析剧情弧线的进展。
返回严格的 JSON 格式，不要包含任何解释、markdown 标记或额外文字。`

const PROMPT = `请分析以下章节正文中的剧情弧线变化。

【已有剧情弧线】
{existingArcs}

【正文】
{content}

请返回 JSON 数组，每条记录代表一个剧情弧线的变化：

字段说明：
- action: "update"(更新已有弧线) | "create"(新建弧线) | "close"(关闭弧线)
- plotArcId: 若 action 为 "update" 或 "close"，填写已有弧线的编号（从上面的列表里对应）；若为 "create" 则不填
- title: 弧线标题（简洁明了，5-15字）
- description: 本章中该弧线的进展描述
- status: 弧线当前状态
  - "active": 仍在发展中
  - "completed": 本章中该弧线已完结
  - "interrupted": 未提及但尚未完结
  - "closed": 发现与另一弧线重复，应关闭
- isMainline: 是否为主线（true/false，主角参与的通常是主线）
- mergeInfo: 仅 action 为 "close" 时填写，说明应合并到哪条弧线（填写目标弧线的编号或标题）

规则：
1. 只提取正文中明确出现或发展的剧情线索
2. 同一剧情不应分割成多条弧线——若新剧情与已有弧线高度接近，选择 update 而非 create
3. 剧情弧线应在文中有足够笔墨（不是一笔带过的细节）才值得 create
4. 若发现两条弧线实质上描述同一事件，用 action "close" 关闭一条

返回格式：
[{"action":"update","plotArcId":"1","title":"...","description":"...","status":"active","isMainline":true}]`

export async function extractPlotArcs(
  prisma: any,
  storyId: string,
  content: string,
  contentCharBudget: number
): Promise<ExtractorResult<V2PlotArcExtractResult>> {
  const existingArcs = await prisma.v2PlotArc.findMany({
    where: { storyId },
    orderBy: { firstChapterNumber: 'asc' }
  })

  const arcList = existingArcs.map((a: any, i: number) =>
    `${i + 1}. [编号:${a.id}] 【${a.title}】${a.description || ''} 状态:${a.status} ${a.isMainline ? '(主线)' : ''}`
  ).join('\n')

  // 按 model contextLength 动态算的预算 + 段落级截断 (替代 8000 字硬切)
  const truncated = truncateByParagraph(content, contentCharBudget)

  const prompt = PROMPT
    .replace('{existingArcs}', arcList || '（暂无）')
    .replace('{content}', truncated)

  return runAiExtraction<V2PlotArcExtractResult>({
    prisma,
    storyId,
    system: SYSTEM,
    prompt,
    context: 'plot-arc-extractor',
    validate: (raw) => {
      if (!Array.isArray(raw)) return null
      const arcs: V2ExtractedPlotArc[] = raw.map((item: any) => ({
        action: ['create', 'update', 'close'].includes(item.action) ? item.action : 'create',
        plotArcId: item.plotArcId || undefined,
        title: item.title || '',
        description: item.description || '',
        status: ['active', 'interrupted', 'completed', 'closed'].includes(item.status) ? item.status : 'active',
        isMainline: !!item.isMainline,
        mergeInfo: item.mergeInfo || undefined
      }))
      return { arcs }
    }
  })
}
