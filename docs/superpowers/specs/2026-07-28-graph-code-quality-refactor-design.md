# 图谱代码质量重构设计

> **For agentic workers:** 待执行时调 `superpowers:writing-plans` 出实现 plan。

**Goal**: 提升图谱模块（cumulative-graph / graph-extract-stage / graph-snapshot）的稳健性与可维护性 —— 解耦、可读性、易扩展，删除 v2 死代码。

**Architecture**:
- 三个文件按职责拆：编排（cumulative-graph.ts）+ 共享别名（packages/shared）+ 私有 prompt 模板（services/stages/*.prompt.ts）
- 共享 JSON 字段别名机制抽到 `packages/shared/src/json-alias.ts`，server 端两个 stage 共用
- v2 死函数全删（`saveGraphSnapshotAndDelta`、`rebuildGraphFromSnapshot`、chapters-crud 中相关调用）
- 前端 GraphView 改读 v3 累计图谱 JSON 接口

**Tech Stack**: TypeScript (NodeNext 后端 / ESNext 前端)、Vue 3 + Naive UI、Fastify、Prisma、Vitest。

---

## 1. 背景

v3 累计图谱从 archive 阶段 AI 重建改为 user-maintained（`docs/LOGIC.md:353`），导致：

- `GraphNode` / `GraphEdge` Prisma 表 mark 为 `@deprecated v3 不再写入新数据`
- `graph-organizer.ts` / `combined-extractor.ts`（v2 archive 阶段）变成死代码
- `saveGraphSnapshotAndDelta`（写 v2 表 + chapter JSON 的合并函数）0 调用方
- `rebuildGraphFromSnapshot` 仅被 `chapters-crud.ts` 删章节路径调，但 v3 GraphView 重写完就不读 v2 表

本轮已完成 v3 累计图谱主要工作（`423b5e0` relation 归一映射），但代码层面仍混着 v2 残留和重复实现。本设计专注于清理。

---

## 2. 设计目标

1. **解耦**：extract / dedup 各文件的 prompt 模板、JSON 解析、纯函数操作分离
2. **可读性**：单个文件 ≤ 200 行，每个函数 ≤ 60 行，单一职责
3. **易扩展**：relation 归一策略可替换；JSON 字段别名可复用
4. **死代码删除**：明确 v2 vs v3 边界，删 v2 残留
5. **不靠兜底**：删除 AI 行为的隐式 fallthrough、删除未实现的 TODO 承诺

---

## 3. 模块边界

### 3.1 文件结构

```
packages/shared/src/
  json-alias.ts                       # 新增: 短/长字段别名 + aliasKey

apps/server/src/services/
  cumulative-graph.ts                 # 改: 编排 buildCumulativeGraph + 私有纯函数
  relation-mapping.prompt.ts          # 新增: dedup 阶段 AI prompt (从 cumulative-graph.ts 抽出)
  graph-snapshot.ts                   # 删 saveGraphSnapshotAndDelta / rebuildGraphFromSnapshot
                                       # 改 GraphNode/GraphEdge 注释更明显 deprecated
  stages/
    graph-extract-stage.ts            # 改: 编排 runGraphExtractStage + 私有纯函数
    graph-extract.prompt.ts           # 新增: extract 阶段 AI prompt (从 graph-extract-stage.ts 抽出)
    cumulative-graph-build-service.ts # 删 chapterNumber 字段

apps/server/src/__tests__/services/
  cumulative-graph.test.ts            # 保留 (3 个集成 case)
  cumulative-graph-utils.test.ts      # 新增: parseRelationMapping / applyRelationMapping / codeMerge / edge key 单测
  graph-extract-utils.test.ts         # 新增: parseGraphResponse / dropOrphanEdges / dedupEdgesByPair / buildGraphExtractPrompt 单测

apps/server/src/routes/
  chapters-crud.ts                    # 改: 删章节后删 rebuildGraphFromSnapshot 调用, 加 log

apps/web/src/
  components/graph/GraphView.vue      # 改: 读 /cumulative-graph 接口的 graph 字段
  components/graph/EditableGraph.vue  # 改: 删 importance: 5
  api/graph.ts                        # 改: 同步接口实现
```

### 3.2 依赖关系

- `cumulative-graph.ts` 依赖 `packages/shared/json-alias` 解析 AI 返回
- `stages/graph-extract-stage.ts` 依赖 `packages/shared/json-alias` 解析 AI 返回
- `relation-mapping.prompt.ts` 是 `cumulative-graph.ts` 的私有模块（仅被它 import）
- `graph-extract.prompt.ts` 是 `stages/graph-extract-stage.ts` 的私有模块（仅被它 import）

---

## 4. 行为不变的部分

- `buildCumulativeGraph` 主流程不变：取 prev + chapterGraph → AI dedup 输出 mapping → `applyRelationMapping` 重写两边 relation → `codeMerge` 按五元组 key 合并 → 返回
- `runGraphExtractStage` 主流程不变：拼 prompt → AI 返回 → normalize → dropOrphan → dedupByPair（每 unordered pair ≤ 2 条 distinct relation）→ 构 chapterGraph
- dedup 阶段 prompt 内容不变（`buildRelationMappingPrompt` 内部文案整体迁移到 `relation-mapping.prompt.ts`）
- extract 阶段 prompt 内容不变
- v3 累计图谱 build / save 路由行为不变

---

## 5. 关键决策

### 5.1 `parseRelationMapping` 删 fallthrough

**之前**:
```ts
for (const v of variants) {
  if (typeof v !== 'string') continue
  map.set(`${from}|${v}|${to}`, canonical)
}
// 兜底: 即使 variants 缺, from/to/canonical 自身也算一条
map.set(`${from}|${canonical}|${to}`, canonical)
```

**之后**:
```ts
for (const v of variants) {
  if (typeof v !== 'string') continue
  map.set(`${from}|${v}|${to}`, canonical)
}
// 不再设 fallthrough. AI 必须填 variants, 否则整条 mapping 跳过.
```

**理由**: fallthrough 跟 variants 设出的项可能产生意外（例：variants=["A"], canonical="B" → 设 "A|->B"；fallthrough 又设 "B|->B"）。删后 AI 必须写完整 mapping。**严格 AI 责任**。

### 5.2 `applyRelationMapping` 深拷

**之前**:
```ts
return { ...snapshot, edges: rewrittenEdges }
```

**之后**:
```ts
return {
  ...snapshot,
  nodes: snapshot.nodes.map(n => ({ ...n, data: { ...(n.data || {}) } })),
  edges: rewrittenEdges
}
```

**理由**: `nodes` 字段与原 snapshot 共享同一引用。AI 调用一旦未来修改 `node.data` 就会污染输入。深拷保证函数 immutable 语义。

### 5.3 `rebuildGraphFromSnapshot` 删除

- `chapters-crud.ts:197-209` 删章节后调 `rebuildGraphFromSnapshot` 的代码块删除
- 替换为一行 log：`app.log.info({ storyId, deletedChapterNumber: chapter.number, prevChapterNumber: prevChapter?.number }, 'v3 累计图谱以 Chapter.cumulativeGraph JSON 为准, 不重建 GraphNode/Edge 表')`
- `graph-snapshot.ts` 的 `rebuildGraphFromSnapshot` 函数定义删除
- `saveGraphSnapshotAndDelta` 同样删除（0 调用方）
- 保留 `GraphNode` / `GraphEdge` Prisma model 定义，schema 注释改为更明显 deprecated：
  ```
  /// @deprecated v3 不写不读. v3 GraphView 重写 (独立 commit) 完成后删除本 model.
  /// 见 docs/superpowers/specs/2026-07-28-graph-code-quality-refactor-design.md
  ```

**理由**: v3 累计图谱以 `Chapter.cumulativeGraph` JSON 为唯一 source-of-truth。删章节不再触发 GraphNode/Edge 表重建，避免 v2/v3 数据分叉。

### 5.4 `chapterNumber` 死字段删除

- `CumulativeGraphInput.chapterNumber` 删除（声明但函数体未读）
- `BuildAndSaveInput.chapterNumber` 删除
- `buildCumulativeGraphWithTimestamp` 透传行删除
- 上游调用方 `apps/server/src/routes/chapters-archive.ts` 不传 `chapterNumber`（已验证），无需改

**理由**: 死字段是 v2 路径残留。v3 累计图谱 build 不需要 chapterNumber。

### 5.5 `FIELD_ALIASES` + `aliasKey` 抽共享

**位置**: `packages/shared/src/json-alias.ts`

**API**:
```ts
export type FieldAliasMap = Record<string, string>

export function aliasKey<T = any>(
  obj: any,
  mapping: FieldAliasMap,
  long: string
): T | undefined

export const GRAPH_NODE_EDGES_ALIASES: FieldAliasMap  // n/e/t/k/l/d/ft/fk/tt/tk/r
export const RELATION_MAPPING_ALIASES: FieldAliasMap   // mappings/f/t/v/c
```

**调用侧**:
- `cumulative-graph.ts` 用 `RELATION_MAPPING_ALIASES`
- `stages/graph-extract-stage.ts` 用 `GRAPH_NODE_EDGES_ALIASES`

**理由**: 两文件各维护一份 ~30 行的 aliasKey 重复实现，逻辑完全一样。抽到 `packages/shared` 是合理的，因为前端未来读 `cumulativeGraph` JSON 也可能需要兼容老字段。

### 5.6 `graph-extract-stage.ts` 拆 4 个纯函数

```
parseGraphResponse(parsed: any): { nodes, edges }
  // 短字段名归一化, 过滤非法, 映射 type/key/label/data/from*/to*/relation
  // 边 weight 永远 1

