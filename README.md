# AI 小说工坊

<p align="center">
  <img src="docs/logo.png" alt="AI 小说工坊" width="160" />
</p>

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
- **章节状态机** — `ChapterStatus` 3 值（`draft` / `reviewing` / `archived`），候选生成（`Draft.status`）与章节状态正交
- **多候选生成** — 一次生成多个候选版本，支持不同 temperature 采样策略
- **Prompt Pipeline** — Pipeline 式 Prompt 组装，Token 预算控制，动态裁剪，Stateless Generation
- **多模型兼容** — `AIProvider` 统一接口；当前 `DeepSeekProvider` 完整实现，`OpenAIProvider` 是 stub
- **知识图谱** — 人物关系图、势力图、事件图、物品图的可视化与管理（Cytoscape）
- **分层记忆** — Global / Chapter / Scene / Temporary 四层记忆系统，语义检索 + 近似去重 + AI 记忆优化
- **剧情弧线追踪** — 追踪主线/支线剧情进展，标注未解悬念
- **任务队列** — 生成异步化（BullMQ + Redis，开发环境自动回退内存队列）

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
| `/api/stories/:id/graph` | GET | 知识图谱 |
| `/api/stories/:id/memory` | GET/POST | 记忆管理 |
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

- 删除已归档章节时级联清理同 `fromChapterNumber` 的派生数据（记忆、角色状态）并从上一章 snapshot 重建图谱
- `parentChapterId` 字段记录分支父节点；`ChapterBranchTree.vue` 渲染树形视图

### Prompt Pipeline

Runtime 采用 **Stateless Generation**：每次生成都是全新上下文，不续聊天记录。

Prompt 分层组装（从下到上）：

```
System Message  ← [Identity] + [Settings] + [Behavior] + [Jailbreak] + [Task]
  ↓
User Message  ← Style → Story → Lore → Character → Scene → Memory → PlotArc → Output
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

`ChapterStatus` 3 值：`draft` / `reviewing` / `archived`；候选生成（`Draft.status`）与章节状态正交。

```
draft ──┬─→ preparing-archive ─→ reviewing ─→ archived
        │       (AI 提取)              ↑
        └──── 用户重编辑 / 取消 ────────┘ (回退)
```

归档分阶段：`prepare-archive`（4 个 stage 并行提取 + memoryOptimize 串行）→ 用户审查 → `archive`（事务提交）。

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

### 添加新的预设写作人格

在 `seeds/profiles/` 下新建 YAML 文件（带 Zod schema 校验，`packages/shared/src/profile-schema.ts`），后端启动时自动扫描并导入数据库。YAML 解析失败会立即报错（无 silent fallback），便于调试。

---

## 设计理念

```
结构化世界 + AI 生成

而不是：

巨大 Prompt + 无限 Agent
```

真正重要的是：状态管理、记忆管理、世界观一致性、长篇稳定性、章节工业化。AI 只是**文本生成器**，Runtime 才是真正核心。

### 三者分工

| 角色 | 职责 |
|------|------|
| **作者（人类）** | 主导方向（大纲/场景/人格/走向）；策展（从候选中筛选、审查 AI 提取的素材）；质量最终责任人 |
| **AI** | 批量生成候选（量变）；自动提取记忆/图谱/弧线/角色状态；只提供素材、不做决定 |
| **Runtime（系统）** | 稳定串联数据流；保证数据不丢、状态不乱、可回滚；调度 AI 调用（队列/重试/预算/日志） |

> **AI 负责量变，作者完成质变；Runtime 让量变稳定、可控、可积累。**

- 不要追求「一键生成完美章节」，而是「一次生成多个候选 + 可审查的素材」
- 所有 AI 输出都应可被作者查看、选择、修改或丢弃
- 数据池是长期资产：当前章节的输出要成为下一章节的输入，形成复利

---

## License

MIT
