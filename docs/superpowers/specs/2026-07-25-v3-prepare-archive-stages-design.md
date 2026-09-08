# v3 Prepare-Archive Stages 解耦 Design Spec

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把"准备归档"流程拆成 4 个独立 stage（角色 / 记忆 / 剧情弧线 / 本章图谱），每个 stage 有独立 status、错误展示、失败原因。把图谱生成从单一黑盒拆成"本章图谱（gacha）+ 全局图谱（累计去重）"两阶段。删除 archive 流程中的所有锁（atomic updateMany），仅靠状态机 + UI 按钮 disabled 防止双击。新增"撤销审查"端点，无需删除章节即可回退到 draft。

**Architecture:** 单分支 `v3/prepare-archive-stages`。后端在 `apps/server/src/services/stages/` 下新增 4 个 stage 服务 + 1 个 `cumulative-graph.ts`；route handler `chapters-archive.ts` 拆分为 3 个 handler（prepare-archive / prepare-archive/cancel / archive），事务边界收紧到 archive commit 内部。前端 `ReviewingPanel.vue` 重切分为 4 个 stage card，加 cancel / reprepare / archive 三个按钮。GraphView.vue 重写延后到下一个独立 commit。

**Tech Stack:** 不引入新库。沿用 Fastify + Prisma + Vue 3 + Naive UI + Vitest。

---

## 关联

- **v2 状态机基线**:`docs/superpowers/specs/2026-07-24-v2-state-machine-design.md` 已把 ChapterStatus 收口到 3 值，本次是其上"archive pipeline 解耦"的扩展
- **当前 archive 流程**:`docs/Process.md` §Archive Pipeline + `apps/server/src/routes/chapters-archive.ts`
- **TimelineEvent v3 废弃标记**:`prisma/schema.prisma:TimelineEvent` 上的 `@deprecated` 注释，本次不涉及
- **GraphView 当前数据源**:`GraphNode`/`GraphEdge` 工作表 + `Chapter.graphSnapshot`/`graphDelta`。本次字段重命名（`chapterGraph`/`cumulativeGraph`）但**不删工作表**，GraphView.vue 重写延后

---

## 用户决策记录（2026-07-25）

| # | 议题 | 用户决策 |
|---|------|----------|
| D1 | 跨 stage 命名一致性（角色 / 图谱） | 在角色 stage 跑前做文本匹配，命中的 Character（带 id/key/label）传给所有 stage 作锚定；新角色仍由 AI 起名 |
| D2 | 图谱生成模型 | 两阶段：`Chapter.本章图谱`（gacha 单次 AI，不与历史合并）+ `Chapter.全局图谱`（archive 端点内 1 次 AI 去重 + code merge 进 prev） |
| D3 | 锁 | 全部删除。仅靠状态机自身 + UI 按钮 disabled 防双击，无任何 `updateMany race` 兜底 |
| D4 | pendingArchiveData 形状 | TEXT 列内 JSON：`{version: 3, stages: {character, memory, plotArc, graph}, meta}`。version 字段区分老 reading 章 |
| D5 | "重新解析"语义 | 全量重跑 prepare-archive（4 stage 全部重抽，pendingArchiveData 整体覆盖）；不做单 stage 重跑端点 |
| D6 | 4 stage 执行模型 | 并行触发（`Promise.all`）；provider rate limit 出问题再补 throttle |
| D7 | Commit gate | `∀ stage.status === 'success'`；empty success 直接放行，不强制用户确认 |
| D8 | 取消审查 | 新增 `POST /prepare-archive/cancel` 端点：status='draft'、清空 pendingArchiveData 与 chapterGraph，无需删章节 |
| D9 | 字段命名 | `Chapter.graphDelta` → `Chapter.chapterGraph`；`Chapter.graphSnapshot` → `Chapter.cumulativeGraph`（重命名 + Prisma migration） |
| D10 | GraphNode / GraphEdge 表 | 标 `@deprecated`，本次不删；GraphView.vue 重写后下个 commit 再删 |
| D11 | GraphView.vue 范围 | 本次不重写，作为后续独立 commit |
| D12 | 第一章 edge case | `cumulativeGraph = chapterGraph`，跳过第二次 AI 去重 |
| D13 | chapterGraph 为空 | `cumulativeGraph = prev chapter's cumulativeGraph`（继承上一章），跳过第二次 AI 去重 |
| D14 | BFS hop 数 | 沿用当前 2-hop；1-hop 作为未来优化（TODO 记录） |
| D15 | 非事件实体 | type ∈ {character, faction, item} 参与累计 BFS；type === 'event' 不参与 |
| D16 | Side story 上一章 | 取**父章节**的 cumulativeGraph，不取时间序前一个章节 |
| D17 | 全局图谱 build 位置 | archive 端点内部、事务前的同步步骤；失败让 archive 500，用户重新点归档 |

