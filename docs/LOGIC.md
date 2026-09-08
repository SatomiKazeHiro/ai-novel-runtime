# LOGIC.md — AI 小说工坊 架构速览

> 目标：15 分钟读懂 12k 行代码的核心逻辑。读者：项目所有者本人。
> 配套文档：`docs/ISSUES.md`（P0 + Q 决策 + 工程化决策 + 库选型 + 修复时间线）、`KNOWN-ISSUES.md`（数据鲁棒性 + 安全陷阱）。

---

## §0 · 5 分钟鸟瞰

**一句话定义**：把"AI 写长篇小说"从"巨型 prompt + 无限 agent"重塑为"结构化世界 + 状态机驱动的多 AI 协调"——人类主导方向，AI 负责生成，Runtime 负责稳定。

**章节生命周期**（v2 — **3 值 enum**，定义在 `prisma/schema.prisma` 的 `enum ChapterStatus`）：

```
draft ──┬─→ reviewing ─→ archived
        └── (prepare-archive AI 失败回退) ──┘
```

- `ChapterStatus` 只有 `draft` / `reviewing` / `archived` 三个值；候选生成（`Draft`）与章节业务状态**完全正交**
- **reviewing** 是人工审查环节（见 `Chapter.pendingArchiveData`）：AI 提取完记忆/图谱/弧线后不直接写库，停在 `reviewing` 状态等用户在 `ReviewingPanel.vue` 编辑后再 commit
- 只有 `archived` 章节会喂给下一章的 prompt

**归档流水线**（v4 — 5 stage 拆分 memory）：

```
[prepare-archive]                       [archive 确认]
4 stage 并行 (Promise.all):  ─┐
  character / memoryExtract /  │ ← 纯 AI 调用, 结果各自落
  plot-arc / graph-extract    │   pendingArchiveData.stages[name]
  + 串行 memoryOptimize:      │
    (仅 memoryExtract success │   pendingArchiveData version: 4
     时跑 optimizer)          ┘
                                ↓
[cumulative-graph/build]  用户主动点「生成累计图谱」→
  services/cumulative-graph.ts 合并 → 写 pendingArchiveData.cumulativeGraph
                            ┌─ 校验: 5 stage 全 success + 累计图谱已生成
                            │   pendingArchiveData.version === 4
                            │   (v3 数据直接 400 拒,提示用户重新准备归档)
                            └─  prisma.$transaction 内依次写
                                Memory 三层 (chapter / scene / global,
                                data 源: memoryExtract.result + memoryOptimize.result.memories)
                                + Chapter.summary + Chapter 三列
                                + 翻 status='archived'
                                (CharacterBranchState / PlotArc 写入另文档)
```

**v4 拆分动机**: v3 单 `memory` stage 串行 extractor+optimizer 有 2 类脆弱:
1. extractor 失败 → optimizer 白跑 (AI 调用成本)
2. extractor 成功 + optimizer 失败 → 整 stage 标 failed, extractor work 浪费

v4 拆 `memoryExtract` + `memoryOptimize` 为 2 独立 stage, 任一失败可独立重启。

**硬规则**: reviewing 期间图谱数据只活在 `pendingArchiveData` JSON, Chapter 三列全程不读写; archive confirm 才落列。

**核心模块地图**（按代码量降序）：

- 后端 `apps/server`：14 路由 + 15 service
- 前端 `apps/web`：11 api + 4 composables + 16 view
- 共享 `packages/*`：6 个包

**最关键代码位置**（按"被读次数"算）：
- `apps/server/src/routes/chapters-archive.ts` — 归档流水线（prepare-archive / cumulative-graph / archive）
- `apps/web/src/views/Chapters.vue` — 编辑/审查/归档的前端调度
- `apps/web/src/views/ReviewingPanel.vue` — 人工审查 UI
- `apps/server/src/services/stages/` — 4 个并行提取 stage

---

## §1 · 模块地图

### 后端（`apps/server`）

**14 个路由**（一行一职）：

| 路径 | 文件 | 职责 |
|------|------|------|
| `/api/stories` | `routes/stories.ts` | Story CRUD + 剧情弧线列表 + chapter-tree（**唯一**用 zod 校验的） |
| `/api/stories/:id/chapters` + `/api/chapters/:id` | `routes/chapters.ts` | 章节 CRUD + preview/generate/select/prepare-archive/archive/develop（**最复杂**） |
| `/api/stories/:id/characters` + `/api/characters/:id` | `routes/characters.ts` | 角色 CRUD + CharacterBranchState 历史快照 |
| `/api/stories/:id/lore` + `/api/lore/:id` | `routes/lore.ts` | 世界观条目 CRUD |
| `/api/stories/:id/timeline` + `/api/timeline/:id` | `routes/timeline.ts` | 时间线事件 CRUD |
| `/api/chapters/:id/drafts` + `/api/drafts/:id` | `routes/drafts.ts` | 草稿 CRUD（generate 路由内会自己创建 draft） |
| `/api/stories/:id/graph` + `/api/chapters/:id/graph-snapshot` | `routes/graph.ts` | 知识图谱查询 + 手动增删节点/边 |
| `/api/stories/:id/memory` | `routes/memories.ts` | 记忆查询 + 创建 |
| `/api/runtime-profiles` | `routes/runtime-profile.ts` | 写作人格 CRUD |
| `/api/worker-tasks` | `routes/worker-task.ts` | Worker 任务模板 CRUD |
| `/api/ai-providers` | `routes/ai-provider.ts` | AI Provider 配置 CRUD + 默认设置 + 连通性测试 |
| `/api/stories/:id/prompt-logs` + `/api/prompt-logs/:id` | `routes/prompt-logs.ts` | Prompt 调用日志分页查询 |
| `/api/health` | `routes/health.ts` | 健康检查 |

