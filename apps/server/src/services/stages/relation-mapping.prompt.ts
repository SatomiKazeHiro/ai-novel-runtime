import type { GraphSnapshot } from '../graph-snapshot.js'

/**
 * 私有 prompt 模板: 关系字面归一映射。
 *
 * AI 看完"全局累计图边"+"本章图谱边",输出一份 relation 归一映射表 (mappings)。
 * 不输出图谱,只输出 mapping —— 程序会按 mapping 重写累计图里所有 relation 字面,
 * 再用统一字面合并。
 *
 * 业务动机(2026-07-28):
 *   跨章节 AI 抽取的 relation 字面会漂移(同一段关系,不同章节写法不同)。
 *   codeMerge 按 ${from}|${relation}|${to} 五元组去重, 字面不同时直接失败。
 *   让 AI 显式输出字面归一映射,程序 apply 后 codeMerge 自然命中, weight 累加正确。
 */
export function buildRelationMappingPrompt(
  prev: GraphSnapshot,
  chapterGraph: GraphSnapshot
): string {
  return `你是小说知识图谱 relation 字面归一助手。

【任务】
基于"全局累计图(全部历史章节)边"和"本章图谱边",输出一份 relation 归一映射表(mapping)。
不输出图谱,只输出 mapping —— 程序会按 mapping 重写累计图里所有 relation 字面,再用统一字面合并。

【核心思路】
跨章节 AI 抽取的 relation 字面会漂移(同一段关系,不同章节写法不同)。例:
- ch#1: character:xu_qing -[收留/决定帮助]-> character:jiang_he
- ch#2: character:xu_qing -[收留并帮助]-> character:jiang_he
- ch#3: character:xu_qing -[收留]-> character:jiang_he
这三条字面不同,程序无法合并(按 from+relation+to 五元组去重失败)。
归一后全部映射到 "收留" 这一字面,程序自然合并, weight 累加。

【方向感知】
按 (fromType:fromKey → toType:toKey) 有序对处理,A→B 与 B→A 是两个独立关系,分别归一。
例: character:xu_qing → character:jiang_he 与 character:jiang_he → character:xu_qing 各自有自己的 variants 和 canonical。

【归一策略(同一有序对内的多条 relation)】
1. 【同义】字面或释义重复 → 合并为一个最简洁字面
   例: 收留/决定帮助 / 收留并帮助 / 决定帮助 / 收留 → 收留
2. 【升级】前后章存在阶段递进(关系强度由弱到强)→ 合并到终点状态
   例: 同事 / 恋人 / 夫妻 → 夫妻
   例: 师徒 / 仇敌 → 仇敌
3. 【反转】前后章关系性质反向 → 合并到反映剧情转折的那条
   例: 被刺 / 弃暗投明 → 弃暗投明
   例: 隶属 / 叛逃 → 叛逃
4. 字面差异明显、无法判断同义/升级/反转 → 不要输出这条 mapping,程序会保留原字面

【weight 字段】
代码内部用,不需要你处理。mapping 表里不要带 weight。

【累计图(全部历史边)】
${JSON.stringify({ edges: prev.edges })}

【本章图谱(全部边)】
${JSON.stringify({ edges: chapterGraph.edges })}

【输出格式】
返回严格 JSON,不要 markdown 代码块。

{
  "mappings": [
    {
      "from": "character:xu_qing",
      "to": "character:jiang_he",
      "variants": ["收留/决定帮助", "收留并帮助", "收留"],
      "canonical": "收留"
    },
    {
      "from": "character:jiang_he",
      "to": "character:xu_qing",
      "variants": ["被收留/戒备与初步信任", "初步信任并依赖"],
      "canonical": "依赖"
    }
  ]
}

没有需要归一的关系时, mappings 返回空数组 []。`
}
