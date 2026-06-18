<!-- From: D:\MGit-Projects\ai-novel-runtime\AGENTS.md -->
# AI Novel Runtime — Agent Guide

> 本文档面向 AI Coding Agent。如果你对该项目一无所知，请从本文件开始阅读。

> AI 智能体约定规范：本项目下的 `Agreement.md` 文件。

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

### 1.1 核心业务流程

系统围绕**小说章节的生命周期**运转：

1. **创建章节** → 设定大纲、场景、写作人格
2. **预览 Prompt** → 查看将要发给 AI 的完整上下文
3. **生成候选** → 异步队列调用 AI，产生多个 Draft 候选
4. **评分与选择** → AI 7 维度评分 + 人工选择最佳 Draft
5. **归档** → 触发 AI 提取记忆、整理图谱、压缩历史、追踪剧情弧线
6. **发展下一章** → 基于归档章节生成子章节，主线直线推进，支持从任意节点创建番外支线

### 1.2 章节树与番外支线

- 每个章节有 `parentChapterId`，数据结构保留分支能力
- **主线**：只能从当前最新章节继续发展，序号严格递增（`1 → 2 → 3`），形成线性主线
- **番外**：`isSideStory = true`，可从任意章节创建，序号为小数（如 `1.01`、`1.02`），形成支线效果
- 根章节 `parentChapterId = null`
- 删除 `archived` 章节会级联删除同 `fromChapterNumber` 的记忆、时间线、角色状态，并从上一章 snapshot 重建图谱

---

## 2. 技术栈

### 2.1 前端

| 技术 | 说明 |
|------|------|
| Vue 3 | Composition API + `<script setup>` |
| TypeScript | Strict 模式，`noUnusedLocals` / `noUnusedParameters` 启用 |
| Vite | 构建工具，开发端口 5173，代理 `/api` 到后端 3000 |
| Pinia | 状态管理（`story.ts`、`theme.ts`），持久化到 `localStorage` |
| Vue Router | 路由，history 模式，双 Layout：SimpleLayout / NovelDesignLayout |
| Naive UI | 组件库，中文 locale，主题色 `#6366f1`，支持暗黑模式 |
| Axios | HTTP 请求，baseURL 来自 `VITE_API_BASE_URL`，30 秒超时 |
| Cytoscape | 知识图谱可视化 |
| @vueuse/core | 组合式工具库（`useIntervalFn` 用于轮询生成状态） |
| es-toolkit | 现代化工具库（lodash 替代） |

### 2.2 后端

| 技术 | 说明 |
|------|------|
| Node.js | v20+ |
| TypeScript | Strict 模式，`module: NodeNext`，**相对 import 必须带 `.js` 扩展名** |
| Fastify | Web 框架 + 插件化路由 + Swagger/OpenAPI (`/documentation`) |
| Prisma | ORM + 类型安全，Client 输出到根目录 `node_modules/.prisma/client` |
| BullMQ | 任务队列（Redis 可用时使用） |
| IORedis | Redis 客户端 |
| graphology | 图引擎（内存中操作，由 `GraphService` 封装） |
| js-tiktoken | Token 计算（cl100k_base） |
| zod | 运行时校验（已安装但当前路由中**未使用**） |

### 2.3 数据库

| 环境 | 数据库 |
|------|--------|
| 开发 | SQLite（零配置启动，`file:./dev.db`） |
| 生产 | PostgreSQL（切换仅需改 `.env` + `prisma/schema.prisma` 的 `provider`） |

主要模型：`Story`、`Chapter`、`Draft`、`Character`、`CharacterBranchState`、`LoreItem`、`Memory`、`GraphNode`、`GraphEdge`、`TimelineEvent`、`PlotArc`、`RuntimeProfile`、`WorkerTask`、`AiProviderConfig`、`PromptLog`、`Score`。

### 2.4 共享包

| 包名 | 路径 | 用途 |
|------|------|------|
| `@novel-runtime/shared` | `packages/shared` | 共享常量、类型、纯工具函数 |
| `@novel-runtime/ai-provider` | `packages/ai-provider` | LLM Provider 抽象 + Prompt 编译器 |
| `@novel-runtime/prompt-runtime` | `packages/prompt-runtime` | Prompt 组装管道 + Token 预算管理 |
| `@novel-runtime/memory-engine` | `packages/memory-engine` | 记忆提取、语义搜索、Prompt 格式化 |
| `@novel-runtime/knowledge-graph` | `packages/knowledge-graph` | 内存图服务（graphology 封装） |
| `@novel-runtime/scoring-engine` | `packages/scoring-engine` | 规则评分引擎（AI 评分在服务端实现） |