---

## 哲学层

### Stage = 一次独立的 AI 抽取

每个 stage 是一个**有明确输入/输出契约的纯服务**，调用 AI 一次（或内部 retry 一次），返回 `StageState`。Stage 之间**不通信**——所有跨 stage 信息通过 prompt 输入共享（如 character 列表、prev cumulativeGraph 的 type:key 集合）。这样：

- 任一 stage 失败不影响其他 stage 的结果
- 用户能看到哪个 stage 失败 + 失败原因
- 重跑一个 stage 不污染其他 stage
- Stage 服务可独立 mock + 单测

### 图谱 = 两段式 + 各自语义清晰

```
本章图谱 (chapterGraph)    ←  gacha,只看正文,不与历史合并
全局图谱 (cumulativeGraph) ←  在本章图谱基础上,从 prev cumulativeGraph 取相关节点做小范围去重
```

两者的**关系不保证对称**：经过 AI 去重后，本章图谱的某些节点/边可能不出现在全局图谱（被 dedup），反之亦然。这种"不对称"是**有意为之**——本章图谱保留本章事实，全局图谱反映累计状态。

### 锁 = 不存在的概念

状态机本身负责序列化语义：

- `draft` 不响应 `prepare-archive/cancel` / `archive`
- `reviewing` 不响应 `prepare-archive`（实际允许，但语义是"重新准备"，会覆盖 pendingArchiveData）
- `archived` 不响应任何 archive-* 端点

UI 层按钮 disabled + 后端检查 status 一起构成实际约束。**不引入任何 `updateMany({where: {status: ...}})` 形式的乐观锁**。

---

## 数据模型

### Chapter 字段重命名

**Before**：

```prisma
model Chapter {
  graphDelta    String?  // 本章图谱（旧名）
  graphSnapshot String?  // 全局图谱（旧名）
}
```

**After**：

```prisma
model Chapter {
  /// 本章图谱（gacha 抽取，与累计全局图谱分离）
  chapterGraph     String?
  /// 累计到本章的全局图谱（经 N-1 去重）
  cumulativeGraph  String?
}
```

迁移 SQL（保留数据）：

```sql
ALTER TABLE "Chapter" RENAME COLUMN "graphDelta" TO "chapterGraph";
ALTER TABLE "Chapter" RENAME COLUMN "graphSnapshot" TO "cumulativeGraph";
```

### GraphNode / GraphEdge 表

不删，仅标 `@deprecated`。本次不写入新数据。GraphView.vue 继续读这俩表直到重写 commit。

### pendingArchiveData JSON 形状

```typescript
interface PendingArchiveDataV3 {
  version: 3
  stages: {
    character: StageState
    memory: StageState
    plotArc: StageState
    graph: StageState
  }
  meta: {
    extractedAt: string
    chapterNumber: number
  }
}

interface StageState<T = unknown> {
  status: 'pending' | 'running' | 'success' | 'failed'
  result?: T
  errorMessage?: string
  completedAt?: string  // ISO timestamp
}
```

读取老 v1/v2 blob（`safeJsonParse` 兜底）：

- `parsed.version === 3` → 直接用
- 解析失败 / 老 shape → 当作 "pendingArchiveData 损坏"，前端提示用户重新 prepare-archive

---

## 服务边界

### 新目录：`apps/server/src/services/stages/`

```
services/stages/
├── types.ts              # StageState、StageInput 等公共类型
├── character-stage.ts    # 角色 stage
├── memory-stage.ts       # 记忆 stage
├── plot-arc-stage.ts     # 剧情弧线 stage
└── graph-extract-stage.ts # 本章图谱 stage
```

每个 stage 服务签名一致：

```typescript
export async function runXxxStage(
  app: FastifyInstance,
  input: XxxStageInput
): Promise<StageState<XxxStageResult>>
```

**契约**：

- **无 DB 写入**：stage 服务只调 AI、解析、返回。路由层负责持久化
- **内部 retry**：每个 stage 内置 1 次重试（温度 0.3 → 0.1），与现状一致
- **空结果 = success**：AI 返回 `[]` / `{}` 不算失败
- **错误 = failed**：AI 调用异常 / JSON parse 失败（重试一次仍失败）→ status='failed' + errorMessage

