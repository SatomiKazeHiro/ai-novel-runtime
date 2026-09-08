# SQL / Schema 参考

> 本文档面向开发和 Agent，详细说明各表的字段、关系、索引及设计意图。
> 源文件：`prisma/schema.prisma`

---

## 1. 核心模型

### `Story` — 小说工程

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | String PK | UUID |
| `title` | String | 作品标题 |
| `description` | String? | 简介 |
| `status` | String | `active` / `completed` / `archived` |
| `runtimeProfileId` | String? FK → RuntimeProfile | 小说默认绑定的写作人格 |
| `createdAt` | DateTime | |
| `updatedAt` | DateTime | 自动更新 |

**关系**：
- 1:N `Chapter`、`Character`、`LoreItem`、`Memory`、`TimelineEvent`、`Draft`、`Score`、`PlotArc`、`AiProviderConfig`、`WorkerTask`
- N:1 `RuntimeProfile`（通过 `runtimeProfileId` 绑定，可选）

---

### `Chapter` — 章节

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | String PK | UUID |
| `storyId` | String FK → Story | |
| `parentChapterId` | String? FK → Chapter | 父章节（分支树结构，null 表示根章节） |
| `branchName` | String? | 分支名称，如"主线"、"黑化IF线" |
| `number` | Float | 章节序号，正篇为整数，番外可为小数（如 3.5） |
| `isSideStory` | Boolean | 番外标记，默认 `false` |
| `title` | String | |
| `outline` | String? | 大纲 |
| `content` | String? | 正文 |
| `summary` | String? | 摘要（AI 提取生成） |
| `status` | String | `draft` / `generating` / `generated` / `scored` / `selected` / `reviewing` / `archived` / `rejected` (8 值,见 `prisma/schema.prisma` 的 `enum ChapterStatus`) |
| `sceneLocation` | String? | 场景地点 |
| `sceneMood` | String? | 场景氛围 |
| `sceneGoal` | String? | 场景目标 |
| `runtimeProfileId` | String? FK → RuntimeProfile | 章节级写作人格覆盖 |
| `compiledPrompt` | String? | 生成时使用的完整 Prompt（JSON：{ systemMessage, userMessage, meta }）。**注意**：生成候选时 backend 会同步写入此字段，确保前端编辑页面始终能展示当前 Prompt |
| `chapterGraph` | String? | 本章图谱（JSON：{ nodes, edges, timestamp }），归档 confirm 时从 pendingArchiveData 拷入 |
| `cumulativeGraph` | String? | 累计到本章的全局图谱（JSON：{ nodes, edges, timestamp }），归档 confirm 时从 pendingArchiveData 拷入 |
| `cumulativeGraphGeneratedAt` | DateTime? | 用户首次生成累计图谱的时间；null = 未生成（归档前置条件） |
| `pendingArchiveData` | String? | `reviewing` 状态时的归档 payload（JSON, `version: 3`，含 4 个 stage 结果 + 累计图谱工作副本）;ReviewingPanel 编辑经 `chaptersApi.update` 写回,confirm `archive` 时拷入 Chapter 三列后清空 |
| `createdAt` | DateTime | |
| `updatedAt` | DateTime | |

**索引**：`@@unique([storyId, number])`、`@@index([storyId, parentChapterId])`、`@@index([storyId, status])`

**关系**：
- N:1 `Story`
- N:1 `Chapter`（`parentChapter`，自关联）
- 1:N `Chapter`（`childChapters`，自关联）
- N:1 `RuntimeProfile`
- 1:N `Draft`、`Memory`、`Score`

**归档行为（v3）**：
- `prepare-archive` 阶段：4 个 stage（character/memory/plot-arc/graph-extract）并行 AI 提取 → 结果写入 `pendingArchiveData`（version=3）→ 状态变 `reviewing`。Chapter 三个图谱列全程不读写
- `cumulative-graph/build`：用户主动生成累计图谱 → 写 `pendingArchiveData.cumulativeGraph` / `cumulativeGraphGeneratedAt`
- `archive` 确认阶段：校验全 stage success + 累计图谱已生成 → 图谱数据从 `pendingArchiveData` 拷到 Chapter 三列 → `pendingArchiveData = null` → status=`archived`。衍生表事务写入为后续工作（当前 gate stub）
- 非 `reviewing` 状态调用 `archive` 返回 400

---

### `Character` — 角色卡

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | String PK | |
| `storyId` | String FK → Story | |
| `slug` | String | URL 标识（英文） |
| `name` | String | 显示名称 |
| `identity` | String | 角色身份背景 |
| `appearance` | String | 外貌描述 |
| `temperament` | String | 性格气质 |
| `personality` | String | JSON 字符串数组 |
| `speechStyle` | String | JSON 字符串数组 |

