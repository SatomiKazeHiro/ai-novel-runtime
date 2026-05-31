# AI Novel Runtime

> **AI 小说工程化 Runtime 系统**
>
> 目标不是让 AI 自动写小说，而是让用户可以**稳定、高质量、可控地**开发长篇小说。
>
> **人类主导方向 · AI 负责生成 · Runtime 负责稳定**

---

## 核心特性

- **长篇小说工程化开发** — 多小说工程管理，工业化章节流水线
- **版本分支系统** — 同一部小说支持多条平行剧情线，每条线拥有独立的时间线、角色状态、记忆和知识图谱
- **结构化世界观管理** — LoreBook 系统化维护境界、地图、功法、势力、物品、规则
- **角色卡系统** — 静态属性（性格、外貌、说话风格）+ 按版本分支隔离的动态状态（境界、位置、人际关系）
- **章节状态机** — Draft → Generated → Selected → Archived，废案自动归档为创意资产
- **多候选生成** — 一次生成多个候选版本，支持不同 temperature 采样策略
- **AI 评分** — 7 维度评分（文风接近度、大纲符合度、场景符合度、写作人格一致性、文笔质量、情感张力、节奏把控）
- **Prompt Pipeline** — Pipeline 式 Prompt 组装，Token 预算控制，动态裁剪，Stateless Generation
- **多模型兼容** — OpenAI / DeepSeek / Claude / Gemini 等统一接口
- **知识图谱** — 人物关系图、势力图、事件图、物品图的可视化与管理（按版本分支隔离）
- **分层记忆** — Global / Chapter / Scene / Temporary 四层记忆系统，语义检索 + 近似去重 + AI 记忆整理
- **剧情弧线追踪** — 追踪主线/支线剧情进展，标注未解悬念
- **任务队列** — 生成/评分异步化（BullMQ + Redis，开发环境自动回退内存队列）

---

## 技术架构

### 前端

| 技术 | 说明 |
|------|------|
| Vue 3 | Composition API + `<script setup>` |
| TypeScript | Strict 模式 |
| Vite | 构建工具，开发端口 5173，代理 `/api` 到后端 3000 |
| Pinia | 状态管理 |
| Vue Router | 路由，双 Layout：SimpleLayout / NovelDesignLayout |
| Naive UI | 组件库 |
| Axios | HTTP 请求 |
| Cytoscape | 知识图谱可视化 |
| @vueuse/core | 组合式工具库 |

### 后端

| 技术 | 说明 |
|------|------|
| Node.js | v20+ |
| TypeScript | Strict 模式，`module: NodeNext` |
| Fastify | Web 框架 + 插件化路由 + Swagger/OpenAPI |
| Prisma | ORM + 类型安全 |
| BullMQ | 任务队列（Redis 可用时使用） |
| IORedis | Redis 客户端 |
| graphology | 图引擎 |
| js-tiktoken | Token 计算 |
| zod | 运行时校验 |

### 数据库

| 环境 | 数据库 |
|------|--------|
| 开发 | SQLite（零配置启动） |
| 生产 | PostgreSQL（切换仅需改 `.env` + `prisma/schema.prisma`） |

---

## 项目结构

