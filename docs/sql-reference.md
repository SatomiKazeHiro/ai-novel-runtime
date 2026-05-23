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
- 1:N `Chapter`、`Character`、`LoreItem`、`Memory`、`GraphNode`、`GraphEdge`、`TimelineEvent`、`Draft`、`PromptConfig`、`Score`、`PlotArc`、`AiProviderConfig`、`WorkerTask`
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
| `status` | String | `draft` / `generated` / `selected` / `archived` |
| `sceneLocation` | String? | 场景地点 |
| `sceneMood` | String? | 场景氛围 |
| `sceneGoal` | String? | 场景目标 |
| `runtimeProfileId` | String? FK → RuntimeProfile | 章节级写作人格覆盖 |
| `compiledPrompt` | String? | 生成时使用的完整 Prompt（JSON：{ systemMessage, userMessage, meta }） |
| `graphDelta` | String? | 相对于上一章的图谱变化（JSON：{ addedNodes, updatedNodes, addedEdges, summary }） |
| `graphSnapshot` | String? | 到当前章节的完整图谱快照（JSON：{ nodes, edges, timestamp }） |
| `createdAt` | DateTime | |
| `updatedAt` | DateTime | |

**索引**：`@@unique([storyId, number])`、`@@index([storyId, parentChapterId])`、`@@index([storyId, status])`

**关系**：
- N:1 `Story`
- N:1 `Chapter`（`parentChapter`，自关联）
- 1:N `Chapter`（`childChapters`，自关联）
- N:1 `RuntimeProfile`
- 1:N `Draft`、`Memory`、`Score`

**归档行为**：
- `archive` 路由一次性执行：状态更新 → `combined-extractor.ts` 提取 → `memory-organizer.ts` 整理 → `graph-snapshot.ts` 计算快照与变化
- 已 `archived` 再次调用会跳过（防重复污染）

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
| `relationships` | String | JSON 对象 |
| `status` | String | JSON 对象：`{ rank, location, ... }` |

**索引**：`@@unique([storyId, slug])`

---

### `Memory` — 记忆

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | String PK | |
| `storyId` | String FK → Story | |
| `chapterId` | String? FK → Chapter | 来源章节（global 层可为 null） |
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
- **Scene 记忆**：`layer='scene'` 保存格式为 `【地点】描写 | 事件：事件概括`，由 `combined-extractor.ts` 在 archive 时提取，AI 自评 importance
- 写入时通过 Jaccard 去重（`memory-extractor.ts`）
- 检索时通过语义相似度 + 章节距离衰减 + 主线优先排序
- `memory-organizer.ts` 在 archive 后对增量记忆做 AI 语义整理（merge/update/delete）

---

### `PromptLog` — AI 调用日志

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | String PK | |
| `storyId` | String FK → Story | |
| `chapterId` | String? FK → Chapter | 可选 |
| `callType` | String | `generate` / `score` / `memory_extract` / `graph_extract` / `plot_extract` / `combined_extract` / `compress` / `memory_organize` |
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

**初始化**：后端启动时扫描 `docs/profiles/*.json` 自动导入（按 `name` 去重）

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
| `status` | String | `generating` / `candidate` / `completed` / `selected` / `rejected` / `failed` |
| `createdAt` | DateTime | |
| `updatedAt` | DateTime | 自动更新 |

**状态流转**：
- `generating` → `completed`（AI 生成成功）
- `generating` → `failed`（AI 生成失败）
- `candidate` / `completed` → `selected`（用户采用）
- `candidate` / `completed` → `rejected`（其他候选被采用时自动标记）

---

## 4. 图谱与时间线

### `GraphNode` / `GraphEdge` — 知识图谱

**GraphNode**：
| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | String PK | |
| `storyId` | String FK → Story | |
| `type` | String | `character` / `faction` / `event` / `item` |
| `key` | String | 唯一标识（英文小写） |
| `label` | String | 显示名称 |
| `data` | String | JSON 扩展属性 |

**GraphEdge**：
| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | String PK | |
| `storyId` | String FK → Story | |
| `fromId` | String FK → GraphNode | |
| `toId` | String FK → GraphNode | |
| `relation` | String | 如 `隶属`、`对抗`、`师徒` |
| `weight` | Int | 默认 1 |

---

### `TimelineEvent` — 时间线事件

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | String PK | |
| `storyId` | String FK → Story | |
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

### `PromptConfig` — Prompt 模板配置（旧版兼容）

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | String PK | |
| `storyId` | String FK → Story | |
| `type` | String | `system` / `jailbreak` / `story` / `character` / `lore` / `scene` / `memory` / `style` / `instruction` |
| `name` | String | |
| `content` | String | |
| `order` | Int | |
| `enabled` | Boolean | |

---

## 6. 关系总览

```
Story
├── Chapter (1:N) ──→ Draft (1:N)
│                     Memory (1:N, chapterId 可选)
│                     Score (1:N)
├── Character (1:N)
├── LoreItem (1:N)
├── Memory (1:N, global 层 chapterId 为 null)
├── GraphNode (1:N) ──→ GraphEdge (from/to)
├── TimelineEvent (1:N)
├── PlotArc (1:N)
├── AiProviderConfig (1:N, storyId 可选)
├── WorkerTask (1:N, storyId 可选)
├── RuntimeProfile (N:1, storyId 可选)
├── PromptConfig (1:N)
├── Score (1:N)
└── PromptLog (1:N)
```

---

## 7. 迁移历史

| 时间戳 | 说明 |
|--------|------|
| `20260516092617_init` | 初始建表（Story/Chapter/Character/LoreItem/Memory/GraphNode/GraphEdge/TimelineEvent/Draft/PromptConfig/Score） |
| `20260518000000_add_runtime_profile_worker_task_plot_arc` | 新增 RuntimeProfile、WorkerTask、PlotArc |
| `20260518000001_add_ai_provider_context_length` | AiProviderConfig 增加 contextLength 字段 |
| `20260518022500_add_prompt_log` | 新增 PromptLog 表 |
| `20260518023000_add_chapter_side_story` | Chapter 增加 isSideStory，number 从 Int 改为 Float |
| `20260518104226_add_character_identity_appearance_temperament` | Character 增加 identity、appearance、temperament 字段 |
| `20260522211910_add_chapter_branch_and_draft_enhance` | Chapter 新增 parentChapterId/branchName/runtimeProfileId/compiledPrompt/graphDelta/graphSnapshot；Draft 新增 temperature/maxTokens/compiledPrompt/score/errorMessage/updatedAt，status 扩展；Score 移除 loreConsistency/characterConsistency/forbiddenContentRisk，新增 outlineAdherence/sceneMatch/profileConsistency/comment |
| `20260522214741_add_score_dimensions` | Score 表最终确认 7 维度字段结构 |