**索引**：`@@unique([storyId, slug])`

**关系**：1:N `CharacterBranchState`（角色的历史状态快照）

---

### `CharacterBranchState` — 角色历史快照

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | String PK | |
| `characterId` | String FK → Character | |
| `fromChapterNumber` | Float? | 来源章节序号，`null` 表示初始状态 |
| `status` | String | JSON 对象：`{ rank, location, ... }` |
| `relationships` | String | JSON 对象 |
| `createdAt` | DateTime | |
| `updatedAt` | DateTime | 自动更新 |

**索引**：`@@index([characterId, fromChapterNumber])`

**设计要点**：
- 每次 archive 时为每个角色插入一条新记录，形成历史链
- 查询最新状态取 `fromChapterNumber` 最大的记录
- 删除章节时级联删除同 `fromChapterNumber` 的记录，实现状态自动回退

---

### `Memory` — 记忆

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | String PK | |
| `storyId` | String FK → Story | |
| `chapterId` | String? FK → Chapter | 来源章节（global 层可为 null） |
| `fromChapterNumber` | Float? | 来源章节序号（archive 时标记，用于删除章节时级联清理） |
| `layer` | String | `global` / `chapter` / `scene` / `temporary` |
| | | - `global`：跨章节的世界观、角色状态（不衰减） |
| | | - `chapter`：章节级事件、情绪、伏笔（按章节距离衰减） |
| | | - `scene`：**关键地点记忆**，archive 时从章节提取的推动剧情的地点/场景（importance 7-10） |
| | | - `temporary`：临时上下文 |
| `content` | String | 记忆文本内容 |
| `tags` | String | JSON 字符串数组，如 `["auto-extracted", "main-plot"]` |
| `importance` | Int | 1-10，默认 5 |
| `createdAt` | DateTime | |
| `updatedAt` | DateTime | |

**设计要点**：
- `content` 中可嵌入章节来源信息（如 `[第5章] 主线：张三突破`），由 `formatForPrompt` 统一格式化
- **Scene 记忆**：`layer='scene'` 保存格式为 `【地点】描写 | 事件：事件概括`，由 `stages/memory-stage.ts` 提取（prompt 要求 AI 输出 scenes 数组），AI 自评 importance 1-10
- 检索时通过语义相似度 + 章节距离衰减 + 主线优先排序

**v3 layer 写入规则**（archive confirm commit-only 一次性写三层）：

| 数据来源 | layer | tags | importance | 来源 |
|---|---|---|---|---|
| `mainEvents[]` | `chapter` | `['auto-extracted','main-plot']` | AI 给（4~7+1）| memory-stage 原始输出 |
| `sideEvents[]` | `chapter` | `['auto-extracted']` | AI 给 | memory-stage 原始输出 |
| `emotions[]` / `foreshadowing[]` / `relationshipChanges[]` | `chapter` | `['auto-extracted']` | 写死 5 | memory-stage 原始输出 |
| `scenes[]` | `scene` | `['auto-extracted','scene-memory']` | AI 给 | memory-stage 原始输出 |
| optimizer 融合 `memories[]` | `global` | `['auto-extracted','event'\|'state']` | AI 给 | memory-optimizer 覆盖 result 后 |

`Chapter.summary` 写章节列,**不进 Memory 表**(语义是章节元数据,不是记忆)。

**累加 vs 覆盖**：optimizer 每章归档对同 UID 产生新行 layer='global'(累加,不是 update by UID)。删章节(`chapters-crud.ts:179-194`)`deleteMany where fromChapterNumber=N`,前 N-1 章同 UID 版本保留。`memory-engine.searchRelevant` 加 originUid 分组取最新版本逻辑(仅 layer='global'),自然处理"删章节回退"。

---

### `PromptLog` — AI 调用日志

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | String PK | |
| `storyId` | String FK → Story | |
| `chapterId` | String? FK → Chapter | 可选 |
| `callType` | String | `generate` / `score` / `character_stage` / `memory_stage` / `graph_extract_stage` / `plot_consolidate` / `cumulative_dedup` / `memory_optimize` |
| `aiProviderConfigId` | String FK → AiProviderConfig | 当时使用的模型配置 |
| `providerName` | String | `deepseek` / `openai` |
| `model` | String | 如 `deepseek-chat` |
| `systemMessage` | String | 完整 system message |
| `userMessage` | String | 完整 user message |
| `responseContent` | String | AI 返回的完整内容 |
| `promptTokens` | Int | API 返回的 usage.prompt_tokens |
| `completionTokens` | Int | API 返回的 usage.completion_tokens |
| `totalTokens` | Int | API 返回的 usage.total_tokens |
| `estimatedTokens` | Int | `CompiledPrompt.meta.totalTokens`（预估值） |
| `temperature` | Float? | |
| `maxTokens` | Int? | |
| `durationMs` | Int? | 调用耗时 |
| `status` | String | `success` / `error` |
| `errorMessage` | String? | |
| `createdAt` | DateTime | |

