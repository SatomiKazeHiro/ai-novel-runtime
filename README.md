# AI Novel Runtime

> **AI 小说工程化 Runtime 系统**
>
> 目标不是让 AI 自动写小说，而是让用户可以稳定、高质量、可控地开发长篇小说。
>
> **人类主导方向 · AI 负责生成 · Runtime 负责稳定**

---

## 核心特性

- **长篇小说工程化开发** — 多小说工程管理，工业化章节流水线
- **结构化世界观管理** — LoreBook 系统化维护境界、地图、功法、势力、物品、规则
- **角色卡系统** — 性格、说话风格、人际关系、动态状态追踪
- **章节状态机** — Draft → Generated → Scored → Selected → Archived
- **多候选生成** — 一次生成多个候选版本，支持不同 temperature 采样策略
- **AI 目标评分** — 7 维度评分（文风、世界观一致性、人设稳定性、情绪张力、节奏、文笔、违禁风险）
- **预警系统** — 自动检测人设崩坏、战力崩坏、时间线冲突、世界观冲突
- **Prompt Middleware** — Pipeline 式 Prompt 组装，Token 预算控制，动态裁剪
- **多模型兼容** — OpenAI / DeepSeek / Claude / Gemini 等统一接口
- **知识图谱** — 人物关系图、势力图、事件图、境界图的可视化与管理
- **分层记忆** — Global / Chapter / Scene / Temporary 四层记忆系统
- **任务队列** — 生成/评分/记忆更新异步化（BullMQ + Redis，开发环境自动回退内存队列）

---

## 技术架构

### 前端

| 技术 | 说明 |
|------|------|
| Vue 3 | Composition API |
| TypeScript | Strict 模式 |
| Vite | 构建工具 |
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
│   │       ├── server.ts    # 入口
│   │       ├── app.ts       # Fastify 应用构建
│   │       ├── plugins/
│   │       │   └── prisma.ts
│   │       ├── routes/      # API 路由
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
│   │       │   └── warnings.ts
│   │       └── queue/       # 队列系统
│   │           └── index.ts
│   └── web/                 # Vue3 前端
│       └── src/
│           ├── main.ts
│           ├── App.vue
│           ├── router/
│           ├── stores/
│           ├── api/           # API 封装层
│           ├── views/         # 页面
│           │   ├── Dashboard.vue
│           │   ├── Stories.vue
│           │   ├── Characters.vue
│           │   ├── LoreBook.vue
│           │   ├── Chapters.vue
│           │   ├── Timeline.vue
│           │   ├── Graph.vue
│           │   ├── Memory.vue
│           │   └── Warnings.vue
│           └── utils/
│               └── api.ts
├── packages/                  # 共享包（Monorepo）
│   ├── shared/                # 类型、常量、工具函数
│   ├── ai-provider/           # AI Provider 统一封装
│   ├── prompt-runtime/        # Prompt Pipeline / Assembler
│   ├── memory-engine/         # 分层记忆管理
│   ├── knowledge-graph/       # graphology 图引擎封装
│   ├── scoring-engine/        # 评分引擎
│   └── warning-engine/        # 预警检测引擎
├── prisma/
│   ├── schema.prisma          # 数据库模型定义
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
| `Chapter` | 章节（含状态机、场景状态） |
| `Character` | 角色卡（JSON 存储性格/关系/状态） |
| `LoreItem` | 世界观条目（境界/地图/功法/势力/物品/规则） |
| `Memory` | 记忆（global/chapter/scene/temporary） |
| `GraphNode` / `GraphEdge` | 知识图谱节点与边 |
| `TimelineEvent` | 时间线事件 |
| `Draft` | 候选/废案 |
| `PromptConfig` | Prompt 模板配置 |
| `Score` | 评分记录（7 维度） |
| `Warning` | 预警记录 |
| `AiProviderConfig` | AI 模型配置 |

---

## 快速开始

### 环境要求

- Node.js >= 20
- pnpm >= 10
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

核心 API 一览：

| 接口 | 方法 | 说明 |
|------|------|------|
| `/api/health` | GET | 健康检查 |
| `/api/stories` | GET/POST | 小说列表/创建 |
| `/api/stories/:id` | GET/PUT/DELETE | 小说详情/更新/删除 |
| `/api/stories/:id/characters` | GET/POST | 角色列表/创建 |
| `/api/stories/:id/lore` | GET/POST | 世界观条目 |
| `/api/stories/:id/timeline` | GET/POST | 时间线事件 |
| `/api/stories/:id/chapters` | GET/POST | 章节列表/创建 |
| `/api/chapters/:id` | GET/PUT/DELETE | 章节详情/更新/删除 |
| `/api/chapters/:id/generate` | POST | 提交生成任务 |
| `/api/chapters/:id/select` | POST | 采用候选 |
| `/api/chapters/:id/archive` | POST | 归档章节 |
| `/api/stories/:id/graph` | GET | 获取知识图谱 |
| `/api/stories/:id/memory` | GET/POST | 记忆管理 |
| `/api/stories/:id/warnings` | GET | 预警列表 |
| `/api/drafts/:id/score` | POST | 评分任务 |

---

## 核心系统设计

### Prompt Pipeline

```
Input
  ↓
System Prompt
  ↓
Jailbreak Prompt
  ↓
Story Context
  ↓
Character Context
  ↓
Lore Context
  ↓
Scene Context
  ↓
Memory Context
  ↓
Style Context
  ↓
Generation Instruction
  ↓
Model Adapter
  ↓
LLM
```

### Context Budget

```yaml
context_budget:
  total: 64000
  story_memory: 12000
  chapter_memory: 8000
  lore: 10000
  scene: 12000
  prompt: 6000
  output: 16000
```

### Memory Layers

```
Global Memory    → 世界观、角色关系、长期目标
Chapter Memory   → 本章事件、情绪变化、伏笔
Scene Memory     → 当前地点、角色、情绪
Temporary Memory → 临时上下文
```

### Chapter State Machine

```
Draft → Generated → Scored → Selected → Archived
  ↓         ↓          ↓
Rejected   Rejected   Rejected
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

在 `packages/ai-provider/src/index.ts` 中实现 `AIProvider` 接口：

```ts
export class MyProvider implements AIProvider {
  async generate(prompt: string, options?: any): Promise<string> { ... }
  async *streamGenerate(prompt: string, options?: any): AsyncIterable<string> { ... }
}
```

然后在 `createProvider` 函数中注册即可。

### 添加新的评分维度

在 `packages/scoring-engine/src/index.ts` 的 `ScoreResult` 和 `ScoringEngine.run` 中添加新维度。

### 添加新的预警类型

在 `packages/warning-engine/src/index.ts` 的 `WarningEngine` 中添加新的检测方法。

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
