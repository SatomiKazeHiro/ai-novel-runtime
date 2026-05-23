# AI Novel Runtime — Agent Guide

> 本文档面向 AI Coding Agent。如果你对该项目一无所知，请从本文件开始阅读。

---

## 1. 项目概述

**AI Novel Runtime** 是一个「AI 小说工程化 Runtime 系统」。

目标不是让 AI 自动写小说，而是让用户可以**稳定、高质量、可控地**开发长篇小说。

核心思想：
- **人类主导方向**
- **AI 负责生成**
- **Runtime 负责稳定**

系统采用 **pnpm Monorepo** 结构，主要包含：
- 一个 Fastify 后端 (`apps/server`)
- 一个 Vue 3 前端 (`apps/web`)
- 多个共享核心引擎包 (`packages/*`)

---

## 2. 技术栈

### 前端
| 技术 | 说明 |
|------|------|
| Vue 3 | Composition API |
| TypeScript | Strict 模式 |
| Vite | 构建工具，开发端口 5173 |
| Pinia | 状态管理 |
| Vue Router | 路由 |
| Naive UI | 组件库 |
| Axios | HTTP 请求 |

### 后端
| 技术 | 说明 |
|------|------|
| Node.js | v20+ |
| TypeScript | Strict 模式 |
| Fastify | Web 框架 + 插件化路由 |
| Prisma | ORM + 类型安全 |
| BullMQ | 任务队列 |
| IORedis | Redis 客户端 |
| graphology | 图引擎 |
| js-tiktoken | Token 计算 |

### 数据库
| 环境 | 数据库 |
|------|--------|
| 开发 | SQLite（零配置启动） |
| 生产 | PostgreSQL（切换仅需改 `.env` + `prisma/schema.prisma`） |

### 包管理
- **pnpm** `>= 10.33.4`（通过 `packageManager` 字段锁定）
- Workspace 范围：`apps/*` + `packages/*`
- 所有子包使用 `workspace:*` 引用内部依赖

---

## 3. 项目结构

