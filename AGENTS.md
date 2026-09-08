<!-- From: D:\MGit-Projects\ai-novel-runtime\AGENTS.md -->
# AI 小说工坊 — Agent Guide

> 本文档面向 AI Coding Agent。如果你对该项目一无所知，请从本文件开始阅读。

> AI 智能体约定规范：本项目下的 `Agreement.md` 文件。

---

## 1. 项目概述

**AI 小说工坊** 是一个「AI 小说工程化 Runtime 系统」。

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
| Naive UI | 组件库,中文 locale;主题色走 boords design system(`warmAccent: #b8581e` light / `#d97a3a` dark,见 `apps/web/src/styles/tokens.ts`),支持 light/dark/system 三模式切换 |
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
| js-tiktoken | Token 计算（cl100k_base）— P1 收口后**仅** `packages/ai-provider` 直接装,其它包 transitive 依赖;`packages/{shared,memory-engine,prompt-runtime}` 因结构性原因(dep cycle / token ID API / model-aware encoding)保留直接装,详见 `KNOWN-ISSUES.md` 第 10 条 |
| zod | 运行时校验(Q9 已接入前后端,`CompiledPromptSchema` / `CreateChapterRequestSchema` / `PrepareArchiveRequestSchema` / `PendingArchiveDataSchema` 等均在 `packages/shared/src/`) |

### 2.3 数据库

| 环境 | 数据库 |
|------|--------|
| 开发 | SQLite（零配置启动，`file:./dev.db`） |
| 生产 | PostgreSQL（切换仅需改 `.env` + `prisma/schema.prisma` 的 `provider`） |

主要模型：`Story`、`Chapter`、`Draft`、`Character`、`CharacterBranchState`、`LoreItem`、`Memory`、`TimelineEvent`、`PlotArc`、`RuntimeProfile`、`WorkerTask`、`AiProviderConfig`、`PromptLog`、`Score`。（`GraphNode`/`GraphEdge` 已在 v3 删除，图谱数据存 `Chapter.chapterGraph`/`cumulativeGraph` JSON 列。）

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
│   │   │   ├── routes/          # 18 个路由模块（P3 拆分后，见下表;`chapters.ts` 拆为 chapters-{crud,generate,archive,tree}.ts + _helpers.ts 共 5 文件）
│   │   │   └── services/        # 15 个服务/业务逻辑模块
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
├── prisma/
│   ├── schema.prisma    # Prisma 数据模型（16 个模型）
│   ├── migrations/      # 迁移文件（按时间顺序命名）
│   └── seed.ts          # 种子脚本
└── docs/
    ├── DESIGN.md        # boords 设计系统参考
    ├── ISSUES.md        # P0 + Q 决策 + 工程化决策 + 库选型 + 修复时间线
    ├── LOGIC.md         # 15 分钟架构速览
    ├── sql-reference.md # 数据模型 + 关系 + 迁移历史
    └── superpowers/     # 设计文档(specs/*) + 实施计划(保留 P1 / P5 作为模板)
