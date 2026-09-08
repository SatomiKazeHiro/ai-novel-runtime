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

**归档五阶段**（5-phase pipeline，跨 2 个 HTTP 端点）：

```
[prepare-archive]                       [archive 确认]
阶段 1: extractAll        ─┐
   合并提取(记忆+图谱+弧线) │
阶段 2: organizeGraph     ─┤  ← 全部纯 AI 调用，无 DB 写
   全局图谱整理              │
   写入 Chapter.pendingArchiveData
   状态变 reviewing          ┘
                            ┌─ 阶段 3: 事务写入(Memory/GraphNode/PlotArc/...)
                            │   状态变 archived
                            └─ 阶段 4: optimizeMemories (失败不阻塞)
```

**核心模块地图**（按代码量降序）：

- 后端 `apps/server`：14 路由 + 15 service
- 前端 `apps/web`：11 api + 4 composables + 16 view
- 共享 `packages/*`：6 个包

**最关键代码位置**（按"被读次数"算）：
- `apps/server/src/routes/chapters.ts` (809 行) — 归档流水线的事务控制中心
- `apps/web/src/views/Chapters.vue` (1093 行) — 编辑/审查/归档的前端调度
- `apps/web/src/views/ReviewingPanel.vue` (498 行) — 人工审查 UI
- `apps/server/src/services/combined-extractor.ts` (262 行) — 一次 AI 调用同时提取三件事

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
| `/api/drafts/:id/score` + `/api/stories/:id/scores` | `routes/scores.ts` | 7 维度 AI 评分 + 规则引擎 fallback |
| `/api/runtime-profiles` | `routes/runtime-profile.ts` | 写作人格 CRUD |
| `/api/worker-tasks` | `routes/worker-task.ts` | Worker 任务模板 CRUD |
| `/api/ai-providers` | `routes/ai-provider.ts` | AI Provider 配置 CRUD + 默认设置 + 连通性测试 |
| `/api/stories/:id/prompt-logs` + `/api/prompt-logs/:id` | `routes/prompt-logs.ts` | Prompt 调用日志分页查询 |
| `/api/health` | `routes/health.ts` | 健康检查 |

**15 个 service**（按调用频率排）：

| Service | 职责 | 状态 |
|---------|------|------|
| `combined-extractor.ts` | **一次 AI 调用同时提取** memory + graph + plotArc | 核心 |
| `graph-organizer.ts` | AI 合并全局图谱 + 本章提取 → mergedGraph + chapterGraph | 核心 |
| `memory-optimizer.ts` | 每章归档后**融合新旧 global 记忆** | 核心 |
| `generate-processor.ts` | 队列 worker，**串行**调用 AI 生成每个 draft | 核心 |
| `ai-call-logger.ts` | **统一 AI 调用封装**，自动写 PromptLog（成功/失败都记） | 核心 |
| `runtime-loader.ts` | 加载 `RuntimeBase` 和 `WorkerTask`（Story → 全局 → 硬编码回退） | 核心 |
| `memory-extractor.ts` | 提取章节记忆 + 准备写入数据（`prepareMemoryWrites` / `commitMemoryWrites` 拆分） | 核心 |
| `graph-extractor.ts` | 从章节文本提取图谱节点/边 | 辅助 |
| `graph-snapshot.ts` | 图谱快照保存 + 重建（删除章节时用） | 辅助 |
| `plot-extractor.ts` | 剧情弧线提取 + 状态推进 | 辅助 |
| `ai-provider-init.ts` | 启动时从 `.env` 同步 DeepSeek 配置到 DB | 启动 |
| `runtime-profile-init.ts` | 启动时扫描 `docs/profiles/*.json` 导入 Profile | 启动 |
| `worker-task-init.ts` | 启动时初始化系统默认 WorkerTask | 启动 |
| `memory-compressor.ts` | **@deprecated** — 旧版每 5 章压缩，已被 `memory-optimizer` 取代 | 死代码 |
| `memory-organizer.ts` | **@deprecated** — 旧版每章整理，已被 `memory-optimizer` 取代 | 死代码 |

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
| `@novel-runtime/scoring-engine` | 7 维度规则评分 | `scoringEngine`（AI 评分在服务端实现） |

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