**15 个 service**（按调用频率排）：

| Service | 职责 | 状态 |
|---------|------|------|
| `cumulative-graph.ts` | 用户主动触发累计图谱合并（relation 归一 + codeMerge 五元组去重） | 核心 |
| `memory-optimizer.ts` | **v4 接入 prepare-archive 阶段**(4 stage `Promise.all` 完成后串行跑,仅 memoryExtract success 时触发,产物写 `stages.memoryOptimize.result.memories`)。archive confirm **不调**(commit-only)。 | 核心 |
| `generate-processor.ts` | 队列 worker，**串行**调用 AI 生成每个 draft | 核心 |
| `ai-call-logger.ts` | **统一 AI 调用封装**，自动写 PromptLog（成功/失败都记） | 核心 |
| `runtime-loader.ts` | 加载 `RuntimeBase` 和 `WorkerTask`（Story → 全局 → 硬编码回退） | 核心 |
| `stages/character-stage.ts` | v3 角色状态提取（matchedCharacters → characterStates） | 核心 |
| `stages/memory-stage.ts` | v3 章节记忆提取（mainEvents / sideEvents / scenes / emotions / foreshadowing / relationshipChanges / summary） | 核心 |
| `stages/plot-arc-stage.ts` | v3 剧情弧线提取 / 更新 / 合并 | 核心 |
| `stages/graph-extract-stage.ts` | v3 本章图谱提取（prevCumulativeGraph 复用 type:key） | 核心 |
| `character-extractor.ts` | v3 archive confirm 时把 `character-stage` 输出的 characterStates 落 `CharacterBranchState` 表（边界统一 JSON.stringify, `commitCharacterBranchStateWrites`） | 核心 |
| `graph-snapshot.ts` | 图谱快照数据结构（GraphNodeSnapshot / GraphEdgeSnapshot / GraphSnapshot） | 辅助 |
| `plot-extractor.ts` | 剧情弧线提取 + 状态推进 | 辅助 |
| `ai-provider-init.ts` | 启动时从 `.env` 同步 DeepSeek 配置到 DB | 启动 |
| `runtime-profile-init.ts` | 启动时扫描 `docs/profiles/*.json` 导入 Profile | 启动 |
| `worker-task-init.ts` | 启动时初始化系统默认 WorkerTask | 启动 |

### 前端（`apps/web`）

**11 个 API 模块**：每个按领域导出 `{ list, get, create, update, remove }` 形式的对象。最大的是 `chapters.ts`（含 `prepareArchive` / `savePendingArchiveData` / `archive` 三步）。

**4 个 composables**（重逻辑提取）：

- `useChapterTree.ts` — 章节树 CRUD + 创建/发展/删除
- `useChapterEditor.ts` — 单章节编辑状态 + `prepareArchive` / `savePendingArchiveData` / `archiveChapter` 三步
- `useDraftManager.ts` — 候选生成 + 2 秒轮询（`useIntervalFn`）
- `usePromptManager.ts` — Prompt 预览 + 复制 + 预算统计

**16 个 view**（按页面分）：
- 顶层布局：`SimpleLayout.vue` / `NovelDesignLayout.vue`
- 小说内页（`/novel-design/:storyId/...`）：`Chapters.vue`（最大）/ `Characters.vue` / `LoreBook.vue` / `Graph.vue` / `Memory.vue` / `Timeline.vue` / `ReviewingPanel.vue`（嵌在 Chapters 里）
- 全局页：`Dashboard.vue` / `Stories.vue` / `RuntimeProfile.vue` / `WorkerTask.vue` / `StoryWorkerTask.vue` / `ModelManager.vue` / `PromptLogs.vue`

### 共享包（`packages/*`）

| 包 | 职责 | 关键导出 |
|---|------|---------|
| `@novel-runtime/shared` | 类型/常量/纯工具 | `ChapterStatus`（**v2 收口到 3 值：`draft`/`reviewing`/`archived`**）/ `MemoryLayer` / `estimateTokens`（启发式）/ `safeJsonParse` / `scaleBudget` |
| `@novel-runtime/ai-provider` | LLM Provider 抽象 + Prompt 编译器 | `DeepSeekProvider` / `OpenAIProvider`（stub）/ `RuntimePromptCompiler` / `countTokens`（基于 cl100k_base，唯一入口） |
| `@novel-runtime/prompt-runtime` | 9 层 Pipeline 组装 + 预算控制 | `PromptPipeline` / `BudgetConfig` |
| `@novel-runtime/memory-engine` | 语义检索 + 记忆格式化 | `MemoryManager.searchRelevant` / `formatForPrompt` |
| `@novel-runtime/knowledge-graph` | graphology 内存图封装 | `GraphService` |

---

## §2 · 核心流程

### 章节状态机（v2 — 3 值 enum）

`ChapterStatus` 收口到 3 个值（`draft` / `reviewing` / `archived`），候选生成（`Draft`）与章节业务状态完全正交。状态转换集中在 `routes/chapters-archive.ts`。

**状态变迁**：

| from → to | 触发 | 路由:行 |
|-----------|------|---------|
| `draft → reviewing` | `/prepare-archive` 成功 | `routes/chapters-archive.ts:68-71` |
| `reviewing → archived` | `/archive` 确认 | `routes/chapters-archive.ts:164-167` |
| `reviewing → draft` | `/prepare-archive` AI 提取失败回退 | `routes/chapters-archive.ts:93-96` |
| `archived → （终态）` | 不能反归档；回退 = 删章节 + 级联清理 | — |