```
novel-runtime/
├── apps/
│   ├── server/              # Fastify 后端
│   │   └── src/
│   │       ├── server.ts    # 入口：加载 .env、启动 Worker、监听端口
│   │       ├── app.ts       # Fastify 应用构建（注册插件、路由、队列处理器）
│   │       ├── plugins/
│   │       │   └── prisma.ts           # Prisma Client 插件（装饰 fastify.prisma）
│   │       ├── routes/      # API 路由（按领域划分）
│   │       │   ├── health.ts
│   │       │   ├── stories.ts
│   │       │   ├── characters.ts
│   │       │   ├── lore.ts
│   │       │   ├── timeline.ts
│   │       │   ├── chapters.ts
│   │       │   ├── drafts.ts
│   │       │   ├── graph.ts
│   │       │   ├── memories.ts
│   │       │   ├── scores.ts
│   │       │   ├── runtime-profile.ts
│   │       │   ├── worker-task.ts
│   │       │   ├── ai-provider.ts
│   │       │   └── prompt-logs.ts       # Prompt 调用日志查询
│   │       ├── services/    # 业务处理器
│   │       │   ├── ai-provider-init.ts      # 从 DB 初始化默认 AI Provider
│   │       │   ├── generate-processor.ts    # 章节生成队列处理器（核心）
│   │       │   ├── memory-extractor.ts      # 记忆提取（单一职责，archive 时由 combined 调用）
│   │       │   ├── graph-extractor.ts       # 图谱提取（单一职责，archive 时由 combined 调用）
│   │       │   ├── plot-extractor.ts        # 剧情弧线提取（单一职责，archive 时由 combined 调用）
│   │       │   ├── combined-extractor.ts    # 合并提取：记忆+图谱+弧线，一次 API 调用
│   │       │   ├── graph-snapshot.ts        # 归档时构建图谱快照 + 计算图谱变化（graphSnapshot/graphDelta）
│   │       │   ├── ai-call-logger.ts        # AI 调用统一 wrapper + PromptLog 自动记录
│   │       │   ├── memory-compressor.ts     # 记忆压缩（每5章触发，规则式摘要）
│   │       │   ├── memory-organizer.ts      # AI 记忆整理器（archive 后触发，语义 merge/update/delete）
│   │       │   └── runtime-loader.ts        # 加载 RuntimeProfile + WorkerTask
│   │       └── queue/
│   │           └── index.ts                 # BullMQ / 内存队列封装 + Worker 启动
│   └── web/                 # Vue 3 前端
│       └── src/
│           ├── main.ts
│           ├── App.vue
│           ├── router/        # Vue Router 配置
│           ├── stores/        # Pinia Stores（theme, story）
│           ├── api/           # API 封装层（按领域划分）
│           ├── views/         # 页面组件
│           │   ├── Dashboard.vue
│           │   ├── Stories.vue
│           │   ├── Characters.vue
│           │   ├── LoreBook.vue
│           │   ├── Chapters.vue
│           │   ├── Timeline.vue
│           │   ├── Graph.vue
│           │   ├── Memory.vue
│           │   ├── RuntimeProfile.vue
│           │   ├── WorkerTask.vue
│           │   ├── StoryWorkerTask.vue
│           │   ├── ModelManager.vue
│           │   └── PromptLogs.vue
│           └── utils/
│               └── api.ts     # Axios 实例配置
├── packages/                  # 共享包（Monorepo）
│   ├── shared/                # 类型、常量、工具函数
│   ├── ai-provider/           # AI Provider 统一封装（OpenAI / DeepSeek / 可扩展）
│   ├── prompt-runtime/        # Prompt Pipeline / Assembler + Token 预算控制
│   ├── memory-engine/         # 分层记忆管理 + 语义检索
│   ├── knowledge-graph/       # graphology 图引擎封装
│   ├── scoring-engine/        # 7 维度评分引擎
│   └── warning-engine/        # 预警检测引擎（当前为空）
├── docs/
│   ├── sql-reference.md            # 完整 Schema 字段说明、关系图、迁移历史
│   └── profiles/                   # 预设写作人格目录
│       ├── default.json            # 基础写作助手（默认）
│       ├── xianxia.json            # 修仙长生
│       ├── xuanhuan.json           # 玄幻争霸
│       ├── gufeng.json             # 古风权谋
│       ├── gudai-richang.json      # 古代日常
│       ├── chuanyue-gudai.json     # 穿越古代
│       ├── dushi.json              # 都市风云
│       ├── kehuan.json             # 科幻未来
│       ├── xuanyi.json             # 悬疑推理
│       ├── guize.json              # 规则怪谈
│       └── qingxiaoshuo.json       # 轻小说
├── prisma/
│   ├── schema.prisma          # 数据库模型定义
│   ├── dev.db                 # SQLite 开发数据库
│   └── migrations/            # Prisma 迁移文件
├── .env                       # 环境变量（DATABASE_URL, REDIS_URL, API keys）
├── package.json               # Root workspace 配置
├── pnpm-workspace.yaml        # pnpm 工作区声明
└── README.md                  # 面向人类的项目文档
```

---

## 4. 常用命令

所有命令均在项目根目录执行：

```bash
# 安装依赖
pnpm install

# 初始化数据库
pnpm db:migrate

# 一键同时启动前后端（开发模式）
pnpm dev
# 后端 http://localhost:3000
# 前端 http://localhost:5173（已配置 proxy 到后端 /api）

# 分别启动
pnpm --filter server dev
pnpm --filter web dev

# 构建所有包
pnpm build

# 类型检查所有包
pnpm typecheck

# 运行测试（当前无测试文件）
pnpm test

# 数据库管理
pnpm db:studio        # Prisma Studio 可视化数据
pnpm db:migrate       # 数据库迁移
pnpm db:generate      # 重新生成 Prisma Client
pnpm db:seed          # 运行种子脚本
```

---

## 5. 核心架构设计

### 5.1 章节状态机

```
Draft → Generated → Selected → Archived
  ↓         ↓          ↓              ↑
Rejected  (无)      (无)      合并提取（记忆+图谱+弧线）+ AI记忆整理 + graphSnapshot
```

**分支树模型**：章节不再是线性列表，而是树形结构。每个章节通过 `parentChapterId` 指向父章节，`childChapters` 为子章节列表。`branchName` 标识分支名称（如"主线"、"黑化IF线"）。