### 4 个 stage 的输入/输出契约

#### 1. character-stage（角色）

**输入**：

```typescript
interface CharacterStageInput {
  storyId: string
  chapterId: string
  content: string
  outline: string
  chapterNumber: number
  // pre-stage 文本匹配：从 Chapter.content 里匹配出"在正文出现的 Character"
  matchedCharacters: Array<{
    id: string          // Character.id
    name: string
    key: string         // graph key
    label: string
    importance: number
  }>
}
```

**输出**：

```typescript
interface CharacterStageResult {
  characterStates: Array<{
    characterId: string | null  // 命中老 Character → id；新角色 → null
    name: string
    key: string
    status: string       // JSON
    relationships: string // JSON
    isNew: boolean
  }>
}
```

**AI 调用**：1 次。Prompt 强制从 matchedCharacters 的 name/key 中挑选角色名，匹配不到时输出新角色。

#### 2. memory-stage（记忆）

**输入**：

```typescript
interface MemoryStageInput {
  storyId: string
  chapterId: string
  content: string
  outline: string
  chapterNumber: number
  // 锚定命名（来自 character-stage 输出 + 现有 Character 表）
  characterNames: string[]
  characterKeys: string[]
}
```

**输出**：

```typescript
interface MemoryStageResult {
  mainEvents: Array<...>
  sideEvents: Array<...>
  emotions: Array<...>
  foreshadowing: Array<...>
  relationshipChanges: Array<...>
  scenes: Array<...>
  // 移除 characterStatusChanges（归属 character-stage）
}
```

**AI 调用**：1 次。

#### 3. plot-arc-stage（剧情弧线）

**输入**：

```typescript
interface PlotArcStageInput {
  storyId: string
  chapterId: string
  content: string
  outline: string
  chapterNumber: number
  existingArcs: PlotArc[]            // 查 DB
  characterNames: string[]           // pre-stage 文本匹配 → 锚定
  latestBranchStates: Array<{        // 查 DB（最新 CharacterBranchState per matched character）
    characterId: string
    status: string
    relationships: string
  }>
}
```

**输出**：

```typescript
interface PlotArcStageResult {
  plotArcs: PendingPlotArcWrite[]
}
```

**AI 调用**：1 次。沿用 `consolidatePlotArcs`（已有逻辑，包装为 stage）。

#### 4. graph-extract-stage（本章图谱）

**输入**：

```typescript
interface GraphExtractStageInput {
  storyId: string
  chapterId: string
  content: string
  outline: string
  chapterNumber: number
  characterNames: string[]            // pre-stage 文本匹配 → 锚定
  prevCumulativeGraphKeys: string[]   // 从 prev cumulativeGraph 提取 type:key，提示 AI 复用
  latestBranchStates: Array<{         // 查 DB（最新 CharacterBranchState per matched character）
    characterId: string
    name: string
    status: string
  }>
}
```

**输出**：

```typescript
interface GraphExtractStageResult {
  chapterGraph: GraphSnapshot  // { nodes, edges, timestamp }
}
```

**AI 调用**：1 次。Prompt 锚定 type ∈ {character, faction, event, item}，character/faction/item 必须复用 prev 的 type:key 或 characterNames。

### 新服务：`cumulative-graph.ts`

```typescript
export interface CumulativeGraphInput {
  storyId: string
  chapterId: string
  chapterNumber: number
  chapterGraph: GraphSnapshot | null
  prevCumulativeGraph: GraphSnapshot | null
}

export interface CumulativeGraphResult {
  cumulativeGraph: GraphSnapshot
  aiCalled: boolean  // 供 log / 测试
}

export async function buildCumulativeGraph(
  app: FastifyInstance,
  input: CumulativeGraphInput
): Promise<CumulativeGraphResult>
```

**逻辑**：

1. **空 chapterGraph**：`chapterGraph === null || nodes.length === 0` → 返回 `prevCumulativeGraph ?? emptyGraph`，aiCalled=false
2. **首章**：`prevCumulativeGraph === null` → 返回 `chapterGraph`（**直接复制，不调 AI**），aiCalled=false
3. **正常路径**：
   - 从 `chapterGraph` 提取非 event 节点（type ∈ {character, faction, item}）
   - 从 `prevCumulativeGraph` 找同 type:key 的节点
   - 2-hop BFS（沿用 `expandNeighborhood`）→ `neighborhood`
   - merge：`chapterGraph ∪ neighborhood`
   - AI 去重调用（callType='cumulative_dedup'）→ `dedupedSubgraph`
   - code merge `dedupedSubgraph` → `prevCumulativeGraph`（基于 fromType:fromKey:relation:toType:toKey 去重）→ `cumulativeGraph`
   - 返回 `cumulativeGraph`，aiCalled=true