所有包的 `tsconfig.json` 统一：`target: ES2022`、`module: NodeNext`、`strict: true`、生成 `.d.ts` + sourceMap。

### 2.5 包管理

- **pnpm** `>= 10.33.4`（通过根目录 `package.json` 的 `packageManager` 字段锁定）
- Workspace 范围：`apps/*` + `packages/*`
- 所有子包使用 `workspace:*` 引用内部依赖

---

## 3. 常用命令

所有命令均在项目根目录执行：

```bash
# 安装依赖
pnpm install

# 初始化数据库（应用迁移 + 生成 Prisma Client）
pnpm db:migrate

# 一键同时启动前后端（开发模式）
pnpm dev
# 后端 http://localhost:3000
# 前端 http://localhost:5173（已配置 proxy 到后端 /api）

# 分别启动
pnpm --filter server dev    # tsx watch src/server.ts
pnpm --filter web dev       # vite

# 构建所有包
pnpm build                  # 各包执行 tsc 或 vite build

# 类型检查所有包
pnpm typecheck

# 运行测试（当前无测试文件，但 Vitest 已安装）
pnpm test

# 数据库管理
pnpm db:studio        # Prisma Studio 可视化数据
pnpm db:migrate       # 数据库迁移
pnpm db:generate      # 重新生成 Prisma Client（必须执行，否则 TS 编译报错）
pnpm db:seed          # 运行种子脚本（tsx prisma/seed.ts）
```

---

## 4. 代码组织与架构

### 4.1 Monorepo 目录结构

```
├── apps/
│   ├── server/          # Fastify 后端
│   │   ├── src/
│   │   │   ├── server.ts        # 入口：加载 env、启动 Worker、监听端口
│   │   │   ├── app.ts           # Fastify 应用组装（插件 → 初始化 → 路由）
│   │   │   ├── plugins/
│   │   │   │   └── prisma.ts    # PrismaClient 封装为 Fastify 插件
│   │   │   ├── queue/
│   │   │   │   └── index.ts     # BullMQ + 内存回退队列
│   │   │   ├── routes/          # 14 个路由模块（见下表）
│   │   │   └── services/        # 14 个服务/业务逻辑模块
│   │   └── package.json
│   └── web/             # Vue 3 前端
│       ├── src/
│       │   ├── main.ts          # Vue + Pinia + Router 启动
│       │   ├── api/             # 按领域封装的 Axios 调用层
│       │   ├── components/      # 复用组件（ChapterBranchTree、NavBar）
│       │   ├── composables/     # 重逻辑组合式函数（editor、draft、tree、prompt）
│       │   ├── router/
│       │   │   └── index.ts     # 双 Layout 路由配置
│       │   ├── stores/          # Pinia：story.ts、theme.ts
│       │   ├── utils/
│       │   │   └── api.ts       # Axios 实例 + 拦截器
│       │   └── views/           # 页面组件（也充当 Layout）
│       └── vite.config.ts
├── packages/
│   ├── shared/          # 共享类型、常量、纯工具
│   ├── ai-provider/     # LLM Provider 抽象 + Runtime Prompt 编译器
│   ├── prompt-runtime/  # Prompt 组装管道 + Token 预算
│   ├── memory-engine/   # 记忆提取、语义搜索、格式化
│   ├── knowledge-graph/ # 内存图服务
│   ├── scoring-engine/  # 规则评分引擎
│   └── warning-engine/  # 占位（已移除）
├── prisma/
│   ├── schema.prisma    # Prisma 数据模型（20+ 个模型）
│   ├── migrations/      # 迁移文件（按时间顺序命名）
│   └── seed.ts          # 种子脚本
└── docs/
    ├── profiles/        # RuntimeProfile JSON 预设（启动时自动导入）
    └── sql-reference.md # SQL 相关
```

### 4.2 后端路由一览