- **发展（Develop）**：只有 `archived` 状态的章节可以"发展"出下一章或番外，自动继承父章节的 `runtimeProfileId`
- **删除规则**：`archived` 且有 `archived` 子章节的不可删除；draft/generated 等随意删除
- **序号策略**：根章节按传统递增（1, 2, 3...）；子章节取同父最大序号 + 1；番外支持小数序号
- **分支树查询**：`GET /api/stories/:storyId/chapter-tree` 返回嵌套树结构（手动建树，Prisma 不支持递归 CTE）

- **提取时机**：仅在 `archive` 时执行
- **提取方式**：`combined-extractor.ts` 一次 API 调用同时完成记忆提取、图谱提取、剧情弧线分析
- **AI 记忆整理**：`memory-organizer.ts` 在 archive 后自动触发，对新旧记忆做语义层面的 merge/update/delete
- **图谱快照（graphSnapshot）**：归档后自动保存当前 story 的完整图谱状态（所有节点+边）到 `Chapter.graphSnapshot`
- **图谱变化（graphDelta）**：对比上一章（父章节优先）的 `graphSnapshot`，计算新增节点、更新节点、新增边，保存到 `Chapter.graphDelta`
- **场景记忆（Scene Memory）**：`combined-extractor.ts` 提取 `scenes: [{ location, description?, event, importance }]`，AI 自评 importance 1-10，仅提取 importance >= 7 的推动剧情的关键地点

### 5.2 Prompt Pipeline（分层 Prompt 组装）

Runtime 采用 **Stateless Generation** 模式：每次生成都是全新上下文，不续聊天记录。

Prompt 分层结构（从上到下组装为 User Message）：
1. **Style** — 文风设定
2. **Story** — 作品基本信息
3. **Lore** — 世界观设定
4. **Character** — 角色快照
5. **Scene** — 场景状态（地点、氛围、目标）
6. **Memory** — 相关记忆（语义检索 + 重要性排序）
7. **Timeline** — 时间线事件
8. **PlotArc** — 活跃剧情弧线
9. **Output** — 生成指令

System Message 由 `RuntimePromptCompiler` 编译：
- `[Identity]` + `[Settings]` + `[Behavior]` + `[Jailbreak]` + `[Task]`

### 5.3 Context Budget（Token 预算控制）

预算不再硬编码，而是从 `AiProviderConfig.contextLength` 动态派生。

**基准模板**（`DEFAULT_PIPELINE_BUDGET`，基于 64000 tokens）：

| 层 | 预算 | 占比 |
|--|--|--|
| style | 2000 | 3.1% |
| story | 12000 | 18.8% |
| lore | 10000 | 15.6% |
| character | 12000 | 18.8% |
| scene | 12000 | 18.8% |
| memory | 8000 | 12.5% |
| timeline | 4000 | 6.3% |
| plotArc | 3000 | 4.7% |
| output | 16000 | 25.0% |

**动态缩放**：`scaleBudget(contextLength)` 按实际模型的 `contextLength` 线性缩放各层预算，总预算留 5% 余量（`contextLength * 0.95`）。例如配置 128K 模型后，memory 层预算从 8000 自动变为 16000。

`PromptAssembler` 负责动态裁剪：超出预算时按字符数截断，并标记 `truncated`。

### 5.4 记忆系统（四层 + Checkpoint）

```
Global Memory    → 世界观、角色关系、长期目标（跨章节，不衰减）
Chapter Memory   → 本章事件、情绪变化、伏笔（按章节距离衰减）
Scene Memory     → 推动剧情的关键地点/场景（archive 时从章节提取，importance 7）
Temporary Memory → 临时上下文
```

> **注意**：Prompt Pipeline 中也有 `Scene` 层（`Chapter.sceneLocation/sceneMood/sceneGoal`），那是**生成时的场景状态**，与 Memory 表 `layer: 'scene'` 是不同概念。后者是从已归档章节中提取的持久化场景记忆。

**Checkpoint 机制**：生成第 N 章时，只读取「最后一个已归档章节」之前的记忆。修改旧章节（不重新归档）不会影响后续章节的生成上下文。

**检索流程**：
1. `searchRelevant(query)` → 语义检索（余弦相似度×0.7 + 重要性×0.3），取 Top N
2. **近似去重**（Jaccard > 0.82）→ 相似记忆只保留一条，避免挤占名额
3. **番外排除** → `isSideStory = true` 的章节记忆不纳入主线上下文
4. `formatForPrompt()` → 精确去重 + 章节距离衰减（>5章-1，>10章-2，>20章-3）+ 主线优先（main-plot +2）