```
novel-runtime/
├── apps/
│   ├── server/              # Fastify 后端
│   │   └── src/
│   │       ├── server.ts    # 入口：加载环境变量、启动 Worker、监听端口
│   │       ├── app.ts       # Fastify 应用构建（注册插件、路由、队列处理器）
│   │       ├── plugins/
│   │       │   └── prisma.ts
│   │       ├── routes/      # API 路由（按领域划分）
│   │       │   ├── health.ts
│   │       │   ├── stories.ts
│   │       │   ├── characters.ts
│   │       │   ├── lore.ts
│   │       │   ├── timeline.ts
│   │       │   ├── chapters.ts        # 含版本分支相关 API
│   │       │   ├── drafts.ts
│   │       │   ├── graph.ts
│   │       │   ├── memories.ts
│   │       │   ├── scores.ts
│   │       │   ├── runtime-profile.ts
│   │       │   ├── worker-task.ts
│   │       │   ├── ai-provider.ts
│   │       │   └── prompt-logs.ts
│   │       ├── services/    # 业务处理器
│   │       │   ├── ai-provider-init.ts
│   │       │   ├── runtime-profile-init.ts
│   │       │   ├── runtime-loader.ts
│   │       │   ├── generate-processor.ts
│   │       │   ├── ai-call-logger.ts
│   │       │   ├── combined-extractor.ts    # 归档时合并提取记忆+图谱+弧线
│   │       │   ├── memory-extractor.ts
│   │       │   ├── graph-extractor.ts
│   │       │   ├── plot-extractor.ts
│   │       │   ├── graph-snapshot.ts
│   │       │   ├── memory-compressor.ts
│   │       │   └── memory-organizer.ts
│   │       └── queue/
│   │           └── index.ts
│   └── web/                 # Vue 3 前端
│       └── src/
│           ├── main.ts
│           ├── App.vue
│           ├── router/        # Vue Router（双 Layout）
│           ├── stores/        # Pinia Stores
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
│           │   ├── PromptLogs.vue
│           │   ├── SimpleLayout.vue
│           │   └── NovelDesignLayout.vue
│           ├── components/    # 共享组件
│           ├── composables/   # 组合式函数
│           └── utils/
│               └── api.ts
├── packages/                  # 共享包（Monorepo）
│   ├── shared/                # 类型、常量、工具函数
│   ├── ai-provider/           # AI Provider 统一封装
│   ├── prompt-runtime/        # Prompt Pipeline / Token 预算控制
│   ├── memory-engine/         # 分层记忆管理 + 语义检索
│   ├── knowledge-graph/       # graphology 图引擎封装
│   ├── scoring-engine/        # 评分引擎接口
│   └── warning-engine/        # 预警检测引擎
├── docs/
│   ├── profiles/              # 预设写作人格（11 种类型）
│   ├── implementation-plan.md
│   ├── sql-reference.md
│   └── nodejs_vue_3_ai_novel_runtime_architecture_spec_v_2.md
├── prisma/
│   ├── schema.prisma          # 数据库模型定义
│   ├── migrations/            # SQL 迁移文件
│   └── dev.db                 # SQLite 开发数据库
├── .env                       # 环境变量
├── package.json               # Root workspace 配置
├── pnpm-workspace.yaml        # pnpm 工作区声明
└── README.md                  # 本文档
```

---

## 数据库模型

| 模型 | 说明 |
|------|------|
| `Story` | 小说工程 |
| `VersionBranch` | 版本分支（剧情分叉隔离） |
| `Chapter` | 章节（含状态机、场景状态、`isSideStory` 番外标记） |
| `Character` | 角色卡（静态属性：性格、外貌、说话风格） |
| `CharacterBranchState` | 角色按版本分支隔离的动态状态（境界、位置、人际关系） |
| `LoreItem` | 世界观条目（境界/地图/功法/势力/物品/规则） |
| `Memory` | 记忆（global/chapter/scene/temporary，按版本分支隔离） |
| `GraphNode` / `GraphEdge` | 知识图谱节点与边（按版本分支隔离） |
| `TimelineEvent` | 时间线事件（按版本分支隔离） |
| `PlotArc` | 剧情弧线（按版本分支隔离） |
| `Draft` | 候选（含 temperature/maxTokens/compiledPrompt/score） |
| `Score` | 评分记录（7 维度） |
| `AiProviderConfig` | AI 模型配置（contextLength / maxTokens） |
| `RuntimeProfile` | 写作人格（Identity + Settings + Behavior + Jailbreak） |
| `WorkerTask` | Worker 任务层配置 |
| `PromptLog` | 每次 AI API 调用的完整日志 |

---

## 快速开始

### 环境要求

- Node.js >= 20
- pnpm >= 10.33.4
- （可选）Redis — 用于生产级队列

### 安装依赖

```bash
cd novel-runtime
pnpm install
```

### 初始化数据库

```bash
# 已内置 SQLite，无需额外安装数据库
pnpm db:migrate
```

### 启动开发环境

```bash
# 一键同时启动前后端
pnpm dev
```

或分别启动：

```bash
# 后端（http://localhost:3000）
pnpm --filter server dev

# 前端（http://localhost:5173）
pnpm --filter web dev
```

### 常用命令

```bash
pnpm db:studio        # Prisma Studio 可视化数据
pnpm db:migrate       # 数据库迁移
pnpm db:generate      # 重新生成 Prisma Client
pnpm build            # 构建所有包
pnpm typecheck        # 类型检查
```

---

## API 文档

启动后端后访问 Swagger UI：

```
http://localhost:3000/documentation
```

### 核心创作 API

| 接口 | 方法 | 说明 |
|------|------|------|
| `/api/stories` | GET/POST | 小说列表/创建 |
| `/api/stories/:id` | GET/PUT/DELETE | 小说详情/更新/删除 |
| `/api/stories/:id/chapters` | GET/POST | 章节列表/创建 |
| `/api/chapters/:id` | GET/PUT/DELETE | 章节详情/更新/删除 |
| `/api/chapters/:id/develop` | POST | 发展下一章/番外（支持创建新版本分支） |
| `/api/chapters/:id/preview` | POST | 预览 Prompt |
| `/api/chapters/:id/generate` | POST | 提交生成任务 |
| `/api/chapters/:id/select` | POST | 采用候选 |
| `/api/chapters/:id/archive` | POST | 归档章节（触发记忆/图谱/弧线提取） |