| 路由文件 | 前缀/路径 | 核心功能 |
|----------|-----------|----------|
| `health.ts` | `/api/health` | 健康检查 |
| `stories.ts` | `/api/stories` | CRUD + plot-arcs 查询 + chapter-tree |
| `characters.ts` | `/api/stories/:storyId/characters` + `/api/characters/:charId` | 角色 CRUD + `CharacterBranchState` 历史 |
| `lore.ts` | `/api/stories/:storyId/lore` + `/api/lore/:itemId` | 世界观设定 CRUD |
| `timeline.ts` | `/api/stories/:storyId/timeline` + `/api/timeline/:eventId` | 时间线事件 CRUD |
| `chapters.ts` | `/api/stories/:storyId/chapters`, `/api/chapters/:chapterId/...` | **最复杂**：CRUD、preview、generate、select、archive、develop、chapter-tree |
| `drafts.ts` | `/api/chapters/:chapterId/drafts`, `/api/drafts/:draftId` | 草稿 CRUD |
| `graph.ts` | `/api/stories/:storyId/graph`, `/api/chapters/:chapterId/graph-snapshot` | 知识图谱查询 + 手动增删节点/边 |
| `memories.ts` | `/api/stories/:storyId/memory` | 记忆查询 + 创建 |
| `scores.ts` | `/api/drafts/:draftId/score`, `/api/stories/:storyId/scores` | AI + 规则双引擎评分 |
| `runtime-profile.ts` | `/api/runtime-profiles` | 写作人格 CRUD |
| `worker-task.ts` | `/api/worker-tasks` | Worker 任务模板 CRUD |
| `ai-provider.ts` | `/api/ai-providers` | AI 提供商配置 CRUD + 默认设置 |
| `prompt-logs.ts` | `/api/stories/:storyId/prompt-logs`, `/api/prompt-logs/:id` | Prompt 调用日志分页查询 |

**注意**：路由前缀不统一。`stories.ts` 使用 `prefix: '/api/stories'`，但 `characters.ts` 等很多路由是**在内部硬编码完整路径**（如 `/api/stories/:storyId/characters`）。

### 4.3 后端服务层一览

| 服务 | 职责 |
|------|------|
| `ai-provider-init.ts` | 从环境变量初始化 DeepSeek 配置到数据库；提供 `getDefaultProvider()` 工厂 |
| `ai-call-logger.ts` | **统一 AI 调用封装**：自动记录 `promptLog`（成功/失败均异步写入），返回 content 或抛出错误 |
| `runtime-loader.ts` | 加载 `RuntimeBase` 和 `WorkerTask`（按 Story → 全局默认 → 硬编码回退） |
| `runtime-profile-init.ts` | 启动时扫描 `../../docs/profiles/*.json` 导入 `runtimeProfile` |
| `generate-processor.ts` | 队列处理器：循环为每个 draft 调用 AI，更新 `draft.content` 和状态 |
| `combined-extractor.ts` | **归档核心**：一次 AI 调用同时提取记忆 + 图谱 + 剧情弧线 |
| `graph-extractor.ts` | 从章节提取图谱节点/边（`importance >= 6`），保存到 `graphNode`/`graphEdge` |
| `graph-organizer.ts` | AI 合并上一章全局图谱 + 本章提取 → 生成新的 `mergedGraph` + `chapterGraph` |
| `graph-snapshot.ts` | 将 `mergedGraph` 保存为 `chapter.graphSnapshot`，`chapterGraph` 保存为 `graphDelta` |
| `memory-extractor.ts` | 提取结构化记忆（主线/支线/情绪/伏笔/关系/状态/场景/摘要），Jaccard 去重后存入 `memory` 表 |
| `memory-organizer.ts` | 归档后 AI 整理记忆：merge/update/delete/keep，有 Jaccard > 0.5 保守校验 |
| `memory-compressor.ts` | 每 5 章自动压缩 chapter 记忆为 global 摘要；AI 压缩失败则降级为简单合并 |
| `plot-extractor.ts` | 提取/更新剧情弧线（`plotArc`），维护 stages/unresolved；`getActivePlotArcs()` 供 Prompt 注入 |

### 4.4 队列系统

- **Redis 可用时**：使用 `bullmq` 的 `Queue` + `Worker`
- **Redis 不可用时**：自定义 `MemoryQueue`（内存 Map，setTimeout 100ms 模拟异步处理）

**三个队列：**

| 队列 | 任务名 | 状态 |
|------|--------|------|
| `generateQueue` | `generate-chapter` | ✅ 已注册并运行 |
| `scoreQueue` | `score-draft` | ⚠️ 已定义但未注册处理器 |
| `memoryQueue` | `update-memory` | ⚠️ 已定义但未注册处理器 |

### 4.5 前端双 Layout 路由

| Layout | 路径示例 | 页面 |
|--------|----------|------|
| `SimpleLayout` | `/dashboard`、`/stories`、`/runtime-profiles`、`/worker-tasks`、`/model-manager` | 全局管理页 |
| `NovelDesignLayout` | `/novel-design/:storyId/characters`、`.../chapters`、`.../graph`、`.../memory`、`.../timeline`、`.../prompt-logs` | 小说内页（带侧边栏） |

旧路由已做重定向：`/characters` → `/stories` 等。

### 4.6 前端 API 层