（`reviewing → reviewing` 是重试 no-op 写：`prepare-archive` 锁条件含 `reviewing`，重试时清掉 `pendingArchiveData` 重新提取。）

**候选与章节状态正交**：

候选生成（`POST /generate`）与选择（`POST /select`）**不再修改 `Chapter.status`**。它们只读写 `Draft.status`（候选层 5 值：`pending` / `generating` / `completed` / `failed` / `rejected`）。`select` 路由只把同章其他 draft 置 `rejected`，并把选中 draft 的 `content` 写入 `Chapter.content`。v2: 不再有 `selected` 状态 —— "哪个候选被采纳" 只通过 `Chapter.content` 与 `Draft.content` 的匹配判断，DB 不再标记。

**archived 章节的 generate**：

`archived` 章节不允许再生成/选择候选（UI 隐藏按钮，`generate` / `select` 路由层兜底 400，见 `chapters-generate.ts:148,278`）。已入队的候选继续跑完——worker 只看 `Draft.status`，不读 `Chapter.status`。

**锁机制**：

v3 删除所有 `updateMany({where: {status: ...}})` 锁（v2 还在 `prepare-archive` / `archive` 两处用）。仅依赖 `ChapterStatus` 状态机自身（draft → reviewing → archived）+ UI 按钮 disabled 防双击。`generate` / `select` 不再翻 `chapter.status`（与 v3 一致），双击并发会产生 2 批 draft，用户最终看到候选数翻倍，但无脏状态（`chapters-generate.ts:155-157` 注释固化此语义）。

**注意**：`assertStatusTransition` / `VALID_STATUS_TRANSITIONS` / `preLockStatus` 等旧补丁已在 v2 前的重构中全部删除，无对应代码。状态转换靠状态机自身 + Prisma enum 类型层兜底。

### Worker 写操作的不变量

`services/generate-processor.ts` 写 Draft 前必须跳过用户已决定 / 已完成的 draft（`generate-processor.ts:44-52`）：

```ts
const SKIP_STATUSES = ['selected', 'rejected', 'completed', 'failed']
const current = await prisma.draft.findUnique({ where: { id: draftId }, select: { status: true } })
if (!current || SKIP_STATUSES.includes(current.status)) continue
```

**关键陷阱**：route（`chapters-generate.ts:239`）用 `status: 'generating'` 创建 draft，**不是 `pending`**。所以 worker 不能用 `status !== 'pending'` 来过滤——那样会跳过自己刚派出去的任务。正确做法是白名单 4 个 SKIP_STATUSES，处理 `pending` + `generating`。

四种 SKIP_STATUSES 的语义：

| 状态 | 跳过原因 |
|------|---------|
| `selected` | 用户已选，不能被 worker 复活成 `completed` |
| `rejected` | 用户已淘汰，不能被 worker 复活成 `completed` |
| `completed` | worker 已成功处理过，重跑会重复消耗 AI |
| `failed` | worker 已失败，留在原状态方便诊断，不静默重试 |

**v2 关键变化**：worker 循环结束后**不再写 `chapter.status`**（旧版本会 `updateMany where status='generating'` 恢复 chapter 状态）。候选生成与章节状态彻底解耦，worker 只负责 Draft 层。

### 归档流水线（详细, v4 — 5 stage 拆分 memory）

| 阶段 | 文件 | 端点 | AI 调用 | 失败语义 |
|------|------|------|---------|---------|
| 1 提取 | `services/stages/{character,memoryExtract,plot-arc,graph-extract}-stage.ts` | `prepare-archive` | 4 次并行（每 stage 各 1 次） | **v4**：单 stage 失败落 `stages[name].status='failed'`，不影响其他 stage，章节仍进 `reviewing` |
| 1.5 记忆融合 | `memory-optimizer.ts:optimizeMemories` | `prepare-archive` 阶段(4 stage `Promise.all` 完成后串行) | 仅当 memoryExtract success 时跑 1 次；产物写 `stages.memoryOptimize.result.memories` | **v4 独立 stage**：失败独立标 `stages.memoryOptimize.status='failed'`，不浪费 raw extract 结果；archive confirm 校验 A 严格策略需要 5 stage 全 success |
| 2 累计图谱 | `services/cumulative-graph.ts:buildCumulativeGraph` | `cumulative-graph/build`（用户点"生成累计图谱"） | 1 次 | 失败返回错误，可重试；成功写 `pendingArchiveData.cumulativeGraph` |
| 2.5 人工审查 | `ReviewingPanel.vue` | `chaptersApi.update({ pendingArchiveData })`（用户点"保存调整"） | 0 次 | 用户编辑失败可重试。**v4 记忆 tab 顶部两步进度条**：步骤 1 (memoryExtract) / 步骤 2 (memoryOptimize)，per-stage 失败时显独立重启按钮 |
| 3 落列 | `routes/chapters-archive.ts:archive` | `archive` | 0 次 | 校验失败返回 400，章节维持 `reviewing`；`prisma.$transaction` 内写 Memory 三层（数据源 = `stages.memoryExtract.result` 写 chapter/scene + `stages.memoryOptimize.result.memories` 写 global）+ PlotArc (`commitPlotArcWrites`) + CharacterBranchState (`commitCharacterBranchStateWrites`) + Chapter.summary + Chapter 三列 + 翻 status |
| 4 per-stage 重跑 | `chapters-archive.ts:retry-stage` | `prepare-archive/retry-stage/:stageName` | 单 stage 重跑（v4 支持 5 stageName） | **v4**：重跑 memoryExtract 自动续跑 optimizer 写回两 stage；重跑 memoryOptimize 要求 memoryExtract 已 success；archive confirm 校验 `version === 4`,v3 数据报 400「版本不匹配,请重新准备归档」 |