**索引**：`@@index([storyId, createdAt])`、`@@index([callType, createdAt])`

**写入方式**：`ai-call-logger.ts` 的 `callAIWithLog()` 异步写入（`.catch()`，不阻塞主流程）

---

## 2. 配置模型

### `AiProviderConfig` — AI 模型配置

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | String PK | |
| `storyId` | String? FK → Story | null 表示全局配置 |
| `name` | String | `deepseek` / `openai` / `claude` / ... |
| `apiKey` | String? | 加密存储（生产环境建议加密） |
| `baseUrl` | String? | 如 `https://api.deepseek.com` |
| `model` | String | 如 `deepseek-chat` |
| `contextLength` | Int | 默认 64000，驱动 PromptPipeline 预算动态缩放 |
| `maxTokens` | Int | 默认 4096，生成时从配置读取替代硬编码 |
| `temperature` | Float | 默认 0.7 |
| `isDefault` | Boolean | 只有一个 `true` |

**API 接口**：
- `GET /api/ai-providers` — 列表
- `GET /api/ai-providers/default` — 获取当前默认配置（生成流程使用）
- `POST /api/ai-providers/:id/default` — 设为默认

**预算联动**：`contextLength` 通过 `scaleBudget(contextLength)` 函数（`packages/shared`）线性缩放 `DEFAULT_PIPELINE_BUDGET` 各层预算。总预算留 5% 余量给 System Message 等开销。

---

### `RuntimeProfile` — Shared Runtime Base

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | String PK | |
| `storyId` | String? | null 表示全局默认 |
| `name` | String | 如 `frenesis_v1` |
| `identity` | String | `[Identity]` 层内容 |
| `settings` | String | JSON：`{ language, uncensored, repeat, speciality }` |
| `behavior` | String | `[Behavior]` 层内容 |
| `jailbreak` | String? | `[Jailbreak]` 层内容（可选） |
| `isDefault` | Boolean | |

**初始化**：后端启动时扫描 `seeds/profiles/*.yaml` 自动导入（按 `name` 去重;YAML 解析失败立即报错,无 silent fallback）

**加载优先级**：`Chapter.runtimeProfileId` → `Story.runtimeProfileId` → `isDefault=true` 全局默认 → 硬编码兜底

---

### `WorkerTask` — Worker 的 Task Layer

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | String PK | |
| `storyId` | String? | null 表示全局默认 |
| `name` | String | 方便管理的名称 |
| `workerType` | String | `generation` / `scoring` / `memory` / `graph` / `timeline` / `rewrite` / `memory_organize` |
| `taskPrompt` | String | `[Task: xxx]` 层的具体内容 |
| `enabled` | Boolean | 默认 `true` |

**加载优先级**：小说专属 > 全局默认 > 硬编码兜底（`runtime-loader.ts`）

---

## 3. 创作相关模型

### `LoreItem` — 世界观条目（LoreBook）

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | String PK | |
| `storyId` | String FK → Story | |
| `category` | String | `rank` / `map` / `skill` / `faction` / `item` / `rule` |
| `slug` | String | URL 标识 |
| `name` | String | 显示名称 |
| `content` | String | 内容 |
| `metadata` | String | JSON 对象，扩展字段 |

**索引**：`@@unique([storyId, category, slug])`

---

### `PlotArc` — 剧情弧线

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | String PK | |
| `storyId` | String FK → Story | |
| `name` | String | 弧线名称 |
| `type` | String | `main` / `side` |
| `status` | String | `pending` / `active` / `resolving` / `completed` |
| `progress` | Int | 0-100 |
| `stages` | String | JSON：`[{ stage, completed, description }]` |
| `currentStage` | String? | 当前阶段 |
| `nextGoal` | String? | 下一目标 |
| `unresolved` | String | JSON 数组，未解悬念 |
| `summary` | String? | 摘要 |

**索引**：`@@index([storyId, status])`

---

### `Draft` — 候选/废案

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | String PK | |
| `storyId` | String FK → Story | |
| `chapterId` | String FK → Chapter | |
| `version` | String | 如 `candidate_a` / `candidate_b` / `candidate_c` |
| `content` | String | 正文 |
| `temperature` | Float | 实际使用的 temperature，默认 0.7 |
| `maxTokens` | Int | 实际使用的 maxTokens，默认 4096 |
| `compiledPrompt` | String? | 生成时使用的完整 Prompt（JSON） |
| `score` | String? | 评分结果（JSON） |
| `params` | String | JSON：temperature、model、耗时等生成参数 |
| `errorMessage` | String? | 生成失败时的错误信息 |
| `status` | String | `generating` / `completed` / `failed` / `rejected` |
| `createdAt` | DateTime | |
| `updatedAt` | DateTime | 自动更新 |

