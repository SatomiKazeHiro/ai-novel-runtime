# Graph Neighborhood Retrieval 设计

> **状态:** 待用户 review
> **目标:** 治本 graph_organize 输入侧 token 超限，避免每次归档都把 N-1 全图塞给 AI 合并。
> **取代:** 早前被否决的"embedding + cosine 相似度 + Plan C 回退"思路。

## 1. 背景

archive phase 2（`apps/server/src/services/graph-organizer.ts`）当前把"上一章全局图谱"和"本章新提取的节点/边"全量拼进 prompt 喂给 AI。节点数随章节数线性增长 O(N)，到第 30~50 章时 prompt 已逼近 64k 上下文上限：

- 现象：AI 返回被 maxTokens 截断 → JSON 不闭合 → `cleanJsonBlock` 抛"未闭合"
- Phase 1 临时把 `maxTokens: 8192 → 16384` 顶住，但治标不治本，节点再多还是会爆

用户给出的方向（2026-06-17）：

> N 章提取的图谱节点 → 拿这些节点去 N-1 图谱里匹配 → 取匹配节点的 2 层邻居 → 把"本章新节点 + 匹配到的局部子图"喂给 AI 合并。
> 不需要 embedding，也不需要 Plan C 回退。
> 2 层邻居要按模型剩余上下文动态算 token 预算，超过就截断。
> 节点要严格控制质量：能推动剧情发展的人物状态变化 / 关系转折点才要，脏节点禁止。

## 2. 目标 & 非目标

### 2.1 目标

1. **输入侧控量**：archive phase 2 的 prompt token 数从 O(全图) 降到 O(本章 + 2-hop 邻域)，与总章节数解耦
2. **质量内生**：在 combined_extract 阶段就约束节点和边的产出，减少脏数据进图谱
3. **零 embedding 依赖**：复用图谱自身结构（type:key 完全匹配），不引入新基础设施
4. **零 Plan C**：不引入代码合并路径的二级兜底；要么 AI 合并，要么跳过 AI（matchedKeys=0 时）

### 2.2 非目标

- 不重构 graph_organize 的 prompt 结构（保留 AI 整理语义）
- 不改 chapterGraph 的生成方式（仍由 AI 独立整理）
- 不引入图数据库 / 向量数据库
- 不改 schema
- 不动前端

## 3. 架构

### 3.1 数据流

```
┌─────────────────────────────────────────────────────────────────┐
│ archive phase 1: combined_extract（apps/server/src/services/   │
│ combined-extractor.ts:extractAll）                              │
│                                                                 │
│   输入:                                                         │
│     - 章节正文 + 大纲                                           │
│     - 【新】N-1 实体清单（type+key+label，从 graphSnapshot 提取）│
│                                                                 │
│   输出:                                                         │
│     memories, graph(节点+边), plotArcs                          │
│     【新】边增加 importance 字段                                │
│     【新】prompt 约束节点质量（人物状态/关系转折点）             │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│ archive phase 2: graph_organize（apps/server/src/services/      │
│ graph-organizer.ts:organizeGraph）                              │
│                                                                 │
│   Step A. key 匹配                                              │
│     - 输入: 本章 extractedGraph.nodes + N-1 GraphSnapshot       │
│     - matchedKeys = 本章节点 key ∩ N-1 节点 key                 │
│                                                                 │
│   Step B. 2-hop BFS（apps/server/src/services/graph-snapshot.ts│
│   新增 export async function expandNeighborhood）                │
│     - 从 matchedKeys 在 N-1 节点集上做 BFS，深度 2              │
│     - 收集到的节点 + 涉及的边 = 邻域子图                        │
│                                                                 │
│   Step C. 动态 token 预算                                       │
│     - 预算 = contextLength - maxTokens(输出) - 其它 prompt 占用 │
│       - SAFETY_MARGIN(2000)                                    │
│     - 按 BFS 顺序逐节点加入，超预算则停                         │
│     - 软上限 MAX_ENTITIES=200（防御性，再多就截）                │
│     - 占用率 ≥ 90% 打 app.log.warn（带 TODO 标记）              │
│                                                                 │
│   Step D. 拼 prompt                                             │
│     - "上一章邻域子图" = 截断后的 N-1 节点 + 涉及边              │
│     - "本章新提取" = 不变                                       │
│     - 上下文给 AI：邻域足够用来合 mergedGraph，本章新节点可作   │
│       为新 key 加入                                              │
│                                                                 │
│   特殊路径: matchedKeys 为 0                                     │
│     - 跳过 AI，直接代码合并: mergedGraph =                      │
│       uniqueByKey(N-1 节点 ∪ 本章节点) + N-1 边 ∪ 本章新边       │
│     - chapterGraph 仍由 AI 处理（但本章无新节点时直接用         │
│       extractedGraph 透传）                                     │
└─────────────────────────────────────────────────────────────────┘
```

