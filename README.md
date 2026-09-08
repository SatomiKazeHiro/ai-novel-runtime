# AI 小说工坊

> **AI 小说工程化 Runtime 系统**
>
> 目标不是让 AI 自动写小说，而是让用户可以**稳定、高质量、可控地**开发长篇小说。
>
> **人类主导方向 · AI 负责生成 · Runtime 负责稳定**

---

## 核心特性

- **长篇小说工程化开发** — 多小说工程管理，工业化章节流水线
- **主线 + 番外分支设计** — 主线严格线性（1 → 2 → 3），番外（`isSideStory`）可挂在任意已归档章节下（`1.01`、`2.03`），一个小说承载多条叙事支线
- **结构化世界观管理** — LoreBook 系统化维护境界、地图、功法、势力、物品、规则
- **角色卡系统** — 静态属性（性格、外貌、说话风格）+ 历史快照动态状态（按 `fromChapterNumber` 记录，删除章节自动回退）
- **章节状态机** — `Draft → Generating → Generated → Scored → Selected → Reviewing → Archived`(+ `Rejected`)，`Reviewing` 是 2026-06 新加的人工审查环节（见 `Chapter.pendingArchiveData`）
- **多候选生成** — 一次生成多个候选版本，支持不同 temperature 采样策略
- **AI 评分** — 7 维度评分（文风接近度、大纲符合度、场景符合度、写作人格一致性、文笔质量、情感张力、节奏把控）
- **Prompt Pipeline** — Pipeline 式 Prompt 组装，Token 预算控制，动态裁剪，Stateless Generation
- **多模型兼容** — `AIProvider` 统一接口；当前 `DeepSeekProvider` 完整实现，`OpenAIProvider` 是 stub（其它 Provider 按同一接口实现即可接入）
- **知识图谱** — 人物关系图、势力图、事件图、物品图的可视化与管理（全局工作表，Cytoscape）
- **分层记忆** — Global / Chapter / Scene / Temporary 四层记忆系统，语义检索 + 近似去重 + AI 记忆优化（每章归档后自动融合新旧记忆）
- **剧情弧线追踪** — 追踪主线/支线剧情进展，标注未解悬念
- **任务队列** — 生成异步化（BullMQ + Redis，开发环境自动回退内存队列）

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
| Naive UI | 组件库；主题色走 boords design system（light/dark/system 三模式切换） |
| Axios | HTTP 请求 |
| Cytoscape | 知识图谱可视化 |
| @vueuse/core | 组合式工具库（含 `useIntervalFn` 用于轮询生成状态） |
| es-toolkit | 现代化工具库（lodash 替代） |

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
| js-tiktoken | Token 计算（cl100k_base；P1 收口后仅 `packages/ai-provider` 直接装，其它包 transitive 依赖；`packages/{shared,memory-engine,prompt-runtime}` 因结构性原因保留直接装） |
| zod | 运行时校验（Q9 已接入前后端） |

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
│   │       ├── routes/      # API 路由（18 个模块；P3 把 chapters.ts 拆为 5 文件）
│   │       │   ├── health.ts
│   │       │   ├── stories.ts
│   │       │   ├── characters.ts
│   │       │   ├── lore.ts
│   │       │   ├── timeline.ts
│   │       │   ├── chapters-crud.ts         # 章节 CRUD（基础）
│   │       │   ├── chapters-generate.ts     # preview / generate / select / develop
│   │       │   ├── chapters-archive.ts      # prepare-archive / archive 确认（含事务）
│   │       │   ├── chapters-tree.ts         # chapter-tree
│   │       │   ├── _helpers.ts              # 共享 helper（状态机 / 锁 / 异常）
│   │       │   ├── drafts.ts
│   │       │   ├── graph.ts
│   │       │   ├── memories.ts
│   │       │   ├── scores.ts
│   │       │   ├── runtime-profile.ts
│   │       │   ├── worker-task.ts
│   │       │   ├── ai-provider.ts
│   │       │   └── prompt-logs.ts
│   │       └── services/    # 业务处理器（15 个）
│   │           ├── ai-provider-init.ts      # 启动时从 env 初始化默认 AI Provider
│   │           ├── runtime-profile-init.ts  # 启动时扫描 seeds/profiles/*.yaml 导入
│   │           ├── worker-task-init.ts      # 启动时扫描 seeds/worker-tasks/*.yaml 导入
│   │           ├── runtime-loader.ts        # 加载 RuntimeBase / WorkerTask（Story→默认→fallback）
│   │           ├── generate-processor.ts    # BullMQ 队列处理器：循环生成 draft
│   │           ├── ai-call-logger.ts        # **强制** AI 调用包装：自动写 PromptLog
│   │           ├── combined-extractor.ts    # 归档核心：一次 AI 提取记忆+图谱+弧线
│   │           ├── graph-extractor.ts       # legacy（已被 combined-extractor 取代，保留死代码）
│   │           ├── graph-organizer.ts       # 归档阶段 2：合并全局图谱 + 本章新增
│   │           ├── graph-snapshot.ts        # 扩展邻域 / 图谱快照数据结构
│   │           ├── memory-extractor.ts      # legacy（保留死代码）
│   │           ├── memory-organizer.ts      # AI 整理：merge/update/delete/keep + Jaccard 校验
│   │           ├── memory-optimizer.ts      # 归档阶段 4：全局记忆融合（失败不阻塞归档）
│   │           ├── memory-compressor.ts     # @deprecated，未被路由调用
│   │           └── plot-extractor.ts        # 提取/更新剧情弧线
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
│           │   ├── ChapterReader.vue          # 章节独立阅读页（d253ac0）
│           │   ├── Timeline.vue
│           │   ├── Graph.vue                  # view shell（P5 拆为 GraphView + EditableGraph）
│           │   ├── Memory.vue
│           │   ├── ReviewingPanel.vue         # reviewing 状态的人工审查页
│           │   ├── RuntimeProfile.vue
│           │   ├── WorkerTask.vue
│           │   ├── StoryWorkerTask.vue
│           │   ├── ModelManager.vue
│           │   ├── PromptLogs.vue
│           │   ├── SimpleLayout.vue
│           │   ├── NovelDesignLayout.vue
│           │   └── chapters/                  # P4：Chapters.vue 拆为 4 子组件
│           │       ├── ChapterToolbar.vue
│           │       ├── ChapterList.vue
│           │       ├── ChapterEditor.vue
│           │       └── ChapterPreview.vue
│           ├── components/    # 共享组件
│           │   ├── ChapterBranchTree.vue
│           │   ├── ChapterStatusBadge.vue
│           │   ├── DynamicTags.vue
│           │   ├── NavBar.vue
│           │   └── graph/                     # P5：Graph 拆分后的 display + editable 组件
│           │       ├── GraphView.vue
│           │       ├── EditableGraph.vue
│           │       ├── ChapterReel.vue
│           │       └── GraphLegend.vue
│           ├── composables/   # 组合式函数（editor / draft / tree / prompt + graph 子目录）
│           │   ├── graph/useCytoscapeLifecycle.ts    # P5 抽出的共享 hook（407 行）
│           │   ├── useChapterEditor.ts
│           │   ├── useChapterTree.ts
│           │   ├── useDraftManager.ts
│           │   └── usePromptManager.ts
│           └── utils/
│               └── api.ts
├── packages/                  # 共享包（Monorepo；6 个包）
│   ├── shared/                # 类型、常量、工具函数 + zod schema
│   ├── ai-provider/           # AI Provider 统一封装 + Runtime Prompt 编译器 + countTokens
│   ├── prompt-runtime/        # Prompt Pipeline / Token 预算控制（model-aware）
│   ├── memory-engine/         # 分层记忆管理 + 语义检索 + Jaccard 去重
│   ├── knowledge-graph/       # graphology 图引擎封装
│   └── scoring-engine/        # 规则评分引擎
├── docs/
│   ├── DESIGN.md              # boords 设计系统参考
│   ├── ISSUES.md              # P0 + Q 决策 + 工程化决策 + 库选型 + 修复时间线
│   ├── LOGIC.md               # 15 分钟架构速览
│   ├── sql-reference.md       # 数据模型 + 关系 + 迁移历史
│   └── superpowers/           # 设计文档（specs/*）+ 实施计划（plans/ 保留 P1/P5 作模板）
├── seeds/                     # 注意：在仓库根目录，不在 docs/ 下
│   ├── profiles/              # RuntimeProfile YAML 预设（启动时自动导入）
│   └── worker-tasks/          # WorkerTask YAML 预设（启动时自动导入）
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
| `Chapter` | 章节（含状态机、场景状态、`isSideStory` 番外标记；图谱存 `chapterGraph`/`cumulativeGraph` JSON 列） |
| `Character` | 角色卡（静态属性：性格、外貌、说话风格） |
| `CharacterBranchState` | 角色历史快照（按 `fromChapterNumber` 记录动态状态变化） |
| `LoreItem` | 世界观条目（境界/地图/功法/势力/物品/规则） |
| `Memory` | 记忆（global=每章优化后的状态快照/chapter=原始提取/scene/temporary） |
| `TimelineEvent` | 时间线事件（按 `fromChapterNumber` 标记生命周期） |
| `PlotArc` | 剧情弧线（全局） |
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
| `/api/chapters/:id/develop` | POST | 发展下一章/番外（主线仅限最新章节；状态机独占锁 Q10） |
| `/api/chapters/:id/preview` | POST | 预览 Prompt（不写入 DB） |
| `/api/chapters/:id/generate` | POST | 提交生成任务（状态机独占锁） |
| `/api/chapters/:id/select` | POST | 采用候选（事务内校验 draft.chapterId === chapterId） |
| `/api/chapters/:id/prepare-archive` | POST | **阶段 1+2**：合并提取 + 图谱整理 → 写 `Chapter.pendingArchiveData` → 状态变 `reviewing` |
| `/api/chapters/:id/archive` | POST | **确认归档**：从 `pendingArchiveData` 读出 → 事务写入全部派生数据 + `status='archived'` → 阶段 4 全局记忆融合 |