**Scene 记忆提取**：`combined-extractor.ts` 在 archive 时提取 `scenes: [{ location, description?, event }]`，保存为 `layer: 'scene'`。规则：只提取"推动剧情发展的地点"，路人提及、无事件发生的地点不提取。

**写入去重**：`saveExtractedMemory()` 写入前检查最近 50 条记忆的 Jaccard 相似度，> 0.82 则跳过，防止同一事件在不同章节被重复提取。

**AI 记忆整理**：`memory-organizer.ts` 在 archive 后自动触发，调用 1 次 API 对新旧记忆做语义层面的 merge/update/delete。保守策略：merge 要求被合并记忆的平均 Jaccard > 0.5，delete 只删旧记忆。让 AI 处理硬编码规则做不到的事（如"张三去后山"和"张三在后山修炼"的语义合并）。

注入 Prompt 的格式示例：
```
- [chapter]【主线】(第5章·0章前) 张三和李四发生冲突
- [chapter]【主线】(第2章·3章前) 王五暗中观察
- [global] (第5章·0章前) 【张三】状态更新：{"rank": "初级"}
```

### 5.5 队列系统与异步生成

使用 **BullMQ** + **IORedis**。如果 Redis 不可用（如开发环境），自动降级为 **内存队列（MemoryQueue）**。

队列类型：
- `generate` — 章节生成（异步）
- `score` — 评分任务
- `memory` — 记忆更新

**异步生成流程**：
1. 前端调用 `POST /generate` → 后端创建 N 个 `status='generating'` 的 Draft → 立即返回
2. `generateQueue.add('generate-chapter', ...)` 将任务入队
3. `generate-processor` 后台逐个调用 AI，完成后更新 Draft `status='completed'` + `content` + `compiledPrompt`
4. 同时更新 `Chapter.compiledPrompt`，确保前端编辑页面始终能展示当前 Prompt
5. 失败时更新 `status='failed'` + `errorMessage`
5. 前端轮询 `GET /api/chapters/:id/drafts`（每 2 秒），自动刷新候选列表

处理器在 `app.ts` 中注册，Worker 在 `server.ts` 启动时拉起。

### 5.6 AI Provider 统一接口

```ts
interface AIProvider {
  generate(prompt: string, options?: any): Promise<string>
  generateWithRuntime?(compiled: CompiledPrompt, options?: any): Promise<string>
  streamGenerate(prompt: string, options?: any): AsyncIterable<string>
  embedding?(text: string): Promise<number[]>
  readonly lastUsage?: TokenUsage | null  // API 返回的 prompt/completion/total tokens
}
```

已实现的 Provider：
- `OpenAIProvider` — 骨架实现（调用时抛出 `not yet implemented`，待接入真实 API）
- `DeepSeekProvider` — 完整实现（调用 DeepSeek API `/v1/chat/completions`，30s timeout，自动读取 `usage` 到 `lastUsage`）

**PromptLog 自动记录**：所有 AI 调用通过 `ai-call-logger.ts` 的 `callAIWithLog()` 执行，自动写入 `PromptLog` 表（异步，不阻塞返回），记录完整的 system/user/response、token 消耗、模型、耗时、状态。

**模型配置与预算联动**：
- `AiProviderConfig` 表存储 `contextLength`（默认 64000）和 `maxTokens`（默认 4096）
- `GET /api/ai-providers/default` 返回当前默认模型配置
- 生成时（`/preview`、`/generate`、队列处理器）读取默认配置，通过 `scaleBudget(contextLength)` 动态调整 Pipeline 各层预算
- `maxTokens` 从模型配置读取，替代硬编码 4096
- **`.env` 优先同步**：`initAiProviderConfig` 每次启动都会从 `.env` 的 `DEEPSEEK_API_KEY` 同步到数据库，修改 Key 后重启即可生效

新增 Provider：在 `packages/ai-provider/src/index.ts` 的 `createProvider()` 中注册。

### 5.7 评分引擎

7 维度评分（AI 评分 + 规则兜底）：
1. `styleSimilarity` — 文风接近度（对比近 2-3 章 archived 内容）
2. `outlineAdherence` — 大纲符合度
3. `sceneMatch` — 场景符合度（地点/氛围/目标匹配）
4. `profileConsistency` — 写作人格一致性
5. `proseQuality` — 文笔质量
6. `emotionalTension` — 情感张力
7. `pacing` — 节奏把控