### 3.2 变更范围

| 文件 | 变更 | 类型 |
|------|------|------|
| `apps/server/src/services/combined-extractor.ts` | extractPrompt 增加 N-1 实体清单注入段、节点质量约束段、边 importance 字段说明 | 修改 |
| `apps/server/src/services/graph-organizer.ts` | 拆 organizeGraph 内部：先 key 匹配 + expandNeighborhood + 动态预算，再拼 prompt。matchedKeys=0 走代码合并路径 | 重构（行为变化） |
| `apps/server/src/services/graph-snapshot.ts` | 新增 `expandNeighborhood(snapshot, matchedKeys, options): { nodes, edges }` 纯函数 | 新增函数 |
| `apps/server/src/__tests__/graph-snapshot-expandNeighborhood.test.ts` | 单元测试：1-hop / 2-hop / 边修剪 / 预算截断 / 软上限 | 新增 |
| `apps/server/src/__tests__/graph-organizer-neighborhood.test.ts` | 集成测试：matchedKeys=0 走代码合并 / 正常走 AI 路径 / 预算超限截断 | 新增 |
| `apps/server/src/__tests__/combined-extractor-prompt.test.ts` | 验证 extractPrompt 文本包含 N-1 实体清单段和节点质量约束段 | 新增 |

**非变更**：

- `prisma/schema.prisma` — GraphNode/GraphEdge/GraphSnapshot 字段不变
- `packages/*` — AI provider / prompt runtime / memory engine 不动
- `apps/server/src/routes/chapters.ts` — archive 路由不变（只 call `organizeGraph`）
- `apps/web/**` — 前端零改动

## 4. 详细设计

### 4.1 N-1 实体清单注入（combined_extract）

在 `extractAll` 的 `extractPrompt` 中新增一段，紧跟"已有实体"行：

```
=== N-1 全局图谱中的实体清单（用于 key 复用） ===
本故事 N-1 章后的图谱共有 X 个实体，请严格复用以下 type:key，禁止再造新 key：
- character:zhangsan (张三)
- character:lisi (李四)
- faction:qingmeng (青盟)
- item:taijijian (太极剑)
- event:battle_001 (青云山之战)
...
注意：N-1 没有出现的实体才允许创建新 key。新 key 必须用英文小写、下划线分隔。
```

注入方式：

- 数据源：调用 `organizeGraph` 前一章的 `Chapter.graphSnapshot`（TEXT 字段，JSON.parse 还原成 `GraphSnapshot`）
- 取数逻辑：仅取 `nodes[].type`、`nodes[].key`、`nodes[].label`、`nodes[].importance`（如有），不要 data 详情
- 上限：N-1 实体数 ≤ 500 时全注入；> 500 时按 importance 降序截到 500（防御 N-1 本身就爆）
- 注入位置：`extractAll` 内 `extractPrompt` 字符串模板新增一段

### 4.2 节点质量约束

在 extractPrompt 的"任务2"段增加：

```
=== 节点质量约束（重要）===
只提取能推动剧情发展的实体：
- 角色：仅当本章发生了状态变化（修为/位置/身份/阵营/关系）或剧情转折点
- 势力：仅当本章发生存亡/合并/对抗/结盟等变化
- 物品：仅当本章有归属变更、能力觉醒、用于关键事件
- 事件：仅当本章明确发生或被揭示
禁止提取：路人甲乙丙、纯环境描述、一次性对话提及、无后续影响的设定
```

### 4.3 边 importance 字段

在 extractPrompt 的"任务2"输出格式中：

```json
edges: [
  { "fromKey", "fromType", "toKey", "toType", "relation", "importance": 1-10 }
]
```

`importance` 反映该边在本章对剧情的推动作用（5-8 为重要，<5 噪声边建议不提取）。

### 4.4 expandNeighborhood（graph-snapshot.ts 新增）

```typescript
export interface ExpandOptions {
  /** BFS 深度。0=只 matchedKeys 自身，1=直接邻居，2=邻居的邻居 */
  maxDepth: number
  /** token 预算上限。超预算时按 BFS 顺序截断 */
  maxTokens: number
  /** 软上限 entity 数（含 matched 起点）。超过则截断 */
  maxEntities?: number
  /** 简易 token 估算：每实体按 label + data JSON 长度 / TOKEN_PER_CHAR 估算 */
  tokenEstimator?: (node: GraphNodeSnapshot) => number
}

export interface NeighborhoodResult {
  nodes: GraphNodeSnapshot[]
  edges: GraphEdgeSnapshot[]
  /** 被截断时为 true（含预算超限 / 软上限触发） */
  truncated: boolean
  /** 触发的截断原因 */
  truncateReason?: 'token_budget' | 'max_entities' | 'max_depth'
  /** 实际消耗 token 估算 */
  estimatedTokens: number
}

export function expandNeighborhood(
  snapshot: GraphSnapshot,
  matchedKeys: string[],   // type:key 形式
  options: ExpandOptions
): NeighborhoodResult
```