> **v4 归档前置条件**: 累计图谱必须已生成（`Chapter.cumulativeGraphGeneratedAt != null`） + 5 stage 全 success + `pendingArchiveData.version === 4`。任一不满足返回 400,前端 ReviewingPanel 也会预先拦截。

**阶段 3 当前实现**：`prisma.$transaction` 内依次写：
1. `tx.memory.create` 每条 mainEvent / sideEvent / emotion / foreshadowing / relationshipChange 写入 `layer='chapter'`（mainEvent 多带 `'main-plot'` tag）；每条 scene 写 `layer='scene'`；每条 optimizer 融合记忆写 `layer='global'`（tag 加 `event` / `state`）。
2. `tx.commitPlotArcWrites(chapter.number, pending.plotArcs)` 写 PlotArc 表（接 v3, 2026-07-30）：包含 consolidator 输出的 isNew / update / closed 写库、lastTouchedChapter 刷新、stale 自动检测、Jaccard 兜底（详见 `services/plot-extractor.ts` 与 `docs/superpowers/specs/2026-07-30-v3-plot-arc-write-design.md`）。
3. `tx.commitCharacterBranchStateWrites(chapter.number, pending.characterStates)` 写 CharacterBranchState 表（接 v3, 2026-07-31）：包含 character-stage 输出的 matched character 状态/关系, isNew=true / characterId=null 跳过 + log（详见 `services/character-extractor.ts` 与 `docs/superpowers/specs/2026-07-31-v3-character-branch-state-write-design.md`）。
4. `tx.chapter.update({ summary })` 写 Chapter 摘要（不进 Memory 表）。
5. `tx.chapter.update({ chapterGraph, cumulativeGraph, cumulativeGraphGeneratedAt, status: 'archived', pendingArchiveData: null })`。

`TimelineEvent` 在 v3 删除，不再写。

**阶段 2.5 用户操作**：
- "保存调整" → `chaptersApi.update({ pendingArchiveData: JSON.stringify(data) })`
- "确认归档" → `chaptersApi.update({ pendingArchiveData })` → `chaptersApi.archive()`（双步串行）
- "取消" → `chaptersApi.remove(chapterId)`（**删除章节本身**）

### AI 调用全景表（v4 — 4 stage 并行 + 串行 memoryOptimize + 累计图谱 dedup）

| callType | 温度 | maxTokens | 用途 | 关键参数 |
|----------|------|-----------|------|---------|
| `generate` | 0.6 / 0.75 / 0.9 | 用户定 | 章节正文生成 | 9 层 Pipeline 拼装 |
| `character_stage` | 0.3 | 4096 | 角色状态提取（matchedCharacters → characterStates） | 输入 = matchedCharacters（路由层 pre-stage 文本匹配） |
| `memory_stage` | 0.3 | 4096 | 章节记忆 raw 提取（mainEvents/sideEvents/scenes/emotions/foreshadowing/relationshipChanges/summary） | 输入含 protagonistNames / existingNodeKeys / previousSnapshotNodes（跨章上下文）。**v4 仍由 memoryExtract stage 调用,产物写到 `stages.memoryExtract.result`** |
| `plot_consolidate` | 0.3 | 4096 | 剧情弧线合并（plot-arc-stage） | 输入 = existingArcs + latestBranchStates |
| `graph_extract_stage` | 0.3 | 4096 | 本章图谱提取（不复用 prev cumulative） | 输入含 prevCumulativeGraphNodes（type:key 复用约束） |
| `cumulative_dedup` | 0.2 | 8192 | 累计图谱 relation 字面归一 + codeMerge | merged + chapter 双产物 |
| `memory_optimize` | 0.3 | 4096 | 跨章 global 记忆融合 | **v4**: 仅 memoryExtract success 时调,产物写到 `stages.memoryOptimize.result.memories`,**不再**覆盖 raw stage 输出。archive confirm 不调 |
| `score` | 0.5 | 4096 | 7 维度评分 | 失败时 fallback 到规则引擎 |

> **v3+ 删除了 v2 时代的 `combined_extract` / `graph_organize` callType**（2026-07-30 死代码收口），由 4 个并行 stage + 累计图谱 dedup 替代。

---

## §3 · 模块间调用图

### `chapters.ts` → services

```
POST /api/chapters/:id/preview
  └─ PromptPipeline.run() (直接组装)
  └─ loadRuntimeBase / loadWorkerTask
  └─ MemoryManager.searchRelevant

POST /api/chapters/:id/generate
  └─ loadRuntimeBase / loadWorkerTask
  └─ MemoryManager.searchRelevant
  └─ getActivePlotArcs
  └─ formatCharacterSnapshot
  └─ PromptPipeline.run → RuntimePromptCompiler.compile
  └─ generateQueue.add → generate-processor → callAIWithLog (异步)

POST /api/chapters/:id/select
  └─ prisma.$transaction (本地)

POST /api/chapters/:id/prepare-archive
  └─ prepare-archive route (chapters-archive.ts)
       ├─ runCharacterStage (stages/character-stage.ts)
       ├─ runMemoryStage (stages/memory-stage.ts)        → memoryExtract
       ├─ runPlotArcStage (stages/plot-arc-stage.ts)
       └─ runGraphExtractStage (stages/graph-extract-stage.ts)
       ↑ 4 个 stage 并行，结果落 pendingArchiveData.stages[name]
       串行: optimizeMemories → memoryOptimize (memoryExtract success 时)
       最终写 pendingArchiveData.version === 4

POST /api/chapters/:id/prepare-archive/retry-stage/:stageName
  └─ v4 stageName: 'character' | 'memoryExtract' | 'memoryOptimize' | 'plotArc' | 'graph'
       └─ memoryExtract 重跑后自动续跑 optimizer (与 prepare-archive 行为一致)
       └─ memoryOptimize 独立重跑，要求 memoryExtract 已 success
       └─ 合并回 pendingArchiveData (version === 4)

POST /api/chapters/:id/cumulative-graph/build
  └─ buildCumulativeGraph (cumulative-graph.ts)
       ├─ relation 归一映射 (AI)
       └─ codeMerge 五元组去重 (程序)

POST /api/chapters/:id/archive
  └─ safeJsonParse (chapter.pendingArchiveData)        [version === 4]
  └─ 校验 5 stage 全 success (character / memoryExtract / memoryOptimize / plotArc / graph)
  └─ memoryExtract.result → chapter / scene / summary  Memory 写入
  └─ memoryOptimize.result.memories → global           Memory 写入
  └─ prisma.$transaction 内:
       ├─ tx.memory.create (chapter / scene / global 三层)
       ├─ tx.chapter.update({ summary })
       └─ tx.chapter.update({ chapterGraph / cumulativeGraph / cumulativeGraphGeneratedAt,
                              pendingArchiveData: null, status: 'archived' })
```