---

## Route Handler 改造

### `apps/server/src/routes/chapters-archive.ts` 三段

#### `POST /api/chapters/:id/prepare-archive`

```typescript
1. 验证 chapterId，查 chapter via getOrThrowChapter
2. chapter.status not in ['draft', 'reviewing'] → 400
3. chapter.isSideStory || !chapter.content → set status='archived', return {sideStory: true / noContent: true}
4. 验证 outline 非空、content 非空、content.length >= outline.length
5. chapter.status = 'reviewing'
   chapter.chapterGraph = null
   chapter.pendingArchiveData = null
6. 构造 4 stage 输入（每个 stage 独立查 DB 拿 latest BranchState / Arcs / prevCumulativeGraphKeys）：
   - pre-stage 文本匹配：从 chapter.content 匹配现有 Character → characterNames, characterKeys
   - 查 CharacterBranchState（每个 matched character 的最新）→ latestBranchStates
   - 查 PlotArc（story 级 active arcs）→ existingArcs
   - 查 prev chapter's cumulativeGraph → prevCumulativeGraphKeys
7. Promise.all([
     runCharacterStage(app, charInput),
     runMemoryStage(app, memInput),
     runPlotArcStage(app, plotInput),
     runGraphExtractStage(app, graphInput)
   ])
8. 把每个 stage 结果写入 pendingArchiveData.stages.<name>：
   stages[name] = {status, result?, errorMessage?, completedAt?}
9. graph stage 额外：chapter.chapterGraph = JSON.stringify(stages.graph.result.chapterGraph)
10. return { pendingArchiveData }
```

**注意**：

- 不再 `updateMany({status: ...})` 锁。状态转换是直接的 `chapter.update`
- 任何 stage 失败不影响其他 stage 写入 pendingArchiveData
- 路由不抓 stage 内部异常——stage 自带 retry 后仍失败时 status='failed'；极端 panic（OOB error）才让路由 500

#### `POST /api/chapters/:id/prepare-archive/cancel`（新）

```typescript
1. 查 chapter
2. chapter.status !== 'reviewing' → 400
3. chapter.status = 'draft'
4. chapter.pendingArchiveData = null
5. chapter.chapterGraph = null
6. return { success: true }
```

**注意**：

- 不论用户编辑过什么，全部清掉（用户重跑 prepare-archive 时重新抽取）
- 不删章节（D8）
- 不清理 derived 表（因为 commit 还没发生）

#### `POST /api/chapters/:id/archive`

```typescript
1. 查 chapter
2. chapter.status === 'archived' → return {alreadyArchived: true}
3. chapter.status !== 'reviewing' → 400
4. safeJsonParse(chapter.pendingArchiveData) → 验证 version === 3
5. 验证 ∀ stage.status === 'success'，否则 400 列出失败 stage
6. 读取 chapter.chapterGraph（来自 prepare-archive stage 4 写入）
7. 读取 prev chapter's cumulativeGraph：
   - mainline (chapter.parentChapterId === null)：prev = chapter WHERE parentChapterId IS NULL AND number = current.number - 1
   - side story (chapter.parentChapterId !== null)：prev = chapter WHERE id = chapter.parentChapterId
   - 无 prev（首章或无对应 chapter）→ prevCumulativeGraph = null
8. buildCumulativeGraph(app, {chapterGraph, prevCumulativeGraph, ...})
   - 失败 → return 500 "全局图谱构建失败: <err>"
9. prisma.$transaction:
     commitMemoryWrites(tx, chapterId, storyId, stages.memory.result)
       含 character branch states（来自 stages.character.result）
     chapter.update(summary, timelinePosition, cumulativeGraph)
     commitPlotArcWrites(tx, chapterNumber, stages.plotArc.result.plotArcs)
     chapter.update(chapterGraph, status='archived', pendingArchiveData=null)
10. post-commit: optimizeMemories（fire-and-forget，失败不阻塞）
11. return { cumulativeGraph, optimizedCount }
```

**注意**：