实现要点：

- BFS 用 `Set<string>` 记录已访问 `type:key`
- 邻接表预构建：`Map<string, Array<{edge, otherKey}>>`
- 边修剪：只保留两端节点都被加入集合的边
- token 估算默认值：`Math.ceil((label.length + JSON.stringify(data).length) / 4)`
- 返回值按 BFS 顺序（matchedKeys 优先，深度优先）

### 4.5 organizeGraph 主流程重构

新流程伪代码：

```typescript
async function organizeGraph(app, storyId, chapterId, previousSnapshot, extractedGraph) {
  // 1. key 匹配
  const prevKeys = new Set(previousSnapshot?.nodes.map(n => `${n.type}:${n.key}`) || [])
  const newKeys = new Set(extractedGraph.nodes.map(n => `${n.type}:${n.key}`))
  const matchedKeys = [...newKeys].filter(k => prevKeys.has(k))
  
  // 2. 特殊情况：matchedKeys=0 → 跳过 AI，代码合并
  if (matchedKeys.length === 0) {
    return codeMergeAndOrganize(previousSnapshot, extractedGraph)
  }
  
  // 3. 2-hop 邻域扩展
  const budget = computeRemainingBudget(app, storyId, chapterId)
  const neighborhood = expandNeighborhood(
    previousSnapshot ?? { nodes: [], edges: [], timestamp: '' },
    matchedKeys,
    { maxDepth: 2, maxTokens: budget, maxEntities: 200 }
  )
  
  if (neighborhood.truncated) {
    app.log.warn(
      `[TODO][GraphOrganizer] Neighborhood truncated (${neighborhood.truncateReason}), ` +
      `used ${neighborhood.estimatedTokens} / ${budget} tokens, ` +
      `${neighborhood.nodes.length} nodes. ` +
      `Consider increasing contextLength in ModelManager.`
    )
  }
  
  // 4. 拼 prompt（替换原"上一章全局图谱"段为"邻域子图"）
  const organizePrompt = buildOrganizePrompt(neighborhood, extractedGraph)
  
  // 5. 调 AI（逻辑不变）
  const raw = await callAIWithLog(app, { ..., callType: 'graph_organize', maxTokens: 16384 })
  ...
}

function codeMergeAndOrganize(prev, extracted) {
  // mergedGraph: 节点去重（type:key）合并；边并集去重
  // chapterGraph: 本章 extractedGraph 透传（无新节点时）或 AI 整理（有新节点时）
  return { mergedGraph, chapterGraph }
}

function computeRemainingBudget(app, storyId, chapterId) {
  // 从 resolveProvider 拿 aiConfig.contextLength 和 aiConfig.maxTokens
  // 预算 = contextLength - maxTokens(输出预留) - SAFETY_MARGIN(2000)
  // 简化的"其它 prompt 占用"暂时不扣除（实测 systemMessage+非图 userMessage
  //   ≈ 5k~10k tokens，留 SAFETY_MARGIN 兜底；后续可精细化）
  // TODO(精细化): 减去 compiled.userMessage 中非图部分的 token 估算
}
```

### 4.6 matchedKeys=0 路径的 chapterGraph 处理

`codeMergeAndOrganize` 不调 AI，整体走代码：

- `mergedGraph.nodes` = `previousSnapshot.nodes ∪ extractedGraph.nodes`，按 `type:key` 去重
- `mergedGraph.edges` = `previousSnapshot.edges ∪ extractedGraph.edges`，按 `(fromType:fromKey, relation, toType:toKey)` 去重
- `chapterGraph` = 直接透传 `extractedGraph`（带新 timestamp），不调 AI 整理

理由：matchedKeys=0 说明本章提取的实体在 N-1 图谱里没有重合，AI 没有"历史邻域"作为参照，整理 chapterGraph 收益极低（chapterGraph 本来就只反映本章）。这是"零匹配时的退化"路径，不是常规路径；常规路径（matchedKeys > 0）仍走 AI 整理 chapterGraph。

### 4.7 边合并规则（在 organizeGraph prompt 中保留）

按用户原话：

- 同对节点多个 relation → 合并为一条核心 relation
- 例：`["道侣,信任和恩爱", "师弟,协助", "师姐,帮助"]` → `"道侣,信任和恩爱、互相帮助"`
- 语义不同的独立情况保留为多条边
- 例：基础"道侣，信任和恩爱"之外出现"假装背叛" → 两条边都保留
- 此规则在 prompt 中已经存在（graph-organizer.ts:39-42），本次改造不调整