### service 间的依赖

- `stages/*-stage.ts` 调 `runtime-loader` + `ai-call-logger`（所有 AI 调用都过这一层）
- `cumulative-graph.ts` 调 `runtime-loader` + `ai-call-logger` + `stages/relation-mapping.prompt.ts`
- `memory-optimizer.ts` **不调**其他 service（独立运行；v3 已接入 `prepare-archive` 端点，archive confirm 不调）

### 前后端共享的"契约"

`ChapterStatus`（Prisma enum）是核心共享类型。**v2 收口到 3 值后**，前端不用 Prisma client，而是走单一配置源：
- 前端 `apps/web/src/styles/chapter-status.ts` 的 `CHAPTER_STATUSES` 表（3 值：`draft` / `reviewing` / `archived`），`getChapterStatus()` 查表兜底 neutral
- 后端状态转换集中在 `routes/chapters-archive.ts` 的 `updateMany where status: { in: [...] }`（`prepare-archive` / `archive` 两处；`generate` / `select` 不再翻 chapter.status）
- `packages/shared` 的 `ChapterStatus` 与 schema、前端配置三层一致（均 3 值）

`PendingArchiveData` 已收口到 `packages/shared/src/archive.ts`（Q6 已修），前后端 import 同一份。

---

## §4 · 易踩的隐含约定

### 1. `originUid` 取最新
`Memory.originUid` 形如 `3#A1B2`（章节号#hex）。同一事件可能有多条历史版本（不同章节的优化结果）。读取时按 `fromChapterNumber desc` 取最新一条。`@@unique([storyId, originUid])` 索引**没有**——靠应用层去重（`memory-optimizer.ts:36-45`）。

### 2. Jaccard 0.82 去重
`shared/jaccardSimilarity` 基于 `js-tiktoken` 的 `cl100k_base` token Set 计算。**0.82** 是去重阈值（具体在 `packages/shared/src/jaccard.ts` 中）。

### 3. JSON 字段手写序列化
Prisma schema 把 `personality` / `metadata` / `params` / `settings` / `chapterGraph` / `cumulativeGraph` / `score` / `pendingArchiveData` / `compiledPrompt` 全部声明为 `String`。路由层手写 `JSON.stringify` / `JSON.parse`（`safeJsonParse` 是主流选择，已收口到各路由统一用法）。

### 4. token 计数(2026-06-18 P1 收口后)
- `@novel-runtime/ai-provider` 的 `countTokens`(`packages/ai-provider/src/token-counter.ts`)—— 基于 `cl100k_base`,**项目 token 计数唯一入口**(commit `5f0ba92` + 修复合并 `792b533`)。所有 `apps/*` + `packages/prompt-runtime` 全部采用。
- `@novel-runtime/shared` 的 `estimateTokens`(启发式)—— 中文 1 token/字,英文 0.25 token/字,**无依赖**,仅供 `prompt-runtime/budget.ts` fallback 使用。
- `packages/{shared,memory-engine,prompt-runtime}` 3 个包**保留** `js-tiktoken` 直接装,因结构性原因(dep cycle / token ID API / model-aware)无法切到 `countTokens`。详见 `KNOWN-ISSUES.md` 第 10 条。

`prompt-runtime` 已统一从 `ai-provider` 导入。`shared` 的启发式仅作无 tiktoken 环境的 fallback（实际项目用 `ai-provider` 那套）。**修改 prompt 拼装时不要新增"自己估 token"的分支**。

### 5. `prepare*` / `commit*` 拆分（v2 → v4 演进说明）
v3 重构后 `prepareMemoryWrites` / `commitMemoryWrites` 已从主流程移除,v4 进一步把 `memory` stage 拆为 `memoryExtract` + `memoryOptimize` 两个独立 stage(详见 §6)。归档流水线现在是 4 stage 并行提取(character / memoryExtract / plotArc / graph)+ memoryOptimize 串行追加融合 + 累计图谱,结果落 `pendingArchiveData.stages[name]` / `stages.memoryOptimize.result.memories` / `cumulativeGraph`。`archive` 端点 commit 时 prisma.$transaction 写 Memory 表三层(`chapter` / `scene` / `global`,数据源 = `stages.memoryExtract.result` + `stages.memoryOptimize.result.memories`)+ Chapter.summary + Chapter 三列 + 翻 status。**CharacterBranchState / PlotArc 写入另文档讨论**;`TimelineEvent` 在 v3 删除,不再写。

详细 v3 memory system 设计见 `docs/superpowers/specs/2026-07-30-v3-memory-system-design.md`(layer 规则 / optimizer 触发点 / searchRelevant originUid 分组)。