候选生成（`POST /generate`）与选择（`POST /select`）**不再修改 `Chapter.status`**。它们只读写 `Draft.status`（候选层 6 值：`pending` / `generating` / `completed` / `failed` / `selected` / `rejected`）。`select` 只把选中 draft 置 `selected`、同章其余置 `rejected`，并按 `overrideContent`（默认 true）可选覆盖 `Chapter.content`。

**archived 章节的 generate**：

`archived` 章节不允许再生成/选择候选（UI 隐藏按钮，`generate` / `select` 路由层兜底 400，见 `chapters-generate.ts:148,278`）。已入队的候选继续跑完——worker 只看 `Draft.status`，不读 `Chapter.status`。

**锁机制**：

只有 `prepare-archive` / `archive` 用 `updateMany where status: { in: [...] }` 做原子锁（防止双击触发 2× AI 调用 / 2× 事务写入）：

- `prepare-archive`：`where status ∈ ['draft', 'reviewing']` → `reviewing`（`chapters-archive.ts:68`）
- `archive`：`where status = 'reviewing'` → `archived`（`chapters-archive.ts:164`）

`generate` / `select` **不再翻 `chapter.status`，没有跨字段锁**——双击并发会产生 2 批 draft，用户最终看到候选数翻倍，但无脏状态（`chapters-generate.ts:155-157` 注释固化此语义）。

**注意**：`assertStatusTransition` / `VALID_STATUS_TRANSITIONS` / `preLockStatus` 等旧补丁已在 v2 前的重构中全部删除，无对应代码。状态转换靠 `updateMany` 模式 + Prisma enum 类型层兜底。

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

### 5-phase 归档流水线（详细）

| 阶段 | 文件 | 端点 | AI 调用 | 失败语义 |
|------|------|------|---------|---------|
| 1 提取 | `combined-extractor.ts:extractAll` | `prepare-archive` | 1 次（合并提取，temperature 0.3） | **v2**：catch → 回退 `draft` + 500 |
| 2 整理 | `graph-organizer.ts:organizeGraph` | `prepare-archive` | 1 次（temperature 0.2，maxTokens 8192） | **v2**：catch → 回退 `draft` + 500 |
| 2.5 人工审查 | `ReviewingPanel.vue` | `save-pending-archive-data` (用户点"保存调整") | 0 次 | 用户编辑失败可重试 |
| 3 事务 | `routes/chapters-archive.ts:archive` | `archive` | 0 次 | 事务回滚，章节维持 `reviewing` |
| 4 优化 | `memory-optimizer.ts:optimizeMemories` | `archive`（事务后） | 1 次（temperature 0.3） | **不阻塞**归档（已 try/catch） |

**阶段 3 事务范围**：`commitMemoryWrites` + summary 更新 + `commitPlotArcWrites` + `saveGraphSnapshotAndDelta` + `chapter.status = 'archived'` + `pendingArchiveData = null`。**全部成功或全部回滚**。

**阶段 2.5 用户操作**：
- "保存调整" → `chaptersApi.update({ pendingArchiveData: JSON.stringify(data) })`
- "确认归档" → `chaptersApi.update({ pendingArchiveData })` → `chaptersApi.archive()`（双步串行）
- "取消" → `chaptersApi.remove(chapterId)`（**删除章节本身**）

### AI 调用全景表

