/**
 * buildExtractPrompt — 纯函数构造 extractAll 的 AI prompt
 *
 * 把 combined-extractor.ts:152-240 的 prompt 字符串拼接抽到 packages/shared,
 * 三个原因:
 *   1. 单一职责: prompt 文本是数据, 不是 services 的实现细节
 *   2. 验证脚本可 import: scripts/verify-extract-prompt-split.mjs 直接 import
 *      此函数, 消除"prompt 镜像与生产代码漂移"风险
 *   3. 模式可切换: mode='full' 是当前行为, mode='slim' 去掉跨章注入,
 *      把 AI 职责收窄到"提取本章事实", 让跨章融合由独立 worker 负责
 *
 * 不做的事:
 *   - 不读数据库 / 不调 AI / 不写日志 (纯函数)
 *   - 不持有隐式状态 (所有输入通过参数传入)
 *
 * 设计原则:
 *   - 易读: prompt 模板是字符串拼接 + 显式占位符, 无隐式转换
 *   - 可扩展: 加新字段时只改 ExtractPromptInput 接口 + 对应模板段
 *   - 解耦: 不依赖任何 DB / AI provider / 业务 service
 */

export interface ExtractPromptInput {
  /** 主角名单 (来自 prisma.character.findMany where protagonist=true) */
  protagonistNames: string[]

  /** 已有实体 type:key 列表 (来自 graphNode.findMany) */
  existingNodeKeys: string[]

  /** N-1 全局图谱节点 (来自上一章 Chapter.graphSnapshot) */
  previousSnapshotNodes: Array<{
    type: string
    key: string
    label: string
    /** 可选 importance 1-10; buildFullPrompt 会按 desc 排序后取 top CAP */
    importance?: number
  }>

  /** 章节正文 (可能已被 truncateByParagraph 截断) */
  content: string

  /** 章节大纲 */
  outline?: string
}

export type ExtractPromptMode = 'full' | 'slim'

export interface BuildExtractPromptOptions {
  /**
   * 'full' — 喂入跨章上下文 (existingArcs + previousSnapshotNodes + existingNodeKeys)
   *          用于需要 AI 跨章推理的场景 (例如早期故事需要 AI 帮忙对齐 arc 命名)
   * 'slim' (default) — 不喂跨章上下文, AI 只输出本章事实;
   *          跨章融合由 organizeGraph / optimizeMemories / plotConsolidate 各自负责
   */
  mode?: ExtractPromptMode
}

/** N-1 inventory cap: 防 prompt 爆炸; 超出按 importance desc 截断 */
export const PREV_SNAPSHOT_INVENTORY_CAP = 500

/**
 * 构造 extractAll 调用的 prompt 字符串
 *
 * @param input 跨章上下文 + 本章正文
 * @param options.mode 'full' 喂跨章上下文; 'slim' (default) 不喂
 * @returns 完整 prompt 字符串, 直接喂给 RuntimePromptCompiler.compile
 */
export function buildExtractPrompt(
  input: ExtractPromptInput,
  options?: BuildExtractPromptOptions
): string {
  const mode: ExtractPromptMode = options?.mode ?? 'slim'

  if (mode === 'full') {
    return buildFullPrompt(input)
  }
  return buildSlimPrompt(input)
}

// ============================================================================
// Full mode — 当前 extractAll 行为, 喂入跨章上下文
// ============================================================================