**实现**：`POST /api/drafts/:draftId/score` 路由中：
- 组装专业评分 Prompt（System Message 定义 7 维度和 JSON 输出格式）
- 传入前文参考（最近 2-3 章 archived 内容）、写作人格、大纲、场景设定
- 调用 AI（temperature=0.2）返回 JSON 评分结果
- 解析后保存到 `Score` 表，同时更新 `Draft.score`
- AI 失败时回退到 `RuleBasedScorer`（基于文本长度、句式、标点等简单规则）

前端展示：弹窗展示综合评分（大数字）+ 7 维度进度条 + AI 评语

---

## 6. 代码风格规范

- **TypeScript Strict 模式**：所有包均开启 `strict: true`
- **ES Modules**：所有子包设置 `"type": "module"`
- **模块解析**：
  - Server / Packages 使用 `"module": "NodeNext"`, `"moduleResolution": "NodeNext"`
  - Web 使用 `"module": "ESNext"`, `"moduleResolution": "bundler"`
- **文件扩展名**：NodeNext 环境下 import 需带 `.js` 扩展名（如 `import { x } from './foo.js'`），即使源文件是 `.ts`
- **输出目录**：每个包编译到 `./dist`，保留 `.d.ts` + `.js.map` + `.d.ts.map`
- **命名约定**：
  - 类名：PascalCase（如 `PromptPipeline`, `MemoryManager`）
  - 函数/变量：camelCase
  - 常量对象：UPPER_SNAKE_CASE（如 `ChapterStatus`, `MemoryLayer`）
  - 类型别名：PascalCase + `Type` 后缀（如 `ChapterStatusType`）
- **注释语言**：项目内所有注释和文档以 **中文** 为主
- **JSON 存储**：Prisma 中大量字段以 JSON 字符串形式存储（`personality`, `relationships`, `status`, `metadata` 等），读取时需 `JSON.parse()`，写入时需 `JSON.stringify()`

---

## 6.1 Prisma / 数据库设计规范

### 类型映射（SQLite → PostgreSQL 兼容）

| Prisma 类型 | SQLite | PostgreSQL | 注意事项 |
|-------------|--------|------------|----------|
| `String` | TEXT | TEXT | 无长度限制，存大文本直接用 |
| `Int` | INTEGER | INTEGER | 自增 ID 用 `@id @default(autoincrement())` |
| `Float` | REAL | DOUBLE PRECISION | 章节序号支持小数（番外插入） |
| `Boolean` | INTEGER(0/1) | BOOLEAN | Prisma 自动转换 |
| `DateTime` | DATETIME | TIMESTAMP | 带 `@default(now())` 和 `@updatedAt` |
| `Json` | 不支持 | JSONB | SQLite 开发时用 `String` + 手动 JSON.stringify/parse 替代 |

### 关系设计原则

1. **级联删除**：所有 `storyId` 外键统一配置 `onDelete: Cascade`，删除小说时自动清理关联数据
2. **联合唯一索引**：如 `@@unique([storyId, number])`（章节）、`@@unique([storyId, type, key])`（图谱节点）
3. **软关联可选**：`chapterId String?` + `chapter Chapter? @relation(...)`，允许全局记忆不关联具体章节
4. **JSON 字符串替代**：SQLite 不支持原生 JSON 类型，所有结构化数据（tags、stages、metadata 等）以 JSON 字符串存储，读取时 `JSON.parse()`，写入时 `JSON.stringify()`

### 迁移管理

- 开发环境：`pnpm db:migrate`（应用迁移）+ `npx prisma generate`（生成 Client）
- 新增模型后必须执行 `npx prisma generate`，否则 TypeScript 编译会报 `Property 'xxx' does not exist on type 'PrismaClient'`
- 迁移文件手动编写 SQL（SQLite 的 `prisma migrate dev` 交互式体验不佳，推荐 `migrate deploy`）
- 迁移文件命名：`YYYYMMDDhhmmss_描述`

---

## 7. 数据库模型速查