### 其他领域 API

| 接口 | 方法 | 说明 |
|------|------|------|
| `/api/stories/:id/characters` | GET/POST | 角色管理 |
| `/api/stories/:id/lore` | GET/POST | 世界观条目 |
| `/api/stories/:id/timeline` | GET/POST | 时间线事件 |
| `/api/stories/:id/graph` | GET | 知识图谱 |
| `/api/stories/:id/memory` | GET/POST | 记忆管理 |
| `/api/drafts/:id/score` | POST | AI 评分（7 维度） |
| `/api/ai-providers/default` | GET | 默认模型配置 |

---

## 核心系统设计

### 章节分支设计

一本小说承载**一条主线 + 任意条番外支线**：

- **主线**严格线性（`1 → 2 → 3 → 4`），只能从最新章节继续发展；序号为整数
- **番外**（`isSideStory = true`）可挂在任意已归档章节下，序号为小数（`1.01` 从第 1 章分出，`2.03` 从第 2 章分出）
- 番外有完整的章节生命周期（draft → archived），但归档时**不触发**主线的全局记忆融合（只在自己的 snapshot 上扩展）
- 无版本分支概念 — 所有数据全局共享（同一小说的番外与主线共享角色 / 世界观 / 记忆）

```
第1章 → 第2章 → 第3章 → 第4章（主线）
  │        │
  ↓        ↓
番外·1.01  番外·2.01（支线，可独立或并列发展）
```