`src/api/*.ts` 按领域封装，每个模块导出一个对象，包含该领域的 CRUD 函数。例如：
- `storiesApi.list()`、`storiesApi.create(data)`
- `chaptersApi.generate(chapterId, params)`
- `draftsApi.score(draftId)`
- `graphApi.createNode(storyId, data)`

---

## 5. 代码风格与开发约定

### 5.1 TypeScript 约束

**后端（`apps/server`、`packages/*`）**：
- `module: NodeNext` → **所有相对 import 必须带 `.js` 扩展名**（如 `import './app.js'`）
- `strict: true`，启用 `declaration` / `sourceMap`

**前端（`apps/web`）**：
- `module: ESNext`，`moduleResolution: bundler`
- 可使用 `allowImportingTsExtensions`
- `noUnusedLocals: true`、`noUnusedParameters: true`
- 路径别名 `@/` → `src/`

### 5.2 统一响应格式

几乎所有路由返回：
```json
{ "success": true, "data": ... }
```
或
```json
{ "success": false, "error": "..." }
```

前端 API 层未做统一包装解析，各调用点自行处理 `response.data.success`。

### 5.3 JSON 字段处理

Prisma 的 JSON 字段（`personality`、`metadata`、`params`、`settings`、`graphSnapshot`、`graphDelta`、`score` 等）在路由层**手动 `JSON.stringify` / `JSON.parse`**。前端拿到后也常需 `JSON.parse`。

### 5.4 AI 调用规范

**所有 AI 调用必须通过 `callAIWithLog()`**（`apps/server/src/services/ai-call-logger.ts`）：
- 自动写 `promptLog` 表（成功/失败均记录）
- 失败时抛出异常
- 返回 AI content 字符串

### 5.5 运行时加载回退链

`loadRuntimeBase()` 和 `loadWorkerTask()` 均遵循：
1. **Story 专属**（`storyId` 匹配）
2. **全局默认**（`isDefault = true`）
3. **硬编码兜底**（中性通用声明）

写作人格加载同理：
1. `Chapter.runtimeProfileId`
2. `Story.runtimeProfileId`
3. 全局默认 Profile
4. 硬编码兜底

### 5.6 归档事务

归档流程采用**四阶段 + 真实事务**策略：

1. **提取阶段**（`extractAll`）：纯 AI 调用，不写数据库
2. **整理阶段**（`organizeGraph`）：纯 AI 调用，整理知识图谱
3. **事务写入阶段**（`prisma.$transaction`）：所有数据库操作一次性提交
   - Memory、CharacterBranchState、TimelineEvent
   - Chapter.summary
   - PlotArc
   - GraphNode/GraphEdge、Chapter.graphSnapshot/graphDelta
   - Chapter.status = 'archived'
4. **优化阶段**（`optimizeMemories`）：生成全局记忆，失败不阻塞归档

**保证**：
- 阶段 1/2 失败 → 没有任何数据写入
- 阶段 3 失败 → 事务回滚，数据零变更
- 阶段 4 失败 → 归档已成功，仅全局记忆优化未执行

### 5.7 Naive UI 组件导入

前端每个 Naive UI 组件**显式单独导入**（tree-shaking 友好），不使用全局注册。表格操作列使用 Vue 的 `h()` 函数渲染（非 JSX）。

### 5.8 样式风格

- 前端以 **inline style** 为主（直接写在 Naive UI 组件的 `style` 属性上）
- 仅在 `ChapterBranchTree.vue` 等少数组件使用 scoped CSS
- 全局 reset 在 `App.vue`：`* { margin:0; padding:0; box-sizing:border-box }`
- 背景色随主题切换：`#f5f5f5`（light）/ `#101014`（dark）

---

## 6. 测试说明

- **测试框架**：Vitest 已安装（根目录 `devDependencies`）
- **当前状态**：**没有任何测试文件**（`.test.*` / `.spec.*`）
- 后端 `apps/server` 的 `package.json` 已配置 `"test": "vitest"`
- 根目录 `pnpm test` 会递归执行各包的 test 脚本

**建议**：新增测试时放在与被测代码同级或 `__tests__` 目录，使用 Vitest 的 API。

---

## 7. 安全与部署注意事项

### 7.1 认证与授权

**当前完全没有认证/鉴权机制。** 所有路由公开可访问，无 JWT、无 session、无 API Key 校验（除了 AI Provider 调用外部 API 用的 Key）。

CORS 配置为 `origin: true`（允许所有来源）。

### 7.2 环境变量

`.env` 文件位于项目根目录，关键变量：