| 模型 | 说明 |
|------|------|
| `Story` | 小说工程 |
| `Chapter` | 章节（含状态机、场景状态、`isSideStory` 番外标记、`number` Float 支持插入序号如 3.5） |
| `Character` | 角色卡（含 `identity`/`appearance`/`temperament` 静态属性 + JSON `personality`/`relationships`/`status`） |
| `LoreItem` | 世界观条目（境界/地图/功法/势力/物品/规则） |
| `Memory` | 记忆（global/chapter/scene/temporary，通过 `chapterId` 关联来源章节） |
| `GraphNode` / `GraphEdge` | 知识图谱节点与边 |
| `TimelineEvent` | 时间线事件 |
| `Draft` | 候选（含 `temperature`/`maxTokens`/`compiledPrompt`/`score`/`errorMessage`/`status`） |
| `PromptConfig` | Prompt 模板配置（旧版兼容） |
| `Score` | 评分记录（7 维度：styleSimilarity/outlineAdherence/sceneMatch/profileConsistency/proseQuality/emotionalTension/pacing + comment） |
| `AiProviderConfig` | AI 模型配置（`contextLength` 驱动 Pipeline 预算动态缩放） |
| `RuntimeProfile` | Shared Runtime Base（Identity + Settings + Behavior + Jailbreak） |
| `WorkerTask` | 不同 Worker 的 Task Layer（generation / scoring / memory / graph / timeline / rewrite / memory_organize） |
| `PlotArc` | 剧情弧线 |
| `PromptLog` | 每次 AI API 调用的完整日志（prompt/response/token/模型/耗时） |

**Chapter 新增字段**：
- `parentChapterId` — 父章节（分支树）
- `branchName` — 分支名称（如"主线"、"黑化IF线"）
- `runtimeProfileId` — 章节级写作人格覆盖
- `compiledPrompt` — 生成时的完整 Prompt（JSON）
- `graphDelta` — 相对于上一章的图谱变化（JSON：addedNodes/updatedNodes/addedEdges/summary）
- `graphSnapshot` — 到当前章节的完整图谱快照（JSON：nodes/edges/timestamp）

**Prisma Client 输出位置**：`../node_modules/.prisma/client`（通过 `generator client` 的 `output` 指定）。

---

## 8. 测试

- 测试框架：**Vitest**（已在 root devDependencies 中声明）
- **当前状态**：项目内暂无 `.test.ts` 文件
- 运行命令：`pnpm test`（递归执行各包的 `vitest`）
- 建议新增测试时：
  - 引擎包（`packages/*`）优先为纯函数逻辑编写单元测试
  - Server 侧为路由处理器和队列处理器编写集成测试

---

## 9. 安全注意事项

1. **API Key 存储**：
   - AI Provider 的 API Key 存储在 `AiProviderConfig` 表中，也可通过 `.env` 初始化
   - `.env` 文件包含敏感信息，**切勿提交到 Git**

2. **Jailbreak Prompt**：
   - 系统支持配置越狱 Prompt（`RuntimeProfile.jailbreak`）
   - 仅在用户明确需要时启用

3. **违禁内容检测**：
   - `ScoringEngine` 包含 `forbiddenContentRisk` 维度
   - `RuleBasedScorer` 支持配置违禁词列表

4. **CORS**：
   - 后端当前配置 `origin: true`（允许所有来源），生产环境应根据实际域名收紧

5. **数据库**：
   - `dev.db` 是 SQLite 开发数据库，包含业务数据，**不应提交到 Git**

---

## 10. 部署说明

### 切换到 PostgreSQL
1. 安装 PostgreSQL
2. 修改 `.env`：`DATABASE_URL="postgresql://user:password@localhost:5432/novel_runtime"`
3. 修改 `prisma/schema.prisma` 的 `datasource db.provider` 为 `postgresql`
4. 执行 `pnpm db:migrate`

### 启用 Redis（生产队列）
1. 修改 `.env`：`REDIS_URL=redis://localhost:6379`
2. BullMQ 会自动连接 Redis；若未配置则自动回退到内存队列

### 构建生产包
```bash
pnpm build
```

Server 生产启动：
```bash
pnpm --filter server start   # 执行 node dist/server.js
```

---

## 11. 扩展开发指南

### 添加新的 AI Provider
在 `packages/ai-provider/src/index.ts` 中：
1. 实现 `AIProvider` 接口
2. 在 `createProvider()` 中注册

### 添加新的评分维度
在 `packages/scoring-engine/src/index.ts` 中：
1. 扩展 `ScoreResult` 接口
2. 在 `ScoringEngine.run()` 中添加新维度计算

