export interface BuildGraphExtractPromptInput {
  content: string
  characterNames: string[]
  prevCumulativeGraphNodes: Array<{ type: string; key: string; label: string }>
}

/**
 * 私有 prompt 模板: 本章实体和关系抽取。
 *
 * keyList 按 chapter content 预过滤（仅 label 出现在正文的实体）,
 * AI 必须复用其 type:key（锚定历史），否则不能引入新 key；
 * character/faction/item 类型节点优先复用 characterNames。
 */
export function buildGraphExtractPrompt(input: BuildGraphExtractPromptInput): string {
  const content = input.content || ''
  const matchedNodes = input.prevCumulativeGraphNodes.filter(
    (n) => n.label && content.includes(n.label)
  )
  const keyList = matchedNodes.length
    ? matchedNodes.map((n) => `${n.type}:${n.key}`).join(', ')
    : '（空，本章可自由起 key）'

  return `【任务】
分析章节内容，提取对剧情有实质推动作用的核心实体和它们之间的关系。

【实体与关系定义】
- type 可选值：character(角色), faction(势力/组织), event(事件), item(物品/道具)
- relation 建议值：隶属、对抗、师徒、配偶、兄弟、持有、发生地点、涉及
- relation 应是简洁的核心词或短语（2-6字为佳），直接表达两实体间的核心联系，不要带状语、从句或补充说明

【提取规则】
1. 【主线事件合并】同一主线剧情链的连续事件必须合并为一个整体事件节点。例如"许青找食材→下厨炒菜→姜禾品尝→指点厨艺"应合并为一个事件节点"许青教姜禾厨艺"，而不是拆成多个事件。
2. 【支线独立】与主线并行的独立支线（如第三方暗中观察、配角个人线）可以作为独立事件节点。
3. 【角色优先】主角和重要配角必须提取；路人、一次性提及的次要角色不要提取。
4. 【物品克制】只提取对剧情有实质推动的关键物品（主角佩剑/关键道具/信物），日常用品（餐具/衣物/家电/家具/书籍）不要提取，即便主角日常使用也不算关键物品。
5. 【事件 label 简短】label 只给图谱节点显示用, 4-8 字概括核心动作, 不堆叠人名; 不要写"许青收留姜禾并安置起居"这类含多动作的复合句, 详细情节放 data.desc。

【已有实体】（不要重复提取，但可补充新属性）：${keyList}

【章节内容】
${input.content}

【输出格式】
返回严格 JSON 格式，不要 markdown 代码块。**严格用下方短名**，不要用长名：

字段映射：n=nodes, e=edges, t=type, k=key, l=label, d=data, ft=fromType, fk=fromKey, tt=toType, tk=toKey, r=relation

{
  "n": [
    { "t": "character", "k": "xu_qing", "l": "许青", "d": { "role": "本章主角,应届毕业生" } },
    { "t": "faction", "k": "yan_bang", "l": "盐帮", "d": { "location": "古代江湖" } },
    { "t": "event", "k": "jiang_he_chuan_yue", "l": "姜禾穿越", "d": { "desc": "姜禾从古代穿越到现代,出现在许青家中,持有盐帮佩剑" } }
  ],
  "e": [
    { "ft": "character", "fk": "xu_qing", "tt": "character", "tk": "jiang_he", "r": "收留" }
  ]
}`
}