| callType | 温度 | maxTokens | 用途 | 关键参数 |
|----------|------|-----------|------|---------|
| `generate` | 0.6 / 0.75 / 0.9 | 用户定 | 章节正文生成 | 9 层 Pipeline 拼装 |
| `combined_extract` | 0.3 | 4096 | 一次合并提取 | 章节内容截断 8000 字 |
| `graph_organize` | 0.2 | 8192 | 图谱整理 | merged + chapter 双产物 |
| `memory_optimize` | 0.3 | 4096 | 跨章 global 记忆融合 | 区分 user-edited vs auto |
| `score` | 0.5 | 4096 | 7 维度评分 | 失败时 fallback 到规则引擎 |

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
  └─ prepareArchiveData (combined-extractor)
       ├─ extractAll
       ├─ organizeGraph (graph-organizer)
       ├─ prepareMemoryWrites (memory-extractor)
       └─ consolidatePlotArcs (plot-consolidator, 直接读章节 + existing arcs 做语义级判断)

POST /api/chapters/:id/archive
  └─ safeJsonParse (chapter.pendingArchiveData)
  └─ prisma.$transaction
       ├─ commitMemoryWrites (memory-extractor)
       ├─ commitPlotArcWrites (plot-extractor)
       └─ saveGraphSnapshotAndDelta (graph-snapshot)
  └─ optimizeMemories (memory-optimizer, 事务外, try/catch)