function buildFullPrompt(input: ExtractPromptInput): string {
  let previousEntitiesBlock = ''
  if (input.previousSnapshotNodes.length > 0) {
    // 按 importance desc 排序, 高重要性节点优先进入 top-CAP; 无 importance 视为 0.
    // 这是 cap 行为正确的前提: 否则 slice(0, 500) 会保留 interleaved 前 250+250.
    const sorted = [...input.previousSnapshotNodes].sort((a, b) =>
      (b.importance ?? 0) - (a.importance ?? 0)
    )
    const trimmed = sorted.slice(0, PREV_SNAPSHOT_INVENTORY_CAP)
    const lines = trimmed.map(n => `- ${n.type}:${n.key} (${n.label})`)
    previousEntitiesBlock = `\n\n=== N-1 全局图谱中的实体清单（用于 key 复用） ===\n本故事 N-1 章后的图谱共有 ${input.previousSnapshotNodes.length} 个实体，请严格复用以下 type:key，禁止再造新 key：\n${lines.join('\n')}\n注意：N-1 没有出现的实体才允许创建新 key。新 key 必须用英文小写、下划线分隔。`
  }

  return `请分析以下小说章节，完成【记忆提取】和【实体关系提取】两个任务。返回严格 JSON 格式，不要 markdown 代码块，不要解释文字。

=== 严格 JSON 格式要求（不要违反，否则会解析失败）===
- 所有字段值必须是合法 JSON 值（数字、字符串、布尔、null、数组、对象）。绝对不要用 "&" 或 "..." 或 "etc" 之类占位符
- 字符串里的 "&" 必须转义为 "&"（或者直接用"和"代替）
- 数字字段（importance、progress 等）必须是 0-10 的整数或小数，不要用任何非数字字符
- 字段值如果不知道，请用 null 或空数组 []，不要用任何替代字符

=== 任务1：记忆提取 ===
提取对剧情有实质推动作用的信息。
本故事主角：${input.protagonistNames.join('、') || '无明确主角'}

每条事件必须包含：
- description: 简洁描述"有什么人做了什么"
- participants: 参与该事件的所有角色名单
- importance: 事件在本章的重要性（4~7）。如果事件有主角参与，请自行+1，最终为5~8。

importance 评分标准：
- 7: 本章核心转折/高潮，占大量篇幅
- 6: 重要推进，占中等篇幅
- 5: 有一定作用，占少量篇幅
- 4: 过渡/铺垫，篇幅很短

**严禁返回 0、-1 或其他负数作为 importance 占位符；不确定时按 5 处理。**

主角参与且达到 8 分的事件视为"主要事件"，放入 mainEvents；其他放入 sideEvents。

**重要：mainEvents 和 sideEvents 数组的顺序必须和事件在文章中的出现顺序完全一致，不能打乱，更不能把结尾的事件放到数组开头。**

事件格式示例：
{
  "description": "许青向姜禾解释现代社会的身份制度和法律危险",
  "participants": ["许青", "姜禾"],
  "importance": 6
}

提取字段：
- mainEvents: 主要事件（对象数组，每个对象包含 description / participants / importance）
- sideEvents: 次要事件（对象数组，格式同上）
- emotions: 主要角色情绪变化（字符串数组）
- foreshadowing: 新埋下的伏笔（字符串数组）
- relationshipChanges: 角色关系变化（字符串数组）
- characterStatusChanges: 角色状态变化（对象，如 {"张三": {"rank": "初级", "location": "北京", "relationships": {"李四": "兄弟", "王五": "敌对"}}}）。其中 relationships 子键可选，用于表达该角色与其他角色的关系变化。
- timelinePosition: 本章开篇时间锚点（**单小数点浮点数，编码 Y.DDDHH**：整数位 Y = 故事第 N 年（故事开始 = 第 1 年，前史/穿越用负数）；小数位必须**恰好 5 位** = DDDHH（3 位天 + 2 位小时），1 年固定 365 天、不区分大小月/闰年，对齐现实公历无意义；如无明确时间则小时段按 5 个范围兜底：早晨=06、中午=12、傍晚=18、夜里=22、凌晨=00；完全没有时间线索时按当章主要事件发生的时间段推断一个最接近的整点（小时）。**严禁返回 -1 占位；真正发生在过去就用负数年。**）
- timelineEvents: 本章内发生在不同时间点的事件（数组，每个元素包含 position 和 description；**必须返回**，**至少 1 个**即章首事件；章内跨多个明确时间点的情节应分别记录；position 用单小数点 Y.DDDHH 编码；description 简洁描述该时间点发生了什么；例：[{ "position": 1.00106, "description": "李凡清晨重伤醒来" }, { "position": 1.00112, "description": "李凡午时请教赵若曦" }, { "position": 1.00122, "description": "李凡夜里彻修炼功" }]）
- summary: 本章一句话摘要（50字以内）
- scenes: 推动剧情的关键地点（对象数组，如 [{ "location": "名称", "description": "场景描写（可选）", "event": "在此发生的事件概括", "importance": 1-10 }]）
  场景 importance 标准：7-10 核心剧情地点，4-6 有一定事件，1-3 路人提及/无实质事件

=== 任务2：实体与关系提取 ===
提取 importance >= 6 的核心实体和它们之间的关系：
- nodes: [{ type: "character"|"faction"|"event"|"item", key: "唯一标识（英文小写）", label: "显示名称", importance: 1-10, data: {...} }]
- edges: [{ fromKey, fromType, toKey, toType, relation, importance: 1-10 }]
  relation 应该是一个简洁的核心词或短语（2-6字为佳），直接表达两实体间的核心联系，不要带状语、从句或补充说明

=== 节点质量约束（重要）===
只提取能推动剧情发展的实体：
- 角色：仅当本章发生了状态变化（修为/位置/身份/阵营/关系）或剧情转折点
- 势力：仅当本章发生存亡/合并/对抗/结盟等变化
- 物品：仅当本章有归属变更、能力觉醒、用于关键事件
- 事件：仅当本章明确发生或被揭示
禁止提取：路人甲乙丙、纯环境描述、一次性对话提及、无后续影响的设定

已有实体（不要重复提取，但可补充新属性）：${input.existingNodeKeys.join(', ') || '无'}${previousEntitiesBlock}

注：剧情弧线分析由独立的 plot-consolidator worker 负责（它直接读章节 + existing arcs 做语义级判断），
本章不需要输出 plotArcs 字段。

=== 返回格式 ===
{
  "memories": { mainEvents, sideEvents, emotions, foreshadowing, relationshipChanges, characterStatusChanges, timelinePosition, timelineEvents, summary, scenes },
  "graph": { "nodes": [...], "edges": [...] }
}

章节大纲：${input.outline || '无大纲'}
章节内容如下：
${input.content}`
}