### 版本分支 API

| 接口 | 方法 | 说明 |
|------|------|------|
| `/api/stories/:id/version-branches` | GET | 版本分支列表 |
| `/api/stories/:id/version-branches/:branchId/chain` | GET | 版本链（含祖先分支章节） |
| `/api/version-branches/:branchId` | PUT | 修改版本分支名称 |

### 其他领域 API

| 接口 | 方法 | 说明 |
|------|------|------|
| `/api/stories/:id/characters` | GET/POST | 角色管理 |
| `/api/stories/:id/lore` | GET/POST | 世界观条目 |
| `/api/stories/:id/timeline` | GET/POST | 时间线事件（按版本分支隔离） |
| `/api/stories/:id/graph` | GET | 知识图谱（按版本分支隔离） |
| `/api/stories/:id/memory` | GET/POST | 记忆管理（按版本分支隔离） |
| `/api/drafts/:id/score` | POST | AI 评分（7 维度） |
| `/api/ai-providers/default` | GET | 默认模型配置 |

---

## 核心系统设计

### 版本分支系统

同一部小说可以有多个平行剧情线，每个版本分支拥有独立的时间线、角色状态、记忆和图谱。

```
主线·第1章
  ├── 第2章
  └── [分叉] 黑化IF线
        ├── 第3章（黑化）
        └── 第4章（黑化）
```

- 新建根章节时自动创建根版本分支
- `develop` 章节默认沿用父章节的版本分支
- 用户可在 develop 时指定新版本名称，实现剧情分叉

### Prompt Pipeline

Runtime 采用 **Stateless Generation**：每次生成都是全新上下文，不续聊天记录。

Prompt 分层组装（从下到上）：

```
System Message  ← [Identity] + [Settings] + [Behavior] + [Jailbreak] + [Task]
  ↓
User Message  ← Style → Story → Lore → Character → Scene → Memory → Timeline → PlotArc → Output
```

### Context Budget

基于模型 `contextLength` 动态缩放各层预算（默认基准 64000 tokens）：

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

### 记忆系统

```
Global Memory    → 世界观、角色关系、长期目标（跨章节，不衰减）
Chapter Memory   → 本章事件、情绪变化、伏笔（按章节距离衰减）
Scene Memory     → 推动剧情的关键地点（importance ≥ 7）
Temporary Memory → 临时上下文
```

- **Checkpoint 机制**：生成第 N 章时，只读取最后一个已归档章节之前的记忆
- **语义检索**：基于 token 频率向量的余弦相似度，综合得分 = `sim * 0.7 + importance * 0.3`
- **近似去重**：Jaccard > 0.82 的记忆自动去重
- **AI 记忆整理**：归档后自动触发，对新旧记忆做语义 merge/update/delete

### 章节状态机

```
Draft → Generated → Selected → Archived
  ↓         ↓          ↓              ↑
Rejected  (无)      (无)      合并提取（记忆+图谱+弧线）+ AI记忆整理 + graphSnapshot
```

---

## 部署

### 切换到 PostgreSQL

1. 安装 PostgreSQL
2. 修改 `.env`：
   ```env
   DATABASE_URL="postgresql://user:password@localhost:5432/novel_runtime"
   ```
3. 修改 `prisma/schema.prisma`：
   ```prisma
   datasource db {
     provider = "postgresql"
     url      = env("DATABASE_URL")
   }
   ```
4. 执行 `pnpm db:migrate`

### 启用 Redis（生产队列）

```env
REDIS_URL=redis://localhost:6379
```

BullMQ 会自动连接 Redis；若未配置则自动回退到内存队列。

### 构建生产包

```bash
pnpm build
```

---

## 扩展开发

### 添加新的 AI Provider

在 `packages/ai-provider/src/index.ts` 中实现 `AIProvider` 接口，然后在 `createProvider` 函数中注册。

### 添加新的评分维度

在 `packages/scoring-engine/src/index.ts` 中扩展 `ScoreResult` 接口。评分 Prompt 的修改在后端 `apps/server/src/routes/scores.ts`。

### 添加新的预设写作人格

在 `docs/profiles/` 下新建 JSON 文件，后端启动时自动扫描并导入数据库。

---

## 设计理念

```
结构化世界 + AI 生成

而不是：

巨大 Prompt + 无限 Agent
```

真正重要的是：

- 状态管理
- 记忆管理
- 世界观一致性
- 长篇稳定性
- 章节工业化

AI 只是**文本生成器**，Runtime 才是真正核心。

---

## License

MIT