- 全局图谱 build 在事务**前**（AI 调用不能在事务里——会持锁）
- 事务内所有写入原子化；失败 rollback 整段（chapter.status 仍是 reviewing）
- side story 与 no-content 路径在 prepare-archive 阶段已直接 archived，这里兜底检查

---

## 状态机

```
                    prepare-archive                 cancel
   draft  ─────────────────────────►  reviewing  ────────►  draft
                                            │
                                            │  (per stage 内部):
                                            │     pending → running → success
                                            │                           ↘ failed
                                            │  "重新解析" = 全量重跑 prepare-archive
                                            │  → pendingArchiveData 整体覆盖
                                            ▼
                                       archive
                                       (∀ stage.status === 'success')
                                       + cumulativeGraph build 成功
                                            │
                                            ▼
                                       archived
```

---

## 前端改造

### `apps/web/src/views/ReviewingPanel.vue` 切分

```vue
<ReviewingPanel>
  <header>归档审查</header>

  <StageCard
    v-for="stage in ['character', 'memory', 'plotArc', 'graph']"
    :key="stage"
    :name="stage"
    :state="pendingData.stages[stage]"
    @edit="(result) => updateStage(stage, result)"
  />

  <footer>
    <button @click="reprepare">重新解析（全部）</button>
    <button @click="cancel">撤销审查，回到草稿</button>
    <button :disabled="!allSuccess" @click="archive">确认归档</button>
  </footer>
</ReviewingPanel>
```

**StageCard 内部**：

- **Header**：stage 中文名 + status badge（pending / running(loading) / success / failed）
- **Body (success)**：result 内容，含编辑控件
  - character：characterStates 列表，编辑 status/relationships JSON
  - memory：mainEvents/sideEvents/emotions/foreshadowing/scenes 卡片列表，编辑
  - plotArc：plotArcs 表格，编辑各字段
  - graph：节点 + 边可视化（沿用 `EditableGraph.vue`），编辑
- **Body (failed)**：`errorMessage` 高亮 + "本次失败，按"重新解析"重试" 提示
- **Body (running)**：loading spinner

**debounce 写回**：`@edit` 触发 → 防抖 500ms → `chaptersApi.update(chapterId, {pendingArchiveData: JSON.stringify(pendingData)})`

### API 客户端扩展

```typescript
// apps/web/src/api/chapters.ts
chaptersApi = {
  // ... existing ...
  prepareArchive: (chapterId) => api.post(...),
  prepareArchiveCancel: (chapterId) => api.post('/api/chapters/:id/prepare-archive/cancel', {}, {timeout: 5000}),
  archive: (chapterId) => api.post(..., {timeout: 0}),
}
```

### `useChapterEditor.ts` 改造

```typescript
// 新增：
async function prepareArchiveCancel() { ... }

// 现有 prepareArchive 不变（仍调 prepare-archive 端点，全量重跑语义）
// 现有 archiveChapter 不变
// 现有 savePendingArchiveData 兼容 v3 shape（仍是 debounced update）
```

---

## 错误处理

### Stage 内部

| 场景 | 行为 |
|------|------|
| AI 调用异常 | status='failed'，errorMessage="AI call failed: <err>" |
| JSON.parse 失败 | 内部 retry 1 次（温度降到 0.1），仍失败 → status='failed'，errorMessage 含两次错误摘要 |
| 解析后空 result | status='success'，result 是空值 |
| Prompt log 失败 | stage 不感知（async 写日志，独立 try/catch） |

### Archive 端点

| 场景 | HTTP | 错误消息 |
|------|------|----------|
| pendingArchiveData 损坏 / version 不匹配 | 400 | "归档失败：pendingArchiveData 版本不匹配，请重新准备归档" |
| 任一 stage 非 success | 400 | "归档失败：以下 stage 未通过：character, graph" |
| buildCumulativeGraph 失败 | 500 | "归档失败：全局图谱构建失败（<err>）" |
| 事务失败 | 500 | "归档失败：数据保存出错（<err>）。章节状态未变更" |

### Cancel 端点

| 场景 | HTTP |
|------|------|
| chapter.status !== 'reviewing' | 400 |
| 正常 | 200 |

### 重解析（用户操作）

- 用户点击"重新解析（全部）" → 调 prepare-archive 端点
- pendingArchiveData 整体被新结果覆盖
- 用户未保存的编辑丢失（提示确认对话框）

---

## 测试

### Stage 服务单测（vitest）

每个 stage 测：