// ============================================================================
// Slim mode — 删除跨章注入, AI 只输出本章事实
// ============================================================================
//
// 删除三段 (vs full):
//   1. existingNodeKeys 拼接 ("已有实体..." 段)
//   2. previousEntitiesBlock (N-1 全局图谱清单)
//   3. existingArcsText (现有弧线列表)
//
// task3 字段对齐 PlotArcAnalysis schema, 但 prompt 文字强调:
//   - AI 不分析 arc 整体进度 (progress / status 由跨章 worker 处理)
//   - AI 不合并不同 arc (合并由跨章 worker 处理)
//   - 保留"主线 1 + 支线 ≤ 2"粒度约束 → 期望输出 1-2 条弧线
//
// 注意: slim 模式的 prompt 仍然要求 AI 输出完整 PlotArcAnalysis schema 字段
// (status / progress 仍存在), 但 prompt 文字说"如果不确定, status='active',
// progress=50 即可" — 跨章融合 worker 会重写这些字段。

function buildSlimPrompt(input: ExtractPromptInput): string {
  return `请分析以下小说章节，提取本章的事实信息（记忆 + 实体关系），用于后续跨章融合。返回严格 JSON 格式，不要 markdown 代码块，不要解释文字。

=== 严格 JSON 格式要求（不要违反，否则会解析失败）===
- 所有字段值必须是合法 JSON 值（数字、字符串、布尔、null、数组、对象）。绝对不要用 "&" 或 "..." 或 "etc" 之类占位符
- 字符串里的 "&" 必须转义为 "&"（或者直接用"和"代替）
- 数字字段（importance 等）必须是 0-10 的整数或小数，不要用任何非数字字符
- 字段值如果不知道，请用 null 或空数组 []，不要用任何替代字符

=== 任务1：记忆提取 ===
提取对剧情有实质推动作用的信息。
本故事主角：${input.protagonistNames.join('、') || '无明确主角'}

每条事件必须包含：
- description: 简洁描述"有什么人做了什么"
- participants: 参与该事件的所有角色名单
- importance: 事件在本章的重要性（4~7）。如果事件有主角参与，请自行+1，最终为5~8。

importance 评分标准：
- 7: 本章核心转折/高潮，占大量篇幅
- 6: 重要推进，占中等篇幅
- 5: 有一定作用，占少量篇幅
- 4: 过渡/铺垫，篇幅很短

**严禁返回 0、-1 或其他负数作为 importance 占位符；不确定时按 5 处理。**

主角参与且达到 8 分的事件视为"主要事件"，放入 mainEvents；其他放入 sideEvents。

**重要：mainEvents 和 sideEvents 数组的顺序必须和事件在文章中的出现顺序完全一致，不能打乱，更不能把结尾的事件放到数组开头。**

事件格式示例：
{
  "description": "许青向姜禾解释现代社会的身份制度和法律危险",
  "participants": ["许青", "姜禾"],
  "importance": 6
}

提取字段：
- mainEvents: 主要事件（对象数组，每个对象包含 description / participants / importance）
- sideEvents: 次要事件（对象数组，格式同上）
- emotions: 主要角色情绪变化（字符串数组）
- foreshadowing: 新埋下的伏笔（字符串数组）
- relationshipChanges: 角色关系变化（字符串数组）
- characterStatusChanges: 角色状态变化（对象，如 {"张三": {"rank": "初级", "location": "北京", "relationships": {"李四": "兄弟", "王五": "敌对"}}}）。其中 relationships 子键可选，用于表达该角色与其他角色的关系变化。
- timelinePosition: 本章开篇时间锚点（**单小数点浮点数，编码 Y.DDDHH**：整数位 Y = 故事第 N 年（故事开始 = 第 1 年，前史/穿越用负数）；小数位必须**恰好 5 位** = DDDHH（3 位天 + 2 位小时），1 年固定 365 天、不区分大小月/闰年，对齐现实公历无意义；如无明确时间则小时段按 5 个范围兜底：早晨=06、中午=12、傍晚=18、夜里=22、凌晨=00；完全没有时间线索时按当章主要事件发生的时间段推断一个最接近的整点（小时）。**严禁返回 -1 占位；真正发生在过去就用负数年。**）
- timelineEvents: 本章内发生在不同时间点的事件（数组，每个元素包含 position 和 description；**必须返回**，**至少 1 个**即章首事件；章内跨多个明确时间点的情节应分别记录；position 用单小数点 Y.DDDHH 编码；description 简洁描述该时间点发生了什么；例：[{ "position": 1.00106, "description": "李凡清晨重伤醒来" }, { "position": 1.00112, "description": "李凡午时请教赵若曦" }, { "position": 1.00122, "description": "李凡夜里彻修炼功" }]）
- summary: 本章一句话摘要（50字以内）
- scenes: 推动剧情的关键地点（对象数组，含 location/description/event/importance）

=== 任务2：实体与关系提取 ===
提取 importance >= 6 的核心实体和它们之间的关系：
- nodes: [{ type: "character"|"faction"|"event"|"item", key: "唯一标识（英文小写）", label: "显示名称", importance: 1-10, data: {...} }]
- edges: [{ fromKey, fromType, toKey, toType, relation, importance: 1-10 }]
  relation 应该是一个简洁的核心词或短语（2-6字为佳），直接表达两实体间的核心联系

=== 节点质量约束（重要）===
只提取能推动剧情发展的实体：
- 角色：仅当本章发生了状态变化或剧情转折点
- 势力：仅当本章发生存亡/合并/对抗/结盟等变化
- 物品：仅当本章有归属变更、能力觉醒、用于关键事件
- 事件：仅当本章明确发生或被揭示
禁止提取：路人甲乙丙、纯环境描述、一次性对话提及、无后续影响的设定

注：剧情弧线分析由独立的 plot-consolidator worker 负责（它直接读章节 + existing arcs 做语义级判断），
本章不需要输出 plotArcs 字段。

=== 返回格式 ===
{
  "memories": { mainEvents, sideEvents, emotions, foreshadowing, relationshipChanges, characterStatusChanges, timelinePosition, timelineEvents, summary, scenes },
  "graph": { "nodes": [...], "edges": [...] }
}

章节大纲：${input.outline || '无大纲'}
章节内容如下：
${input.content}`
}