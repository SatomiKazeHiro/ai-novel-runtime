# 工程债务记录

> 本文档记录项目中"已设计但很少使用"或"存在歧义"的模块、代码和设计决策，供后续优化参考。

---

## 一、已设计但很少使用 / 处于尴尬位置的模块

### 1. WorkerTask（工作流任务）✅ 已重构为核心配置层

**位置**：
- 数据库：`WorkerTask` 模型、`StoryWorkerBinding` 模型（`prisma/schema.prisma`）
- 后端路由：`apps/server/src/routes/worker-task.ts`
- 前端页面：`apps/web/src/views/WorkerTask.vue`（全局配置）、`apps/web/src/views/StoryWorkerTask.vue`（小说空间 Tabs 配置）
- 后端调用：`apps/server/src/services/runtime-loader.ts` 中的 `loadWorkerTask()`

**已完成重构**：
- `WorkerTask` 新增 `type` 字段（`system` / `custom`），系统内置 6 条默认 Task
- 新建 `StoryWorkerBinding` 表，小说创建时自动绑定系统默认 Task
- `loadWorkerTask()` 改为三级回退：**小说显式绑定** → **系统默认** → **硬编码兜底（带 error log）**
- 前端全局页面：列表展示，system 类型只读，custom 类型可编辑删除
- 前端小说空间页面：Tabs 表单，6 个 Worker 类型各一个 Tab，下拉选择 Task

**现状**：
- WorkerTask 已从"尴尬配置"变为**核心 Prompt 配置层**
- 用户可以在全局页面创建自定义 Task，在小说空间为每种 Worker 独立选择使用哪个 Task
- 与 RuntimeProfile 的职责已清晰分离：Profile = 写作人格（Identity/Behavior），WorkerTask = 任务指令（Task Layer）

---

### 2. PromptConfig（旧版 Prompt 配置）✅ 已移除

**位置**：
- 数据库：`PromptConfig` 模型（`prisma/schema.prisma`）

**已完成**：
- 已从 `prisma/schema.prisma` 删除 `PromptConfig` 模型及 `Story` 关系字段
- `docs/sql-reference.md` 已清理引用
- 重新生成了 Prisma Client

**注意**：
- 历史迁移文件仍保留（`prisma/migrations/*/migration.sql`），不影响当前运行

---

### 3. WarningEngine（警告引擎）✅ 已移除

**位置**：
- ~~`packages/warning-engine/`~~

**已完成**：
- 目录此前已删除（无实质代码）
- `AGENTS.md`、`README.md` 中的引用已更新为"已移除"
- `pnpm-workspace.yaml` 使用通配符 `packages/*`，无需修改

---

### 4. OpenAIProvider（OpenAI 提供商）✅ 已重构

**位置**：
- `packages/ai-provider/src/index.ts`

**已完成**：
- 已移除独立的 `DeepSeekProvider` 和 `OpenAIProvider` 类
- 合并为 `OpenAICompatibleProvider`，支持所有 OpenAI 兼容格式的服务商
- 当前白名单：`deepseek`、`openai`、`openrouter`、`moonshot`、`siliconflow`
- 自动根据 `config.name` 匹配默认 Base URL
- OpenRouter 自动附加 `HTTP-Referer` 和 `X-Title` header
- `createProvider()` 未知 Provider 直接抛错（不再 fallback 到 OpenAIProvider stub）

**遗留问题**：
- `streamGenerate` 仍为 stub（所有 Provider）
- `embedding` 仍为 stub（所有 Provider）
- 如需接入非 OpenAI 兼容的 Provider（如 Claude 原生 API、Google Gemini），需新建独立 Provider 类

---

### 5. ScoreQueue / MemoryQueue（未注册处理器）✅ 已移除

**位置**：
- ~~`apps/server/src/queue/index.ts`~~

**已完成**：
- 已从 `queue/index.ts` 删除 `scoreQueue`、`memoryQueue` 及其注册函数、Worker
- 仅剩 `generateQueue` 和 `registerGenerateProcessor`
- `startWorkers()` 仅返回 `{ generateWorker }`