**状态流转**：
- `generating` → `completed`（AI 生成成功）
- `generating` → `failed`（AI 生成失败）
- `completed` / `generating` → `rejected`（其他候选被采用时自动标记）
- v2: 不再有 `selected` —— 哪个候选被采纳只通过 `Chapter.content` 是否匹配判断，DB 不再标记

---

## 4. 图谱与时间线

### 知识图谱（v3：Chapter JSON 列，无独立表）

`GraphNode` / `GraphEdge` 表已在 migration `20260729000000_drop_graph_node_edge` 删除。图谱数据存在 `Chapter` 的三个 JSON 列（见 §1 Chapter 字段表）：

- `chapterGraph` — 本章图谱
- `cumulativeGraph` — 累计全局图谱
- `cumulativeGraphGeneratedAt` — 累计图谱生成时间

图谱 JSON 形状：`{ nodes: [{ type, key, label, data }], edges: [{ fromType, fromKey, toType, toKey, relation, weight }], timestamp }`（zod schema 见 `packages/shared/src/archive.ts` 的 `PendingGraphSnapshotSchema`）。

---

### `TimelineEvent` — 时间线事件

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | String PK | |
| `storyId` | String FK → Story | |
| `fromChapterNumber` | Float? | 来源章节序号（archive 时标记，用于删除章节时级联清理） |
| `day` | Int | 第几天 |
| `events` | String | JSON 字符串数组 |

**索引**：`@@unique([storyId, day])`

---

## 5. 其他模型

### `Score` — 评分记录

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | String PK | |
| `storyId` | String FK → Story | |
| `chapterId` | String FK → Chapter | |
| `draftId` | String? | 可选 |
| `styleSimilarity` | Float? | 文风接近度（对比近 2-3 章 archived 内容） |
| `outlineAdherence` | Float? | 大纲符合度 |
| `sceneMatch` | Float? | 场景符合度（地点/氛围/目标匹配） |
| `profileConsistency` | Float? | 写作人格一致性 |
| `proseQuality` | Float? | 文笔质量 |
| `emotionalTension` | Float? | 情感张力 |
| `pacing` | Float? | 节奏把控 |
| `totalScore` | Float? | 总分（7 维度均值） |
| `comment` | String? | AI 评语（50字以内） |
| `details` | String | JSON：原始 AI 结果 + 规则评分兜底 |

---

## 6. 关系总览

```
Story
├── Chapter (1:N) ──→ Draft (1:N)
│                     Memory (1:N, chapterId 可选)
│                     Score (1:N)
├── Character (1:N) ──→ CharacterBranchState (1:N)
├── LoreItem (1:N)
├── Memory (1:N, global 层 chapterId 为 null)
├── TimelineEvent (1:N)
├── PlotArc (1:N)
├── AiProviderConfig (1:N, storyId 可选)
├── WorkerTask (1:N, storyId 可选)
├── RuntimeProfile (N:1, storyId 可选)
├── Score (1:N)
└── PromptLog (1:N)
```

---

## 7. 迁移历史

> 与 `prisma/migrations/` 目录一一对应。

| 时间戳 | 说明 |
|--------|------|
| `20260602053226_init` ~ `20260602071708_init` | 初始建表（4 次 init 合并期） |
| `20260616044813_add_chapter_status_enum_and_pending_archive_data` | ChapterStatus enum + `Chapter.pendingArchiveData` |
| `20260616060000_add_draft_id_chapterId_compound_unique` | Draft (id, chapterId) 复合唯一 |
| `20260624054620_add_story_cover_url` | Story 增加 coverUrl |
| `20260626000000_timeline_position_encoding` | TimelineEvent.position 改 Y.DDDHH 编码 |
| `20260627000000_plot_arc_soft_dedup` | PlotArc 软去重 |
| `20260724000000_chapter_status_v2` | ChapterStatus 缩为 3 值（draft/reviewing/archived） |
| `20260725000000_rename_graph_fields` | Chapter 列重命名：graphDelta → chapterGraph，graphSnapshot → cumulativeGraph |
| `20260727062235_add_cumulative_graph_generated_at` | Chapter 增加 cumulativeGraphGeneratedAt |
| `20260729000000_drop_graph_node_edge` | 删除 GraphNode/GraphEdge 表（v3 图谱唯一数据源 = Chapter JSON 列） |