- 删除已归档章节时级联清理同 `fromChapterNumber` 的派生数据（记忆、时间线、角色状态）并从上一章 snapshot 重建图谱
- `parentChapterId` 字段记录分支父节点；`ChapterBranchTree.vue` 渲染树形视图

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
- **AI 记忆优化**：归档后自动触发，基于上一章 global + 本章 raw 生成新的 global 快照，保留历史版本

### 章节状态机

```
   Draft → Generating → Generated → Scored → Selected → Reviewing → Archived
     ↓         ↓             ↓          ↓       ↓           ↓              ↑
  Rejected  Rejected     Rejected  (保留)  Rejected   (取消 = 删除章节)   阶段 1+2: 合并提取 + 图谱整理
                                                                              → 写 pendingArchiveData → reviewing
                                                                  阶段 3: prisma.$transaction 提交
                                                                  阶段 4: optimizeMemories 全局融合（失败不阻塞）
```

8 个状态值见 `prisma/schema.prisma` 的 `enum ChapterStatus`。`reviewing` 是 2026-06 新加的关键环节，AI 提取完不直接写库，等用户在 `ReviewingPanel.vue` 编辑后再 commit。

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

在 `seeds/profiles/` 下新建 YAML 文件（带 Zod schema 校验，`packages/shared/src/profile-schema.ts`），后端启动时自动扫描并导入数据库。YAML 解析失败会立即报错（无 silent fallback），便于调试。

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