- Mock `callAIWithLog` 返回正常 JSON → status='success'，result 解析正确
- Mock 返回非法 JSON → 内部 retry 1 次成功 → status='success'
- Mock 返回非法 JSON 且 retry 也失败 → status='failed'，errorMessage 含两次错误
- Mock 返回空 `{}` / `[]` → status='success'，result 是空
- 不调 `prisma.*`（除必要查 Character / PlotArc）

### `buildCumulativeGraph` 单测

- chapterGraph null → 返回 prevCumulativeGraph，aiCalled=false
- prevCumulativeGraph null（首章）→ 返回 chapterGraph 副本，aiCalled=false
- 正常 → mock callAI 返回 deduped → 返回 merged，aiCalled=true
- AI 失败 → throws

### Route 集成测试

`apps/server/src/__tests__/routes/prepare-archive-v3.test.ts`：

- prepare-archive 4 stage 全 success → 返回完整 pendingArchiveData，chapter.chapterGraph 已写
- prepare-archive 单 stage failed → 该 stage.status='failed'，其他 status='success'
- prepare-archive cancel → status='draft'，pendingArchiveData=null，chapterGraph=null
- archive 4 stage 全 success → 事务 commit，chapter.status='archived'
- archive 任一 stage failed → 400
- archive cumulativeGraph build 失败 → 500

### 前端

- 手动：跑 `pnpm dev`，对一个新章节跑一遍准备归档 → 审阅 → 重新解析 → 撤销 → 再归档
- 不写单测（项目当前没前端测试基建）

---

## 迁移 / 落地

1. **Schema migration**：`graphDelta` → `chapterGraph`，`graphSnapshot` → `cumulativeGraph`
2. **新增 4 stage 服务 + cumulative-graph.ts**
3. **改造 chapters-archive.ts 三个端点**
4. **改造 frontend ReviewingPanel.vue + useChapterEditor.ts**
5. **更新 vitest 测试**（新增 + 调整旧测试）
6. **更新 docs**（DESIGN.md / LOGIC.md / CLAUDE.md 同步 v3 archive 语义）
7. **本次不重写 GraphView.vue**：保留旧工作表读取，文档标记为未来 commit

### 老数据兼容性

- 老 `pendingArchiveData` blob（无 `version` 字段）→ `safeJsonParse` 拿到非 v3 shape → 前端读 `pendingData.stages === undefined` → 提示"数据格式过旧，请重新准备归档"，按钮调 prepare-archive 重写
- 老 `Chapter.graphDelta` / `graphSnapshot` 数据 → Prisma migration 直接 rename 列保留数据 → 重命名后字段名匹配新代码的查询

---

## 未来工作（不在本次）

1. **1-hop BFS 优化**：当小说章节数过大导致 2-hop BFS 邻域膨胀时切换为 1-hop。已在 `cumulative-graph.ts` 中标注 TODO
2. **Per-stage 重跑端点**：用户对单 stage 重跑的需求若频繁出现，加 `POST /prepare-archive/<stage>/rerun`，仅跑一个 stage。当前不做
3. **GraphView.vue 重写**：消费 `Chapter.cumulativeGraph` / `chapterGraph`，写新版可视化；然后删 `GraphNode` / `GraphEdge` 表
4. **异步 AI 调用**：用 BullMQ 把 stage AI 调用放到队列，前端轮询 progress。当前后端同步阻塞，AI 慢则用户等待
5. **用户可编辑全局图谱**：在 ReviewingPanel 暴露 `Chapter.cumulativeGraph` 编辑能力（与用户手动触发"生成全局图谱"绑定）
6. **跨 stage 命名一致性校验**：从 prompt 锚定扩展为 post-hoc validator——stage 输出后跑一层校验（character name 必须在 characterNames 集合内、graph key 必须在 prevCumulativeGraphKeys 集合内），违规则重抽

---

## 实施路径

单分支 `v3/prepare-archive-stages` 内分 6 个 commit（语义化、单点可回滚）：

1. `chore(v3): rename graphDelta/graphSnapshot to chapterGraph/cumulativeGraph`
2. `feat(v3): add 4 stage services with shared types`
3. `refactor(v3): split chapters-archive handler into prepare/cancel/archive endpoints`
4. `feat(v3): add cumulative-graph builder with 2-hop BFS + AI dedup`
5. `refactor(v3): restructure ReviewingPanel into 4 stage cards`
6. `docs(v3): align docs with stages model + GraphView.vue deferred`

每个 commit 后 `pnpm typecheck && pnpm test --run` 全绿才能进下一个。