```

### 4.2 后端路由一览

| 路由文件 | 前缀/路径 | 核心功能 |
|----------|-----------|----------|
| `health.ts` | `/api/health` | 健康检查 |
| `stories.ts` | `/api/stories` | CRUD + plot-arcs 查询 + chapter-tree |
| `characters.ts` | `/api/stories/:storyId/characters` + `/api/characters/:charId` | 角色 CRUD + `CharacterBranchState` 历史 |
| `lore.ts` | `/api/stories/:storyId/lore` + `/api/lore/:itemId` | 世界观设定 CRUD |
| `timeline.ts` | `/api/stories/:storyId/timeline` + `/api/timeline/:eventId` | 时间线事件 CRUD |
| `chapters-{crud,generate,archive,tree}.ts` + `_helpers.ts` | `/api/stories/:storyId/chapters`, `/api/chapters/:chapterId/...` | **最复杂**(P3 拆分):crud(基础 CRUD) / generate(preview + generate + select + develop) / archive(prepare-archive + archive 确认 + 事务) / tree(chapter-tree)。**v2**:`ChapterStatus` 收口到 3 值(`draft`/`reviewing`/`archived`);generate/select **不再翻 `chapter.status`**(只写 `Draft.status`,`archived` 章节兜底 400);prepare-archive 的独占锁条件为 `status ∈ [draft, reviewing]`,AI 提取失败回退 `draft` |
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
| `runtime-profile-init.ts` | 启动时扫描 `seeds/profiles/*.yaml` 导入 `runtimeProfile`(YAML 解析失败立即报错) |
| `generate-processor.ts` | 队列处理器：循环为每个 draft 调用 AI，更新 `draft.content` 和 `Draft.status`。**v2**：只读写 `Draft.status`（跳过 `rejected`/`completed`/`failed` 三种用户决定/已完成态；不再有 `selected` 状态），**不读不写 `Chapter.status`**——候选生成与章节状态正交 |
| `stages/` (character/memory/plot-arc/graph-extract) | **v3 归档核心**：4 个 stage 并行提取角色状态/记忆/弧线/本章图谱，结果落 `pendingArchiveData.stages[name]` |
| `cumulative-graph.ts` | 用户主动触发累计图谱合并（relation 映射归一 + codeMerge 五元组去重），写 `pendingArchiveData.cumulativeGraph` |
| `graph-snapshot.ts` | 图谱快照数据结构（GraphNodeSnapshot / GraphEdgeSnapshot / GraphSnapshot） |
| `memory-optimizer.ts` | 全局记忆融合（v2 阶段 4）：把上一章 global 记忆 + 本章 chapter 记忆喂 AI 生成下一章 global 快照。**v3 当前无调用点**（archive gate stub 尚未接回），函数保留待重新接入 |
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

Prisma 的 JSON 字段（`personality`、`metadata`、`params`、`settings`、`pendingArchiveData`、`chapterGraph`、`cumulativeGraph`、`score` 等）在路由层**手动 `JSON.stringify` / `JSON.parse`**。前端拿到后也常需 `JSON.parse`。

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

### 5.6 归档流程（v3）

归档流程 = 并行提取 + 人工审查 + 落列：

1. **提取阶段**（`prepare-archive`）：4 个 stage（character/memory/plot-arc/graph-extract）并行 AI 调用，结果写 `Chapter.pendingArchiveData`（version=3），状态变 `reviewing`。不写衍生表、不写图谱列
2. **累计图谱**（`cumulative-graph/build`）：用户主动触发，合并结果写 `pendingArchiveData.cumulativeGraph`
3. **人工审查**（`ReviewingPanel.vue`）：编辑经 `chaptersApi.update({ pendingArchiveData })` 写回；cancel 回退 `draft` 并清 `pendingArchiveData`
4. **落列阶段**（`archive` confirm）：校验全 stage success + 累计图谱已生成 → 图谱数据从 `pendingArchiveData` 拷到 `Chapter.chapterGraph`/`cumulativeGraph`/`cumulativeGraphGeneratedAt` 三列 → 清 `pendingArchiveData` → status=`archived`

**保证**：
- reviewing 期间所有图谱数据只活在 `pendingArchiveData`，三列保持 null
- 单 stage 失败不影响其他 stage，failed 状态落 payload 可按 stage 重试
- 衍生表（Memory/CharacterBranchState/PlotArc）事务写入与 `optimizeMemories` 重接为后续工作（当前 archive 是 gate stub）

### 5.7 Naive UI 组件导入

前端每个 Naive UI 组件**显式单独导入**（tree-shaking 友好），不使用全局注册。表格操作列使用 Vue 的 `h()` 函数渲染（非 JSX）。

### 5.8 样式风格

- 前端以 **inline style** 为主（直接写在 Naive UI 组件的 `style` 属性上）
- 仅在 `ChapterBranchTree.vue` 等少数组件使用 scoped CSS
- 全局 reset 在 `App.vue`：`* { margin:0; padding:0; box-sizing:border-box }`
- 颜色/间距统一走 boords design system tokens(`apps/web/src/styles/tokens.ts` + `tokens.css`),light 用 `warmCream #fafaf5` / dark 用 `#141414`;**不要**在 view 文件里硬编码 hex

---

## 6. 测试说明

- **测试框架**：Vitest（根目录 + 各包 devDependencies）
- **当前状态**：已有测试,集中在 `apps/server/src/__tests__/`(vitest 后端,e.g. `chapters-zod-validation.test.ts` / `chapters-concurrency.test.ts` / `stages-*.test.ts` / `cumulative-graph.test.ts` / `prepare-archive-v3.test.ts` 等);`packages/ai-provider` 也有 `runtime-compiler.test.ts`(13 个 case)
- 根目录 `pnpm test` 会递归执行各包的 test 脚本;`apps/server` 的 `pretest` hook 会先 build 所有 packages 避免 stale dist

**建议**：新增测试时放在与被测代码同级或 `__tests__` 目录，使用 Vitest 的 API。TDD 优先 — 写失败测试 → 写实现 → 重构。

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
- `memory-engine` 直接使用 `js-tiktoken` 做 `encode()`（用于 Jaccard 相似度计算，token ID 数组，非单纯计数）

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
| v3 归档 stage（4 stage 并行） | `apps/server/src/services/stages/{character,memory,plot-arc,graph-extract}-stage.ts` | — |
| Prompt Pipeline | `packages/prompt-runtime/src/index.ts` | — |
| 预算缩放 | `packages/shared/src/index.ts` (`scaleBudget`) | — |

---

## 10. 作者与 AI 的定位

> 本节记录系统设计中人与 AI 的分工，作为后续功能扩展的决策锚点。

### 10.1 作者（人类）

- **主导方向**：写大纲、定场景、选写作人格、决定故事走向。
- **策展 / 导演**：从多个 AI 候选中选择最满意的版本；审查 AI 提取的记忆、图谱、剧情弧线、角色状态变化，决定哪些进入数据池。
- **质量最终责任人**：AI 提供"量"，作者完成"质变"前的筛选和确认。

### 10.2 AI

- **批量生成候选**：同一大纲下产出多个风格 / 温度的正文版本（量变）。
- **自动提取与整理**：从正文中抽取记忆、实体关系、剧情弧线、角色状态变化等素材。
- **提供可选素材**：不替作者做决定，只扩大选择面；最终采用权在作者。

### 10.3 Runtime（系统）

- **稳定串联数据流**：数据池 ↔ 大纲 ↔ 正文 ↔ 数据回流。
- **保证数据不丢、状态不乱、可回滚**：状态机锁、事务写入、checkpoint 机制。
- **高效调度 AI 调用**：队列、重试、预算管理、Prompt 日志记录。

### 10.4 核心设计原则

> **AI 负责量变，作者完成质变；Runtime 让量变稳定、可控、可积累。**

- 不要追求"一键生成完美章节"，而是"一次生成多个候选 + 可审查的素材"。
- 所有 AI 输出都应可被作者查看、选择、修改或丢弃。
- 数据池是长期资产：当前章节的输出要成为下一章节的输入，形成复利。

---

*本文档基于项目实际代码生成，最后更新于 2026-05-31。*