```

### service 间的依赖

- `combined-extractor` 调 `graph-organizer`（phase 2）和 `memory-extractor` / `plot-extractor` 的 `prepare*` 函数
- `memory-optimizer` **不调**其他 service（独立运行）
- `generate-processor` 调 `ai-call-logger`（所有 AI 调用都过这一层）

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
`shared/jaccardSimilarity` 基于 `js-tiktoken` 的 `cl100k_base` token Set 计算。**0.82** 是去重阈值（在 `memory-extractor.ts` 的某处 hardcode，但代码里我没找到具体数字——KNOW-ISSUES 说有，实际可能散落在 prompt 文案里）。

### 3. JSON 字段手写序列化
Prisma schema 把 `personality` / `metadata` / `params` / `settings` / `graphSnapshot` / `graphDelta` / `score` / `pendingArchiveData` / `compiledPrompt` 全部声明为 `String`。路由层手写 `JSON.stringify` / `JSON.parse`（`safeJsonParse` 存在但**只有 3 处用**：`combined-extractor.ts:220` / `chapters.ts:246` / `chapters.ts:646`）。**前后端契约不一致**：`prepare-archive` 路由返回的对象是 `data: pending`（已解析），前端 `useChapterEditor.ts:150` 又 `JSON.parse(res.data.data)` → 抛错 → 吞掉 → ReviewingPanel 进不去。

### 4. token 计数(2026-06-18 P1 收口后)
- `@novel-runtime/ai-provider` 的 `countTokens`(`packages/ai-provider/src/token-counter.ts`)—— 基于 `cl100k_base`,**项目 token 计数唯一入口**(commit `5f0ba92` + 修复合并 `792b533`)。所有 `apps/*` + `packages/prompt-runtime` 全部采用。
- `@novel-runtime/shared` 的 `estimateTokens`(启发式)—— 中文 1 token/字,英文 0.25 token/字,**无依赖**,仅供 `prompt-runtime/budget.ts` fallback 使用。
- `packages/{shared,memory-engine,prompt-runtime}` 3 个包**保留** `js-tiktoken` 直接装,因结构性原因(dep cycle / token ID API / model-aware)无法切到 `countTokens`。详见 `KNOWN-ISSUES.md` 第 10 条。

`prompt-runtime` 已统一从 `ai-provider` 导入。`shared` 的启发式仅作无 tiktoken 环境的 fallback（实际项目用 `ai-provider` 那套）。**修改 prompt 拼装时不要新增"自己估 token"的分支**。

### 5. `prepare*` / `commit*` 拆分
归档流水线把"准备数据"和"事务写入"分开：`prepareMemoryWrites` / `commitMemoryWrites`、`prepareArchiveData`（合并准备）。剧情弧线由 `plot-consolidator` v2 直接读章节 + existing arcs 做语义判断后返回 `ConsolidatedArcWrite[]`，不需要再 prepare。这样路由层能控制事务边界——纯数据准备不进事务，事务只做 DB 写。

### 6. `Chapter.compiledPrompt` / `pendingArchiveData`
都是 `String?` 字段存 JSON 文本。`compiledPrompt` 在 generate 路由里写（line 487-490），回溯用。`pendingArchiveData` 在 prepare-archive 写，archive 路由读出来再事务写入——**关键数据通道**，是 reviewing 状态机的载体。

### 7. `generateFallbackContent`（shared:148）
AI 调用失败时（`result` 为 null）的降级内容，**是 mock 章节文本不是错误**。实际 `callAIWithLog` 失败时 throw 不会触发这个 fallback——只在"AI 返回空字符串"时触发。生成按钮的"未配置 API Key"提示与 fallback 内容中的 `（生成失败：未配置 API Key）` 前缀不一致：API Key 未配时 ai-call-logger 会直接 throw，根本走不到 fallback。

### 8. 4 个同名 `init` 迁移
`prisma/migrations/` 下有 `20260602053226_init` / `20260602054702_init` / `20260602070943_init` / `20260602071708_init` 四个名字相同的迁移（10 分钟内连续），加上 `20260616044813_add_chapter_status_enum_and_pending_archive_data`。历史里有手工修复/重置 migration 的痕迹。

### 9. `@deprecated` services 还在
`memory-compressor.ts` / `memory-organizer.ts` 文件还在 repo 里没删，README 标 @deprecated。**未确认**有没有任何路由还在 import（grep 里有引用——但 import 不等于调用）。

### 10. CORS / 监听 / 认证
- CORS 在 `app.ts` 是 `origin: true`（允许所有来源）
- `HOST` 默认 `0.0.0.0`（监听所有网卡）
- **无任何认证层**（JWT / session / API key 都没有）—— 见 `KNOWN-ISSUES.md` S1

---

## §5 · 脚注

- `chapters.ts` 事务控制中心；旧的 `assertStatusTransition` / `VALID_STATUS_TRANSITIONS` / `preLockStatus` 补丁均已删除 —— 状态机实际靠 `updateMany where status` 原子锁 + Prisma enum 类型兜底
- **v2**：`scored` / `generating` / `generated` / `selected` / `rejected` 等旧 chapter 态已从 `ChapterStatus` 移除；评分（score）与选择（select）现在是 Draft 层概念，不再有对应的 chapter 状态
- 评分路由（`scores.ts`）用了"try 多次 parse + 规则 fallback"，比 extractors 健壮
- 删除归档章节时（`chapters.ts:184-286`）有一段复杂的"重建图谱"逻辑：找上一章 `graphSnapshot` → `rebuildGraphFromSnapshot` → 兜底 `deleteMany` 全图谱。**失败只 log 不 throw**（line 249-251）—— 删除后图谱可能半残但路由返回 200
- 4 个 composables 都有"全局 manager"模式（`new MemoryManager()` 等），每次调用 new 一次。功能上无状态，性能上略有浪费
- `Graph.vue` 是少数用 `as any` 的前端文件（2 处）—— 用于 type any 的 graph 节点数据
- `ai-provider.ts` 的 POST 路由可以创建/更新 `aiProviderConfig` 含 `apiKey`——但 GET 路由**不过滤** `apiKey` 字段（见 `ISSUES.md` 安全类）
- schema 中 `Chapter` 的 5 个 `String?` JSON 字段（`compiledPrompt` / `graphDelta` / `graphSnapshot` / `pendingArchiveData` / 隐式的 `summary`）—— 任何一个损坏（DB 写入时序错 / 字符截断）都会让读取方 500

---

*本文档对应代码版本：commit `12c6880` 之前。生成工具：见 `docs/superpowers/specs/2026-06-16-codebase-analysis-design.md`。*