dropOrphanEdges(nodes, edges): edges
  // 过滤 endpoint 不在 node set 的边, log drop 数量

dedupEdgesByPair(edges, maxPerPair=2): edges
  // 按 unordered pair 聚合, 排序 weight desc, 选不同 relation 最多 N 条
  // log dedup 数量

buildGraphExtractPrompt(input): string
  // 拼 6 段 prompt (任务/实体与关系/提取规则/已有实体/章节内容/输出格式)
  // 抽到 services/stages/graph-extract.prompt.ts
```

`runGraphExtractStage` 编排：
1. 拼 prompt
2. AI 调用 + retry
3. `parseGraphResponse` → `{ nodes, edges }`
4. `dropOrphanEdges`
5. `dedupEdgesByPair`
6. 构 chapterGraph 返回

### 5.7 `cumulative-graph.ts` 抽 prompt 模板

`buildRelationMappingPrompt(prev, chapterGraph)` 内部 60 行模板字符串 → `relation-mapping.prompt.ts` 导出 `buildRelationMappingPrompt`。`cumulative-graph.ts` 改为 import + 调，不在文件内嵌模板。

### 5.8 `GraphView.vue` 改读 v3 接口

**之前** (`graphApi.getSnapshot(chapterId)`):
- 读 `data.snapshot.nodes/edges` 和 `data.delta.nodes/edges`（v2 字段名）

**之后** (`cumulativeGraphApi.get(chapterId)`):
- 读 `data.graph.nodes/edges`（v3 字段名）
- `viewMode='snapshot' | 'delta'` 保留，逻辑不变（snapshot 视图显示累计，delta 视图显示 chapterGraph 自身）
- diff 计算（`computeNewIds` / `diffStats`）保持不变

**配套修改**:
- `api/graph.ts` 删 `getSnapshot` / `getDelta`，或保留 stub 标 deprecated
- `api/cumulative-graph.ts` 已存在，类型 `GraphSnapshot` 与 server 端对齐（`weight?: number` vs `weight: number` 不一致 —— 统一为 `weight: number`）

### 5.9 `EditableGraph.vue` 删 `importance: 5`

`handleCreateNode` 创建节点对象时删除 `importance: 5` 字段。`GraphNodeSnapshot` 接口本身也不含该字段，前后端一致。

---

## 6. 不在本设计范围

- `GraphNodeSnapshot.weight` 字段（保留 TODO，不动）
- `expandNeighborhood` / `defaultTokenEstimator` 的 "estimation vs validation" 注释里承诺的 validate（不实现，保留 TODO 注释描述）
- `graph-organizer.ts` / `combined-extractor.ts` v2 archive 路径（暂留，等 v3 GraphView 重写完一起删）
- `EditableGraph.vue` 用户手输 relation 字面是否被 dedup 改写（保持现状"AI 一致性"行为）
- `CumulativeGraphResult.aiCalled` 字段（保留，路由层可能用）
- `applyRelationMapping` / `parseRelationMapping` 的入参 `any` 类型（暂不抽 interface，保持灵活）

---

## 7. 测试

### 7.1 集成测试（保留）

- `cumulative-graph.test.ts` 3 个 case：
  - 空 chapterGraph 继承 prev
  - 首章直接用 chapterGraph
  - AI 返回 mapping → 应用 → 合并

### 7.2 新增单测

**`cumulative-graph-utils.test.ts`** (新增):
- `parseRelationMapping`:
  - 合法 mapping 设 map
  - variants 缺 → 跳过整条
  - canonical 缺 → 跳过
  - 字段类型错 → 跳过
  - 多 mapping 同 from/to 不冲突
  - **无 fallthrough 测试**（之前 fallthrough 行为不写测试）
- `applyRelationMapping`:
  - 空 mapping 不重写（返回原 snapshot 引用）
  - 单条命中重写 relation
  - 多 variants 命中
  - canonical == 原值仍写新对象（immutable）
  - 深拷 nodes（修改原 snapshot 不影响新对象）
- `codeMerge`:
  - weight 累加（prev + chapterGraph 各 1 → 2）
  - 五元组 key 一致（relation 字面变 → 不同边）
  - 新边 weight=1
  - 节点按 type:key 去重

**`graph-extract-utils.test.ts`** (新增):
- `parseGraphResponse`:
  - 短字段名解析
  - 长字段名 fallback
  - 缺 type/key 过滤
  - label 缺 fallback 到 key
  - data 缺或非对象 → 空对象
- `dropOrphanEdges`:
  - 端点都在 → 不 drop
  - 端点缺 → drop 并 log 数量
- `dedupEdgesByPair`:
  - 同 unordered pair 选 top 2 distinct relation
  - 同 pair 多 weight 取 weight desc
  - 跨 pair 不互相影响
- `buildGraphExtractPrompt`:
  - 包含 6 段标题
  - 包含 keyList 预过滤
  - schema 示例用短字段名

### 7.3 端到端验证

- `pnpm typecheck` 通过
- `pnpm vitest run` 全过
- `pnpm lint` 通过（如有）
- 手动触发：ch#3 重跑 build 累计图谱 → GraphView 读 `Chapter.cumulativeGraph` JSON → 验证合并效果不变

---

## 8. 风险与回退

- **风险 1**: `parseRelationMapping` 删 fallthrough 后，AI 写不完整 mapping 会导致无归一 → 累计图可能再出现 relation 漂移
  - **缓解**: 现有 `buildRelationMappingPrompt` 明确要求 AI 写 `variants` 数组；测试覆盖 AI 写非法 mapping 的处理
- **风险 2**: `applyRelationMapping` 深拷引入微性能损失
  - **缓解**: 单章累计图节点数 < 200，深拷开销 < 1ms，可忽略
- **风险 3**: 前端 `GraphView.vue` 改接口字段名，可能影响旧实现边界
  - **缓解**: 改前 grep 验证 `data.snapshot` / `data.delta` 无其他读取方；改后 typecheck + lint 通过

回退：每个 task 独立 commit，按文件 revert。

---

## 9. 任务分解（待 writing-plans 细化）

1. 抽 `packages/shared/src/json-alias.ts` + 两文件切换
2. `cumulative-graph.ts` 拆 `relation-mapping.prompt.ts` + 删 fallthrough + 加深拷
3. `graph-extract-stage.ts` 拆 4 个纯函数 + `graph-extract.prompt.ts`
4. 加 `cumulative-graph-utils.test.ts` + `graph-extract-utils.test.ts`
5. 删 `saveGraphSnapshotAndDelta` / `rebuildGraphFromSnapshot` + `chapters-crud.ts` 调用
6. 删 `chapterNumber` 字段（两处）
7. 前端 `GraphView.vue` 改读 v3 接口
8. 前端 `EditableGraph.vue` 删 `importance: 5`
9. 改 `GraphNode/GraphEdge` Prisma 注释
10. typecheck + 全测试通过