**注意**：AI 评分的核心逻辑在 `apps/server/src/routes/scores.ts` 中。如需调整评分 Prompt（维度定义、权重、输出格式），直接修改该文件的 `scoringSystemMessage` 和 `scoringUserMessage`。

### 添加新的 Worker Task 类型
在 `packages/ai-provider/src/runtime-compiler.ts` 中：
1. 扩展 `WorkerTask.workerType` 联合类型
2. 在 backend 的 `runtime-loader.ts` 和队列系统中注册处理逻辑

### 添加新的预设写作人格
在 `docs/profiles/` 下新建 JSON 文件：
1. 参考现有 JSON 结构：`name`, `identity`, `settings`, `behavior`, `jailbreak`, `isDefault`
2. 后端启动时自动扫描该目录并导入数据库（按 `name` 去重）
3. 无需修改代码或重启服务逻辑

### 添加新的 API 路由
在 `apps/server/src/routes/` 下新建路由文件：
1. 导出 `async function xxxRoutes(app: FastifyInstance)`
2. 在 `app.ts` 中 `await app.register(xxxRoutes)`
3. 如需 Prisma，通过 `app.prisma` 访问（已装饰）

---

## 11. API 路由速查

### 核心创作流程

| 方法 | 路由 | 说明 |
|------|------|------|
| `POST` | `/api/stories/:storyId/chapters` | 新建根章节 |
| `POST` | `/api/chapters/:chapterId/develop` | 在章节上发展下一章/番外 |
| `GET` | `/api/stories/:storyId/chapter-tree` | 获取章节分支树（嵌套结构） |
| `PUT` | `/api/chapters/:chapterId` | 更新章节（标题/大纲/正文/场景） |
| `DELETE` | `/api/chapters/:chapterId` | 删除章节 |
| `POST` | `/api/chapters/:chapterId/preview` | 预览 Prompt（组装 + 预算，不调用 AI） |
| `POST` | `/api/chapters/:chapterId/generate` | 异步生成候选（创建 generating Draft → 入队 → 立即返回） |
| `POST` | `/api/chapters/:chapterId/select` | 采用 Draft（选中 Draft → selected，其余 → rejected） |
| `POST` | `/api/chapters/:chapterId/archive` | 归档（状态更新 + combined_extract + memory_organize + graph_snapshot） |

### Draft

| 方法 | 路由 | 说明 |
|------|------|------|
| `GET` | `/api/chapters/:chapterId/drafts` | 列表（按 createdAt 倒序） |
| `GET` | `/api/drafts/:draftId` | 详情 |
| `DELETE` | `/api/drafts/:draftId` | 删除 |
| `POST` | `/api/drafts/:draftId/score` | AI 评分（7 维度） |

### 图谱

| 方法 | 路由 | 说明 |
|------|------|------|
| `GET` | `/api/stories/:storyId/graph` | 当前实时图谱 |
| `POST` | `/api/stories/:storyId/graph/nodes` | 新增节点 |
| `POST` | `/api/stories/:storyId/graph/edges` | 新增边 |
| `GET` | `/api/chapters/:chapterId/graph-snapshot` | 获取章节的 graphSnapshot + graphDelta |

### 配置

| 方法 | 路由 | 说明 |
|------|------|------|
| `GET` | `/api/ai-providers/default` | 默认模型配置（含 contextLength / maxTokens） |

---

## 12. 扩展开发指南
在 `apps/server/src/services/graph-snapshot.ts` 中：
1. `buildGraphSnapshot()` — 修改节点/边查询条件或快照结构
2. `computeGraphDelta()` — 修改对比算法（目前对比 type:key 唯一标识 + data 属性）
3. `saveGraphSnapshotAndDelta()` — 修改上一章查找策略（目前优先父章节，否则最近归档）

---

## 13. 设计哲学（必读）

> 真正重要的是：状态管理、记忆管理、世界观一致性、长篇稳定性、章节工业化。
>
> AI 只是**文本生成器**，Runtime 才是真正核心。

- **结构化世界 + AI 生成**，而不是：巨大 Prompt + 无限 Agent
- **Prompt 只是渲染层，状态管理才是真正核心**
- **Stateless Generation**：每次生成使用新的上下文，Runtime 动态组装状态，不长期续聊天记录
- **废案不是垃圾，废案是创意资产库**