## 5. 错误处理

| 场景 | 行为 |
|------|------|
| previousSnapshot 为 null | expandNeighborhood 输入空 snapshot → 返回空邻域 → 等价于 matchedKeys=0 路径（但实际可能 matchedKeys 非 0）→ 仍调 AI，prompt 写"无上一章图谱" |
| matchedKeys=0 | 走 codeMergeAndOrganize，不调 AI，零 API 消耗 |
| 邻域 token 超限 | expandNeighborhood 截断 + warn log，AI 仍调（用户已知晓） |
| 邻域超 MAX_ENTITIES=200 | 截断 + warn log，AI 仍调 |
| AI 返回格式错 | 走 existing 抛错逻辑（已带 retry 兜底） |
| 解析失败重试仍失败 | 抛错透传到路由（行为不变） |

## 6. 测试计划

### 6.1 单元测试

`apps/server/src/__tests__/graph-snapshot-expandNeighborhood.test.ts`：

- 1-hop 邻居正确（深度 1）
- 2-hop 邻居正确（深度 2）
- matchedKeys 在 snapshot 中不存在 → 返回空
- 边修剪：孤立边（有一端未访问）被丢弃
- token 预算超限 → truncated=true，节点数减少
- maxEntities 软上限触发 → truncated=true
- maxDepth=0 → 只返回 matchedKeys 自身

### 6.2 集成测试

`apps/server/src/__tests__/graph-organizer-neighborhood.test.ts`：

- matchedKeys=0 路径：mergedGraph = 代码合并结果，AI 未被调用
- 正常路径：AI 被调用 1 次，prompt 中"上一章图谱"段是邻域子图 JSON 而非全图
- 预算超限路径：expandNeighborhood 返回 truncated=true，AI 仍被调用，log 含 TODO 标记
- previousSnapshot=null 路径：不抛错，prompt 含"无上一章图谱"

`apps/server/src/__tests__/combined-extractor-prompt.test.ts`：

- extractPrompt 包含 N-1 实体清单段（mock 注入清单后断言）
- extractPrompt 包含节点质量约束段
- extractPrompt 边说明含 importance 字段

## 7. 风险与权衡

### 7.1 已知风险

- **简化预算估算**：`computeRemainingBudget` 当前不扣除"其它 prompt 占用"，留 SAFETY_MARGIN=2000 兜底。如果 systemMessage + 非图 userMessage > 5k tokens 实际可能撞墙。**缓解**：保留 `TODO(精细化)` 注释；prompt runtime 后续如果暴露 `compiled.meta.totalTokens` 可直接用上。
- **chapterGraph 退化**：matchedKeys=0 且 extractedGraph 有新节点时，codeMergeAndOrganize 用 extractedGraph 透传 chapterGraph，AI 失去"基于本章独立整理 chapterGraph"的机会。**接受**：此场景仅出现在 N=1（首次归档）或全 key 漂移（极小概率），质量影响有限。
- **MAX_ENTITIES=200 软上限**：极端宽邻域被截断。**缓解**：2-hop BFS 在 64k 上下文下通常不会超；截断时打 warn log，运维可调 contextLength。

### 7.2 显式不做的事

- 不加 importance 排序的精细 BFS 优先队列（先 matched，再 1-hop，再 2-hop 已够用）
- 不做边的语义相似度去重（保留 AI 在合并阶段处理，符合"AI 整理"语义）
- 不加新记忆条目（不污染 Memory 表）

## 8. 上线 checklist

- [ ] Task #55 写实现计划（writing-plans skill）
- [ ] 子任务 1：expandNeighborhood 纯函数 + 单元测试
- [ ] 子任务 2：combined-extractor prompt 三段增强
- [ ] 子任务 3：organizeGraph 重构（key 匹配 + 邻域 + 动态预算 + codeMerge 路径）
- [ ] 子任务 4：集成测试覆盖三条路径
- [ ] 子任务 5：`pnpm typecheck && pnpm test` 全绿
- [ ] 子任务 6：手动跑一次归档验证（30+ 章数据观察 prompt log token）

## 9. 关联

- 取代: [[prioritize-robustness-over-speed]]（避免堆功能 → 改治本而非加兜底）
- 引用: [[ai-must-read-plan-test-cross-module]]（本次涉及 combined-extractor + graph-organizer + graph-snapshot 三处，跨模块影响需在 plan 中显式说明）
- 前置: Task #54（Phase 1 maxTokens 提升）保证 phase 2 改造期间不至于立刻爆
- 后续: 若 expandNeighborhood 暴露工具方法给其他模块（如章节检索/调试），可独立迭代