---

### 6. zod（已安装但未使用）

**位置**：
- `apps/server/package.json`
- 路由中大部分仍使用 `as any`

**当前状态**：
- 只有 `stories.ts` 引入了 zod 校验作为示范
- 其他 13 个路由模块均未使用

**问题**：
- 安装了依赖但几乎不用，浪费 bundle 空间
- 类型校验和运行时校验两套体系并存，增加维护成本

**建议**：
- 方案 A：逐步推广 zod 到所有路由（工作量大）
- 方案 B：移除 zod，统一使用 TypeScript 类型 + 手动校验

---

## 二、有歧义的业务逻辑

### 1. "主线" vs "主要事件" 的定义变化

**历史**：
- 旧逻辑：`mainEvents` = "主线事件"，`sideEvents` = "支线事件"
- 由后端硬编码 `importance`（主线 9、支线 6）

**新逻辑**：
- `mainEvents` = "主要事件"（`importance >= 8`）
- `sideEvents` = "次要事件"（`importance < 8`）
- 由 AI 自评 `importance`（4~7），主角参与 +1

**歧义**：
- 数据库中旧的 `main-plot` 标签含义发生了变化
- `memory-compressor.ts` 的 `simpleMerge` 仍用 `main-plot` 标签分组，但标签赋值逻辑已变

**建议**：
- 统一术语："主要事件/次要事件"替代"主线/支线"
- 考虑将 `main-plot` 标签重命名为 `major-event`

---

### 2. 记忆层（Layer）的语义

**当前定义（新架构）**：
- `global`：每章归档后由 `memory-optimizer` 生成的优化记忆快照。同一 `originUid` 可能有多条历史版本，Prompt 组装时只取最新。这是给下一章用的"前情提要"。
- `chapter`：本章原始提取的记忆（`combined-extractor` 第一阶段产物），不参与 Prompt 组装，只作为优化器的输入素材。
- `scene`：场景记忆（地点相关）
- `temporary`：临时记忆（从未实际使用）

**已解决的问题**：
- ✅ `global` 层语义已明确：不再是"每5章压缩一次"，而是"每章优化一次"
- ✅ `chapter` 层语义已明确：纯 raw 素材，不进入 Prompt

**剩余歧义**：
- `temporary` 层从未看到实际使用
- `scene` 层的自动提取逻辑未实现（目前只有手动接口）

**建议**：
- 考虑废弃 `temporary` 层
- 或将其重命名为 `draft` 层，用于保存生成过程中的临时上下文

---

### 3. 归档伪事务 vs 真实事务 ✅ 已重构为真实事务

**位置**：
- `apps/server/src/routes/chapters.ts` 中的 `POST /api/chapters/:chapterId/archive`
- `apps/server/src/services/memory-extractor.ts`
- `apps/server/src/services/plot-extractor.ts`
- `apps/server/src/services/graph-snapshot.ts`
- `apps/server/src/services/combined-extractor.ts`

**已完成重构**：
- `extractAndSaveAll` 拆分为 `extractAll`（纯 AI 提取，不写数据库）
- `saveExtractedMemory` 拆分为 `prepareMemoryWrites` + `commitMemoryWrites`
- `savePlotArcs` 拆分为 `preparePlotArcWrites` + `commitPlotArcWrites`
- `saveGraphSnapshotAndDelta` 改为接受 `prisma` 参数（支持传入事务 client）
- 归档流程改为四阶段：
  1. `extractAll` — 纯 AI 提取，0 数据库写入
  2. `organizeGraph` — 纯 AI 整理图谱
  3. `prisma.$transaction` — 一次性提交 Memory、CharacterBranchState、TimelineEvent、Chapter.summary、PlotArc、GraphNode/GraphEdge、Chapter.graphSnapshot、Chapter.status='archived'
  4. `optimizeMemories` — 可选的全局记忆优化，失败只打日志不阻塞归档

**现状**：
- 阶段 1/2 失败：没有任何数据库写入
- 阶段 3 失败：事务回滚，没有任何数据变更
- 阶段 4 失败：归档已成功，仅全局记忆优化未执行，不影响一致性

