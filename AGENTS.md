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
│   │       │   └── worker-task.ts
│   │       ├── services/    # 业务处理器
│   │       │   ├── ai-provider-init.ts      # 从 DB 初始化默认 AI Provider
│   │       │   ├── generate-processor.ts    # 章节生成队列处理器（核心）
│   │       │   ├── memory-extractor.ts      # 记忆提取
│   │       │   ├── graph-extractor.ts       # 图谱提取
│   │       │   ├── plot-extractor.ts        # 剧情弧线提取
│   │       │   ├── memory-compressor.ts     # 记忆压缩
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
│           │   └── StoryWorkerTask.vue
│           └── utils/
│               └── api.ts     # Axios 实例配置
├── packages/                  # 共享包（Monorepo）
│   ├── shared/                # 类型、常量、工具函数
│   ├── ai-provider/           # AI Provider 统一封装（OpenAI / DeepSeek / 可扩展）
│   ├── prompt-runtime/        # Prompt Pipeline / Assembler + Token 预算控制
│   ├── memory-engine/         # 分层记忆管理 + 语义检索
│   ├── knowledge-graph/       # graphology 图引擎封装
│   ├── scoring-engine/        # 7 维度评分引擎
│   ├── warning-engine/        # 预警检测引擎（当前为空）
│   └── story-engine/          # 预留包（当前为空）
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
Draft → Generated → Scored → Selected → Archived
  ↓         ↓          ↓
Rejected  Rejected   Rejected
```

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

默认总预算 `64000` tokens，各层预算在 `generate-processor.ts` 中配置：

| 层 | 预算 |
|--|--|
| style | 2000 |
| story | 12000 |
| lore | 10000 |
| character | 12000 |
| scene | 12000 |
| memory | 8000 |
| timeline | 4000 |
| plotArc | 3000 |
| output | 16000 |

`PromptAssembler` 负责动态裁剪：超出预算时按字符数截断，并标记 `truncated`。

### 5.4 记忆系统（四层）

```
Global Memory    → 世界观、角色关系、长期目标
Chapter Memory   → 本章事件、情绪变化、伏笔
Scene Memory     → 当前地点、角色、情绪
Temporary Memory → 临时上下文
```

`MemoryManager.searchRelevant()` 使用 tiktoken token 频率向量的 **余弦相似度** 进行语义检索，综合得分 = 语义相似度×0.6 + 重要性×0.3 + 时间新鲜度×0.1。

### 5.5 队列系统

使用 **BullMQ** + **IORedis**。如果 Redis 不可用（如开发环境），自动降级为 **内存队列（MemoryQueue）**。

队列类型：
- `generate` — 章节生成
- `score` — 评分任务
- `memory` — 记忆更新

处理器在 `app.ts` 中注册，Worker 在 `server.ts` 启动时拉起。

### 5.6 AI Provider 统一接口

```ts
interface AIProvider {
  generate(prompt: string, options?: any): Promise<string>
  generateWithRuntime?(compiled: CompiledPrompt, options?: any): Promise<string>
  streamGenerate(prompt: string, options?: any): AsyncIterable<string>
  embedding?(text: string): Promise<number[]>
}
```

已实现的 Provider：
- `OpenAIProvider` — 占位实现（返回 mock 文本）
- `DeepSeekProvider` — 完整实现（调用 DeepSeek API `/v1/chat/completions`，30s timeout）

新增 Provider：在 `packages/ai-provider/src/index.ts` 的 `createProvider()` 中注册。

### 5.7 评分引擎

7 维度评分：
1. `styleSimilarity` — 文风一致性
2. `loreConsistency` — 世界观一致性
3. `characterConsistency` — 人设稳定性
4. `emotionalTension` — 情绪张力
5. `pacing` — 节奏
6. `proseQuality` — 文笔
7. `forbiddenContentRisk` — 违禁风险

当前实现：
- `RuleBasedScorer` — 规则评分（违禁词检测 + 默认 80 分）
- `AIScorer` — AI 评分（当前为随机数占位，TODO: 接入真实 AI）

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

## 7. 数据库模型速查

| 模型 | 说明 |
|------|------|
| `Story` | 小说工程 |
| `Chapter` | 章节（含状态机、场景状态） |
| `Character` | 角色卡（JSON 存储性格/关系/状态） |
| `LoreItem` | 世界观条目（境界/地图/功法/势力/物品/规则） |
| `Memory` | 记忆（global/chapter/scene/temporary） |
| `GraphNode` / `GraphEdge` | 知识图谱节点与边 |
| `TimelineEvent` | 时间线事件 |
| `Draft` | 候选/废案 |
| `PromptConfig` | Prompt 模板配置（旧版兼容） |
| `Score` | 评分记录（7 维度） |
| `Warning` | 预警记录 |
| `AiProviderConfig` | AI 模型配置 |
| `RuntimeProfile` | Shared Runtime Base（Identity + Settings + Behavior + Jailbreak） |
| `WorkerTask` | 不同 Worker 的 Task Layer（generation / scoring / memory / graph / timeline / rewrite） |
| `PlotArc` | 剧情弧线 |

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

### 添加新的 Worker Task 类型
在 `packages/ai-provider/src/runtime-compiler.ts` 中：
1. 扩展 `WorkerTask.workerType` 联合类型
2. 在 backend 的 `runtime-loader.ts` 和队列系统中注册处理逻辑

### 添加新的 API 路由
在 `apps/server/src/routes/` 下新建路由文件：
1. 导出 `async function xxxRoutes(app: FastifyInstance)`
2. 在 `app.ts` 中 `await app.register(xxxRoutes)`
3. 如需 Prisma，通过 `app.prisma` 访问（已装饰）

---

## 12. 设计哲学（必读）

> 真正重要的是：状态管理、记忆管理、世界观一致性、长篇稳定性、章节工业化。
>
> AI 只是**文本生成器**，Runtime 才是真正核心。

- **结构化世界 + AI 生成**，而不是：巨大 Prompt + 无限 Agent
- **Prompt 只是渲染层，状态管理才是真正核心**
- **Stateless Generation**：每次生成使用新的上下文，Runtime 动态组装状态，不长期续聊天记录
- **废案不是垃圾，废案是创意资产库**
