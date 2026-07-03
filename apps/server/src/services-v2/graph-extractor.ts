import { resolveProvider } from '../services/ai-provider-init.js'
import { truncateByParagraph } from '@novel-runtime/prompt-runtime'
import { fail, ok, type ExtractorResult } from './extractor-types.js'
import type { GraphData } from './graph-types.js'

export async function extractGraph(
  prisma: any,
  storyId: string,
  content: string,
  contentCharBudget: number
): Promise<ExtractorResult<GraphData>> {
  const resolved = await resolveProvider(prisma, storyId)
  if (!resolved?.provider?.generate) return fail('未配置 AI provider')

  // 按 model contextLength 动态算的预算 + 段落级截断 (替代 8000 字硬切)
  const truncated = truncateByParagraph(content, contentCharBudget)

  const systemMessage = `你是一位专精长篇小说结构分析的知识图谱专家。
你需要从小说正文中提取关键实体（节点）和它们之间的关系（边），构建结构化的知识图谱。
返回严格的 JSON 格式，不要包含任何解释、markdown 标记或额外文字。`

  const userMessage = `请分析以下小说章节正文，提取对剧情有实质推动作用的核心实体以及它们之间的关系。

【正文】
${truncated}

【提取原则 — 非常重要，必须遵守】
1. 【主线事件合并】同一主线剧情链上的连续事件必须合并为一个整体事件节点。
   例如"明教内部分裂→成昆偷袭→六大门派围攻光明顶→张无忌出手化解恩怨"应合并为一个事件节点"六大门派围攻光明顶"，而不是拆成多个事件。
2. 【支线独立】与主线并行的独立支线（如第三方暗中观察、配角个人线）可以作为独立事件节点。
3. 【重要性过滤】只提取 importance >= 4 的实体。路人、一次性提及的角色、无剧情推动作用的背景环境/物品不要提取。
4. 【角色优先】主角团和重要配角必须提取，次要角色如果在本章无实质戏份不要提取。
5. 【关系直白】每条关系应该简洁直接地表达两个实体间的核心联系，2-6 个中文字符。常见关系：隶属、对抗、师徒、配偶、兄弟、持有、发生地、位于、相识、合作。

【节点类型 — 6 种】
- character: 角色（人物）
- faction: 势力（门派、组织、帮派、国家等）
- event: 事件（本章发生的、对剧情有推动作用的重要事件）
- item: 物品（重要道具、武器、法宝、功法等）
- location: 地点（城市、宗门、秘境、洞府、山川等）
- other: 其他（无法归入上述类型但确实重要的实体）

【字段说明】
- key: 英文小写唯一标识，如 "zhang-wuji"，尽量简短，不含空格
- label: 显示名称，如 "张无忌"
- importance: 1-10 评估重要程度
  · 10: 本章核心主角/核心事件
  · 8-9: 重要角色/势力/关键事件
  · 6-7: 有一定戏份的角色/事件
  · 4-5: 次要但有存在的实体
  · 1-3: 不要提取，过滤掉
- data: 可选的补充信息对象，如 {"备注":"明教教主", "修为":"元婴期"}

【边说明】
- fromKey / toKey: 必须对应节点中的 key 值
- relation: 2-6 个中文字符的核心关系词

返回严格的 JSON 格式，不要 markdown 代码块、不要解释文字：
{
  "nodes": [
    {"type":"character","key":"zhang-wuji","label":"张无忌","importance":10,"data":{"备注":"明教教主"}},
    {"type":"faction","key":"ming-jiao","label":"明教","importance":8},
    {"type":"event","key":"guang-ming-ding-zhi-zhan","label":"光明顶之战","importance":10},
    {"type":"location","key":"guang-ming-ding","label":"光明顶","importance":6}
  ],
  "edges": [
    {"fromKey":"zhang-wuji","toKey":"ming-jiao","relation":"统领"},
    {"fromKey":"zhang-wuji","toKey":"guang-ming-ding-zhi-zhan","relation":"参与"},
    {"fromKey":"ming-jiao","toKey":"guang-ming-ding","relation":"占据"}
  ]
}`

  let raw: string
  try {
    raw = await resolved.provider.generate(userMessage, {
      system: systemMessage,
      temperature: 0.3
    })
  } catch (err: any) {
    return fail(`AI 调用失败: ${err?.message || '未知错误'}`)
  }

  const parsed = parseAIJson(raw)
  if (!parsed || typeof parsed !== 'object') return fail('AI 返回数据格式错误：期望对象')

  const nodes = Array.isArray(parsed.nodes)
    ? parsed.nodes.map(normalizeNode).filter((n: any) => n.importance >= 4)
    : []
  const nodeKeys = new Set(nodes.map((n: any) => n.key))
  const edges = Array.isArray(parsed.edges)
    ? parsed.edges.map(normalizeEdge).filter((e: any) => nodeKeys.has(e.fromKey) && nodeKeys.has(e.toKey))
    : []

  return ok({ nodes, edges })
}

function normalizeNode(raw: any): any {
  const validTypes = ['character', 'faction', 'event', 'item', 'location', 'other']
  return {
    type: validTypes.includes(raw.type) ? raw.type : 'other',
    key: (raw.key || '').toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, ''),
    label: raw.label || raw.key || '',
    importance: typeof raw.importance === 'number' ? Math.min(10, Math.max(1, raw.importance)) : 5,
    data: raw.data && typeof raw.data === 'object' ? raw.data : undefined
  }
}

function normalizeEdge(raw: any): any {
  return {
    fromKey: (raw.fromKey || '').toLowerCase().replace(/\s+/g, '-'),
    toKey: (raw.toKey || '').toLowerCase().replace(/\s+/g, '-'),
    relation: (raw.relation || '关联').slice(0, 8)
  }
}

function parseAIJson(raw: string): any {
  let text = raw.trim()
  if (text.startsWith('```')) {
    text = text.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '')
  }
  try { return JSON.parse(text) } catch {
    // 尝试提取第一个 JSON 对象
    const objMatch = text.match(/\{[\s\S]*\}/)
    if (objMatch) {
      try { return JSON.parse(objMatch[0]) } catch { /* fall through */ }
    }
    return null
  }
}