**已知折中**：
- `prepareMemoryWrites` 当前未做 Jaccard 去重（原 `saveExtractedMemory` 会查询最近 50 条记忆去重）
- 如果同一事件被重复归档，可能产生少量重复记忆，但不会影响正确性

---

## 三、代码层面的冗余

### 1. 重复的 JSON.parse/JSON.stringify 安全包装 ✅ 已完成

**位置**：遍布前后端

**模式**：
```ts
JSON.parse(xxx || '{}')
JSON.parse(xxx || '[]')
```

**已完成**：
- `safeJsonParse<T>(str, fallback)` 和 `safeJsonStringify<T>(value)` 已提取到 `@novel-runtime/shared`
- 前后端主要文件已替换（memory-engine、server routes、web views 等）
- 使用注意：空数组 fallback `[]` 会被推断为 `never[]`，需显式指定泛型参数如 `safeJsonParse<string[]>(str, [])`

### 2. 重复的 jaccardSimilarity + tokenSet ✅ 已完成

**位置**：
- `memory-extractor.ts`

**已完成**：
- `tokenize(text)`、`jaccardSimilarity(a, b)`、`cosineSimilarity(a, b)`、`buildFreqVector(tokens)` 已提取到 `@novel-runtime/shared`
- `memory-extractor.ts` 已使用 shared 版本
- `memory-organizer.ts` 已废弃，无需处理

### 3. 废弃的 memory-organizer 和 memory-compressor

**位置**：
- `apps/server/src/services/memory-organizer.ts`
- `apps/server/src/services/memory-compressor.ts`

**状态**：
- 文件仍在，但不再被调用
- `memory-extractor.ts` 中的 `maybeCompressMemories` 导入已移除
- 新的 `memory-optimizer.ts` 已替代两者功能

**建议**：
- ✅ 已加 `@deprecated` 注释到 README 项目结构中
- 短期保留文件作为参考，长期可移至 `legacy/` 或删除

---

## 四、性能与扩展性隐患

### 1. global 层记忆追加式存储

**问题**：
- 每章归档都插入新的 global 记录
- 同一 `originUid` 可能有多条历史版本
- 长期运行后 `Memory` 表数据量膨胀

**建议**：
- 未来可考虑定期清理旧版本（只保留最近 N 个版本的 global 记忆）
- 或新增 `MemoryVersion` 表专门管理历史

### 2. searchRelevant 的全表扫描

**问题**：
- `searchRelevant` 每次都要加载 story 下的全部记忆做语义计算
- 随着章节增多，内存和计算量线性增长

**建议**：
- 未来可考虑只加载最近 N 章的记忆 + global 记忆
- 或引入向量数据库（如 pgvector / sqlite-vss）做真正的语义检索

### 3. combined-extractor 的 Token 消耗

**问题**：
- 一次 API 调用同时完成记忆+图谱+弧线三个任务
- 随着已有记忆和图谱数据增多，Prompt 会越来越长
- 可能超过模型上下文长度

**建议**：
- 监控 Prompt 长度，超长时截断已有图谱节点列表
- 或考虑拆分为两个 API 调用（记忆+弧线 vs 图谱）

---

## 五、前端层面的问题

### 1. Characters.vue 中大量的 JSON.parse

**位置**：`apps/web/src/views/Characters.vue` 第 177-183 行

**模式**：
```ts
identity: JSON.parse(row.identity || '[]'),
appearance: JSON.parse(row.appearance || '[]'),
// ... 重复 7 次
```

**优化方向**：
- 提取 `safeJsonParse` 工具函数
- 或在后端直接返回解析后的 JSON（但需改路由）

### 2. 内联样式为主

**位置**：大部分前端页面

**问题**：
- AGENTS.md 5.8 明确说明"前端以 inline style 为主"
- 可维护性差，主题切换时样式分散在各组件

**建议**：
- 短期：接受现状
- 长期：考虑引入 CSS 变量或 UnoCSS / Tailwind 做统一管理

---

*最后更新：2026-06-07**