### 6. `Chapter.compiledPrompt` / `pendingArchiveData`
都是 `String?` 字段存 JSON 文本。`compiledPrompt` 在 generate 路由里写（line 487-490），回溯用。`pendingArchiveData` 在 prepare-archive 写，archive 路由读出来再事务写入——**关键数据通道**，是 reviewing 状态机的载体。

### 7. `generateFallbackContent`（shared:148）
AI 调用失败时（`result` 为 null）的降级内容，**是 mock 章节文本不是错误**。实际 `callAIWithLog` 失败时 throw 不会触发这个 fallback——只在"AI 返回空字符串"时触发。生成按钮的"未配置 API Key"提示与 fallback 内容中的 `（生成失败：未配置 API Key）` 前缀不一致：API Key 未配时 ai-call-logger 会直接 throw，根本走不到 fallback。

### 8. 4 个同名 `init` 迁移
`prisma/migrations/` 下有 `20260602053226_init` / `20260602054702_init` / `20260602070943_init` / `20260602071708_init` 四个名字相同的迁移（10 分钟内连续），加上 `20260616044813_add_chapter_status_enum_and_pending_archive_data`。历史里有手工修复/重置 migration 的痕迹。

### 9. 已删除的 v2 服务
2026-07-30 调查收口后删除了以下 v2 时代服务文件（无生产 import，仅被自己 / 死测试 import）：`combined-extractor.ts`、`graph-extractor.ts`、`graph-organizer.ts`、`memory-extractor.ts`、`memory-compressor.ts`、`memory-organizer.ts`、`stages/cumulative-graph-build-service.ts`。同步删除了对应的 7 个死测试文件。`graph-snapshot.ts` 的 `expandNeighborhood` 函数 + `ExpandOptions`/`NeighborhoodResult` 接口同步移除（无 caller）。

### 10. CORS / 监听 / 认证
- CORS 在 `app.ts` 是 `origin: true`（允许所有来源）
- `HOST` 默认 `0.0.0.0`（监听所有网卡）
- **无任何认证层**（JWT / session / API key 都没有）—— 见 `KNOWN-ISSUES.md` S1

---

## §5 · 脚注

- `chapters.ts` 事务控制中心；旧的 `assertStatusTransition` / `VALID_STATUS_TRANSITIONS` / `preLockStatus` 补丁均已删除 —— 状态机实际靠 `updateMany where status` 原子锁 + Prisma enum 类型兜底
- **v2**：`scored` / `generating` / `generated` / `selected` / `rejected` 等旧 chapter 态已从 `ChapterStatus` 移除；选择（select）现在是 Draft 层概念，不再有对应的 chapter 状态
- 删除归档章节时（`chapters-crud.ts`）级联删同 `fromChapterNumber` 的 Memory / TimelineEvent / CharacterBranchState / PlotArc / PromptLog。**v3 不再重建图谱表**：GraphNode/Edge 已 drop（migration `20260729000000_drop_graph_node_edge`），累计图谱以各章 `Chapter.cumulativeGraph` JSON 为准，删章不影响前章快照
- 4 个 composables 都有"全局 manager"模式（`new MemoryManager()` 等），每次调用 new 一次。功能上无状态，性能上略有浪费
- `Graph.vue` 是少数用 `as any` 的前端文件（2 处）—— 用于 type any 的 graph 节点数据
- `ai-provider.ts` 的 POST 路由可以创建/更新 `aiProviderConfig` 含 `apiKey`——但 GET 路由**不过滤** `apiKey` 字段（见 `ISSUES.md` 安全类）
- schema 中 `Chapter` 的 5 个 `String?` JSON 字段（`compiledPrompt` / `chapterGraph` / `cumulativeGraph`(v3 重命名) / `pendingArchiveData` / 隐式的 `summary`）—— 任何一个损坏（DB 写入时序错 / 字符截断）都会让读取方 500

---

## §6 · v4 Stage 边界（2026-07-31, branch `v2/state-machine`）

v4 把 v3 单 `memory` stage 拆为 `memoryExtract` + `memoryOptimize` 两个独立 stage。所有 stage 服务签一致（`runXxxStage(app, input): Promise<PendingStageState<XxxStageResult>>`），由 `apps/server/src/routes/chapters-archive.ts` 的 prepare-archive 端点用 `Promise.all` 并行触发前 4 个 stage，再**串行**追加 `memoryOptimize`（依赖 `memoryExtract.success`），写入路径：

```
4 × stage.run() ─┐
                 │ Promise.all (并行)
memoryOptimize ──┘ → 串行 (仅 memoryExtract success 时调)
                       ↓
                 路由汇总
                       ↓
   Chapter.pendingArchiveData = JSON.stringify({ version: 4, stages: { ... }, meta })
```

### Stage 边界（v4 — 5 stage）

每个 stage 服务只调 AI + 解析，不写 DB。路由层负责持久化。

- **character-stage**: 仅输出 `characterStates`；锚定 `matchedCharacters`（路由层 pre-stage 文本匹配）
- **memoryExtract-stage**（v4 新名,实质是 v3 memory-stage 去掉 optimizer）: 输出 `mainEvents` / `sideEvents` / `scenes` / `emotions` / `foreshadowing` / `relationshipChanges` / `summary`；**不输出** `characterStatusChanges`（归属 character-stage）/ `timelinePosition` / `timelineEvents`（v3 已删）。产物写到 `stages.memoryExtract.result`
- **memoryOptimize-stage**（v4 新增,原 memory-optimizer 升级为独立 stage）: 仅在 memoryExtract success 时被路由层调,读 memoryExtract.result + 当前 layer='global' 跨章融合,产物 `{ memories: OptimizedMemory[] }` 写到 `stages.memoryOptimize.result.memories`。**不再**覆盖 raw 阶段输出
- **plot-arc-stage**: 输出 `plotArcs`（内部 `consolidatePlotArcs` 自己读章节 + existing arcs）
- **graph-extract-stage**: 输出 `chapterGraph`（本章范围，**不与历史合并**）；累积去重在 archive 端点 `buildCumulativeGraph` 做