```bash
DATABASE_URL="file:./dev.db"      # 开发用 SQLite
PORT=3000
HOST=0.0.0.0
NODE_ENV=development
VITE_API_BASE_URL=http://localhost:3000
REDIS_URL=redis://localhost:6379   # 可选
DEEPSEEK_API_KEY=...               # AI Provider Key
DEEPSEEK_BASE_URL=https://api.deepseek.com
DEEPSEEK_MODEL=deepseek-chat
DEEPSEEK_CONTEXT_LENGTH=64000
```

**注意**：`.env` 中包含了真实的 `DEEPSEEK_API_KEY`，请勿提交到仓库（已加入 `.gitignore`）。

### 7.3 AI Provider 配置

- 启动时自动从 `.env` 的 `DEEPSEEK_*` 变量创建默认 `AiProviderConfig`
- 支持通过 API 增删改查多 Provider 配置
- 当前只有 `DeepSeekProvider` 完全实现；`OpenAIProvider` 为 stub（全部抛出 "not yet implemented"）

### 7.4 数据库迁移

迁移文件位于 `prisma/migrations/`，按时间顺序命名。开发环境曾执行过 `prisma migrate reset`，数据可能已清空。如需保留数据请谨慎操作。

**切换 PostgreSQL**：
1. 修改 `.env` 的 `DATABASE_URL`
2. 修改 `prisma/schema.prisma` 的 `datasource.provider`
3. 执行 `pnpm db:migrate`

---

## 8. 已知问题与陷阱

### 8.1 类型宽松（部分修复）

大部分路由仍使用 `as any` 进行类型断言。

修复进展：`stories.ts` 已引入 zod 校验作为示范（`createStorySchema` / `updateStorySchema`），其余路由可参照逐步引入。

### 8.2 Token 计数（P1 收口后，2026-06-18）

`@novel-runtime/ai-provider` 的 `countTokens`（基于 `cl100k_base`）是项目 token 计数**唯一入口**。`apps/*` + `packages/prompt-runtime` 已全部采用。`estimateTokens` 作为 back-compat alias 已在 P1 Task 4 收尾删除（commit `412030a`）。

仍保留的独立实现：
- `packages/shared` 的 `estimateTokens`（启发式，无依赖）—— 仅供 `prompt-runtime/budget.ts` 在 `js-tiktoken` 不可用时 fallback
- `packages/{shared,memory-engine,prompt-runtime}` 3 个包**保留** `js-tiktoken` 直接装，因结构性原因（dep cycle / token ID API / model-aware encoding）无法切到 `countTokens`。详见 `KNOWN-ISSUES.md` 第 10 条。
- `prompt-runtime/budget.ts` 用 `encodingForModel(model)` + heuristic fallback，model-aware 路径（不是单纯 `cl100k_base`）
- `memory-engine` / `memory-extractor` / `memory-organizer` 直接使用 `js-tiktoken` 做 `encode()`（用于 Jaccard 相似度计算，token ID 数组，非单纯计数）

---

## 9. 功能速查

| 功能 | 后端文件 | 前端文件 |
|------|----------|----------|
| 章节路由（含 develop、chapter-tree） | `apps/server/src/routes/chapters.ts` | `apps/web/src/views/Chapters.vue` |
| 章节树组件 | — | `apps/web/src/components/ChapterBranchTree.vue` |
| 角色管理 | `apps/server/src/routes/characters.ts` | `apps/web/src/views/Characters.vue` |
| 知识图谱 | `apps/server/src/routes/graph.ts` | `apps/web/src/views/Graph.vue` |
| 记忆管理 | `apps/server/src/routes/memories.ts` | `apps/web/src/views/Memory.vue` |
| 时间线 | `apps/server/src/routes/timeline.ts` | `apps/web/src/views/Timeline.vue` |
| 写作人格 | `apps/server/src/routes/runtime-profile.ts` | `apps/web/src/views/RuntimeProfile.vue` |
| 模型管理 | `apps/server/src/routes/ai-provider.ts` | `apps/web/src/views/ModelManager.vue` |
| Prompt 日志 | `apps/server/src/routes/prompt-logs.ts` | `apps/web/src/views/PromptLogs.vue` |
| 写作人格加载 | `apps/server/src/services/runtime-loader.ts` | — |
| Worker Task 加载 | `apps/server/src/services/runtime-loader.ts` | — |
| 合并提取器 | `apps/server/src/services/combined-extractor.ts` | — |
| 记忆整理 | `apps/server/src/services/memory-organizer.ts` | — |
| Prompt Pipeline | `packages/prompt-runtime/src/index.ts` | — |
| 预算缩放 | `packages/shared/src/index.ts` (`scaleBudget`) | — |

---

*本文档基于项目实际代码生成，最后更新于 2026-05-31。*