Stage 输入里的 `characterNames` / `characterKeys` / `latestBranchStates` / `prevCumulativeGraphKeys` **全部由路由层独立查 DB** 提供，stage 之间不通信。

### 依赖关系 & 重试语义

- **memoryOptimize 仅在 memoryExtract success 时跑**：失败时该 stage 独立标记 `failed` + `errorMessage: 'memoryExtract 未成功,跳过 optimizer'`,不影响其他 4 stage,也不浪费 raw 抽取结果
- **retry-stage 扩展（v4）**: 5 个 stageName 合法值 `['character', 'memoryExtract', 'memoryOptimize', 'plotArc', 'graph']`（v3 的 `'memory'` 已弃用,白名单外 stageName 直接 400）。重试路由逻辑：
  - 重跑 `memoryExtract`: **自动续跑 optimizer**,两 stage 一起写回 pendingArchiveData,与 prepare-archive 行为一致
  - 重跑 `memoryOptimize`: **独立重跑**,要求 memoryExtract 已 success(否则 400 提示先重跑 memoryExtract)
  - 重跑其他 stage: 单 stage 重写回,其他不动

### Archive 策略（A 严格,v4）

- archive 端点预检：**5 stage 全 success** 才允许确认归档。任一 stage `status !== 'success'` 直接 400 列出失败 stage 名
- archive 校验 `pending.version === 4`,v3 数据一律 400「版本不匹配,请重新准备归档」

### 失败隔离

- 单 stage 失败：返回 `PendingStageState.failed` + `errorMessage`,其他 stage 结果仍写入 `pendingArchiveData.stages[name]`
- 失败 stage 用户可在 `ReviewingPanel` 重跑:
  - **总入口**「重新解析两步」(记忆 tab): 重跑 memoryExtract → 自动续跑 optimizer
  - **per-stage 按钮** (v4): 失败 stage 旁显独立重启按钮,通过后消失

### Graph 两段式（v3 重新定义,v4 沿用）

- `Chapter.chapterGraph` = `graph-extract-stage` 的本章产出（gacha，单次 AI 抽取；v3 起由用户主动编辑）
- `Chapter.cumulativeGraph` (v3 重新定义) = **用户在 ReviewingPanel 主动生成 + 编辑的工作产物**,不再是 archive 时由后端 `buildCumulativeGraph` 派生的字段
  - 首次生成：用户在 ReviewingPanel 点"生成累计图谱" → 后端 `buildCumulativeGraph` 调 AI 做 relation 字面归一映射 → 程序按映射重写 prev + chapterGraph 全部 relation → codeMerge 按五元组 key 合并 → 写入 `cumulativeGraph` JSON + `cumulativeGraphGeneratedAt` 时间戳
  - 后续编辑：用户在累计图谱区块继续编辑 → 点"保存调整" → 仅写 graph JSON,不动 `cumulativeGraphGeneratedAt`
  - 累计图谱的算法语义(merge 本章 + prev + relation 归一)与原 `buildCumulativeGraph` 等价
  - v3 起不再走 archive 阶段的 AI 重建路径
- **relation 字面归一（2026-07-28）**：dedup 阶段 AI 只输出 `mappings: [{from, to, variants, canonical}]`，程序 `applyRelationMapping` 重写边 relation 字段后交给 `codeMerge` 按 `${fromType}:${fromKey}|${relation}|${toType}:${toKey}` 五元组去重 + weight 累加。解决了跨章节 AI 抽取 relation 字面漂移（c1 "收留/决定帮助" / c2 "收留并帮助" / c3 "收留"）累积成多条字面不同的边的问题。归一策略：同义合并 / 升级到终点 / 反转到转折那条。AI 选不出时宁可不输出 mapping，保留原字面演化历史。

### 累计图谱归档前置条件（v3 新增,v4 沿用）

- 归档端点 `POST /api/chapters/:id/archive` 在 `Chapter.cumulativeGraphGeneratedAt == null || cumulativeGraph == null` 时返回 400 `cumulative-graph-not-generated`
- 前端 `ReviewingPanel.handleConfirm` 在 `cumulativeGeneratedAt` 为空时拦截 emit,弹 toast 提示用户去生成
- 数据流: 用户在 reviewing 阶段必须先点过"生成累计图谱"才能走"确认归档"

### 锁移除

v3 删除所有 `updateMany({where: {status: ...}})` 锁（v2 还在 `prepare-archive` / `archive` 两处用）。仅依赖 `ChapterStatus` 状态机自身（draft → reviewing → archived）+ UI 按钮 disabled 防双击。prepare-archive 预检在 `draft` / `reviewing` 都允许，重试时先清空 `pendingArchiveData` + `chapterGraph` 再并行触发 4 stage。

## pendingArchiveData v4

```typescript
interface PendingArchiveDataV4 {
  version: 4
  stages: {
    character: PendingStageState
    memoryExtract: PendingStageState   // v4 新名 (v3 字段名 memory 已废弃)
    memoryOptimize: PendingStageState  // v4 新增 (独立 stage)
    plotArc: PendingStageState
    graph: PendingStageState
  }
  meta: {
    extractedAt: string
    chapterNumber: number
  }
}

interface PendingStageState {
  status: 'pending' | 'running' | 'success' | 'failed'
  result?: unknown
  errorMessage?: string
  completedAt?: string
}
```

**老 v1/v2 blob 无 `version` 字段** → 前端检测为老 shape，提示用户"数据格式过旧，请重新准备归档"。v3 数据（`version: 3` 或字段 `stages.memory`）一律 400 拒归档,提示用户重新准备归档。`PendingArchiveDataV4Schema` 在 `packages/shared/src/archive.ts` 定义，前后端共用。archive 端点对 `pending.version !== 4` 一律 400。

> v3 stage 边界详见 `git log -p docs/LOGIC.md` 的历史版本。

---

## §7 · AI Provider 模型管理（v3+ 模型切换后补齐）

> 业务方当前不需 thinking（自动批量生成 + 后台归档不需要"边想边写"），早期 V3 时代默认不关心 thinking 行为。切换到 DeepSeek V4-Flash（reasoning 模型）后，AI 经常把答案塞 `reasoning_content` + `content` 留空，导致 generate / memory_stage 偶发返回空内容。手调 thinking 不直观（API 字段不暴露），需要 UI 显式配置 + Provider 行为确定化。**2026-07-31 起落 thinking 三态配置**。

### thinking 三态配置

`AiProviderConfig.thinking: String @default("auto")`，合法值三态：

| 值 | 行为 | 用例 |
|----|------|------|
| `auto` | 跟模型名启发式决定：DeepSeek 模型发 `{ thinking: { type: 'disabled' } }` 关上游 reasoning,其他模型保留上游默认 | 默认值,业务首选 |
| `enabled` | 永远不发 disabled 字段,让上游按自身默认走(可能启用也可能不启用) | 极少数场景(需要 reasoning 提升质量时) |
| `disabled` | 永远发 disabled 字段(不论模型),强制关 reasoning | 非 DeepSeek 模型也能显式关 |

**单点决策**：`packages/ai-provider/src/index.ts:57` `shouldDisableThinking(model, thinking = 'auto'): boolean` 纯函数,`callCompletions` 入口统一调用,`generate` / `generateWithRuntime` 不重复判断。`normalizeThinking`（`apps/server/src/routes/ai-provider.ts:21`）校验非法值返 400。

**UI**：`apps/web/src/views/ModelManager.vue` 表单"思考模式"三态 radio,默认 `auto`。**注意**:`.env` 的 `DEEPSEEK_API_KEY` 启动时由 `ai-provider-init.ts:117` 创建默认配置（`thinking: 'auto'`），但**不覆盖**用户已设值（`ai-provider-init.ts:94` 注释固化语义）。

### DeepSeek V4-Flash reasoning 模型风险

V4-Flash 是 reasoning 模型（`deepseek-v4-flash` / `deepseek/deepseek-v3.2` via OpenRouter 等），与 V3 (`deepseek-chat`) 行为差异：

| 维度 | V3 `deepseek-chat` | V4-Flash `deepseek-v4-flash` |
|------|---------------------|------------------------------|
| 架构 | 非 reasoning chat | reasoning 模型 |
| thinking 行为 | 默认无 | 默认开 |
| content 字段 | 始终有答案 | 经常留空,答案塞 `reasoning_content` |
| 结构化 JSON | 高 | 漂(thinking 散文化 + JSON 易被截断) |
| 偶发 200+空 body | 罕 | 上游 bug 偶发 |

`callCompletions` (`packages/ai-provider/src/index.ts:184-225`) 处理的 3 类边界:
- **情况 A**: 200 + 全空白 body → 抛 "empty response body",提示 retry / 换模型 / 查 upstream 状态页
- **情况 B**: 200 + 非空非 JSON body → 抛 "non-JSON response",带 body 切片方便识别 CDN 截断
- **情况 C**: 200 + body.error 对象 → 抛 "API error: <msg>"

### ~~`REASONING_MAX_LENGTH_FOR_FALLBACK = 4096` 经验阈值（设计债）~~ [已清理 2026-08-02]

`extractContent` 不再 fallback `reasoning_content`：content 为空就 throw "empty content"。thinking 三态配置已在请求端接管问题根源（`auto` 对 DeepSeek 默认关 upstream reasoning, 兜底路径基本不进）。

**清理内容**：删 `REASONING_MAX_LENGTH_FOR_FALLBACK` 常量 + `extractContent` reasoning_content 处理分支 + 2 个相关测试(`falls back to short reasoning_content` + `does NOT fall back to reasoning_content when too long`), 新增 1 个测试 `throws empty content when content is empty even if reasoning_content has data (no fallback)`。

**详细**：见 `docs/ISSUES.md` [设计债] 节（已加 RESOLVED 标记）。

### CharacterBranchState 类型契约（v3+ bug fix）

`CharacterBranchState.status` / `relationships` 是 `String` 列（存 JSON 文本）。prompt 写 `"status": <JSON 对象>` 但 `CharacterStateRow.status: string` —— **类型契约 vs prompt 措辞 vs 实际数据三者不一致**。`character-stage` 解析后 `w.status` 实际是 Object,`commitCharacterBranchStateWrites` 边界统一 `JSON.stringify`（`typeof === 'string'` 时不重复编码防双重）。

**类型放宽**：`CharacterStateRow.status/relationships: string | object`（`apps/server/src/services/stages/character-stage.ts:19-26`）。**详细**：见 `docs/ISSUES.md` [Bug fix 备忘]。

---

*本文档对应代码版本：commit `e28aad5`（branch `v2/state-machine` 2026-08-02），含 v4 归档流水线 + thinking 三态 + CharacterBranchState 写库 + 4KB 阈值清理。生成工具：见 `docs/superpowers/specs/2026-06-16-codebase-analysis-design.md`。*
