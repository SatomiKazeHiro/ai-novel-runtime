# KNOWN-ISSUES.md

> 项目当前已知的、会影响鲁棒性或安全的问题清单。每条都给出**为什么重要**和**避雷指引**。
>
> 这份文件与 `CLAUDE.md` 分离，便于逐条偿还而不动主文档。

---

## 已知问题

### 1. 后端路由大量 `as any`（部分修复）
- **位置：** `apps/server/src/routes/*.ts`。
- **现状：** 大部分路由仍以 `as any` 做类型断言，仅 `stories.ts` 引入了 zod 校验作为示范（`createStorySchema` / `updateStorySchema`）。
- **为什么重要：** AI 生成的请求体若字段缺失或类型错误，请求会穿透到 Prisma 才报错，错误信息不友好、且容易写出空指针逻辑。
- **避雷指引：** 新增/修改路由时，**优先**用 zod 校验入参（项目已安装 `zod`，仅是未启用）。`stories.ts` 是参考样板。

### 2. `Chapter.status` 状态枚举与前端映射不一致
- **位置：** 枚举定义在 `prisma/schema.prisma` 的 `ChapterStatus`（8 个值：`draft | generating | generated | scored | selected | reviewing | archived | rejected`）；前端映射在 `apps/web/src/views/Chapters.vue` 的 `statusTagType`。
- **现状：** `statusTagType` 缺少 `scored` 和 `rejected` 两个 case，会回落到 `default` 样式。生成中 (`generating`) 与已生成 (`generated`) 共享 warning 色，区分度差。
- **为什么重要：** `reviewing` 是新加的关键状态，前端遗漏会让章节从审查态退出时样式无变化；`scored` 同理。
- **避雷指引：** 改状态枚举时同步更新前端的 `statusTagType`、`Chapters.vue` 的过滤逻辑，以及 `Process.md` 的状态机图。

### 3. Token 计数有 3 套并行实现
- **位置：** `packages/shared/src/index.ts`（启发式 `estimateTokens`）、`packages/ai-provider/src/runtime-compiler.ts`（基于 `cl100k_base` 的权威 `estimateTokens`）、`packages/prompt-runtime/src/budget.ts`（model-specific `countTokens`）、`packages/memory-engine/src/*`（用 `js-tiktoken` 做 Jaccard 余弦，不是单纯计数）。
- **现状：** `prompt-runtime` 已统一从 `@novel-runtime/ai-provider` 导入 `estimateTokens`，但 `shared` 的纯函数版本仍保留（无 tiktoken 环境下的兜底）。`memory-engine` 的 `js-tiktoken` 是另一码事——Jaccard 相似度需要的是真实分词，不是估算。
- **为什么重要：** 不同路径返回的 token 数有 ±5% 偏差，会让 `Budget` 截断位置不稳定，进而影响 prompt 内容的"哪一段被裁"在两次运行间漂移。
- **避雷指引：** 改 prompt 拼装时不要新增"自己估 token" 的分支。共享一份 `estimateTokens`（`@novel-runtime/ai-provider`），Jaccard 用 `js-tiktoken` 是另一个独立用途，不要合并。

### 4. Prisma JSON 字段在路由层手写 `JSON.stringify` / `JSON.parse`
- **位置：** `personality`、`metadata`、`params`、`settings`、`graphSnapshot`、`graphDelta`、`score` 等字段。
- **现状：** schema 把这些列声明为 `String`，路由层手写序列化/反序列化，前端拿到响应后再 `JSON.parse`。
- **为什么重要：** 类型推断不出"这是对象"，调用方经常写错；一旦漏掉一次 stringify，整列会被存成 `[object Object]`，不可恢复。
- **避雷指引：** 修字段读写路径时，对 `String` JSON 字段统一封装（比如 `chapter.graphSnapshot = JSON.stringify(payload)` 的辅助函数），不要复制粘贴。如果要做"真实 JSON 列"迁移（SQLite 实际是 TEXT），是独立任务。

### 5. `ReviewingPanel.vue` 的 `PendingArchiveData` 接口全用 `any[]`
- **位置：** `apps/web/src/views/ReviewingPanel.vue:246, 409`(`baselineChapterGraph` 与 `onGraphUpdate` 两处 `nodes: any[], edges: any[]`)。
- **现状（部分修复）：** `PendingArchiveData` interface + `PendingArchiveDataSchema`(zod)已搬到 `packages/shared/src/archive.ts:132 + 236`(Q6 + commit `e72091b`),前后端共享一份类型;但 `ReviewingPanel.vue` 内部两处 graph 操作仍用 `any[]`,仅靠运行期 `normalizePendingData` 防御。
- **为什么重要：** 用户在审查阶段编辑的是 AI 输出后的人类修正版,结构错位会在 phase 3 事务里直接抛错(最坏情况:commit 时才发现 N 章前的编辑崩了)。
- **避雷指引：** 改 ReviewingPanel 时优先用 `packages/shared/src/archive.ts` 的 `PendingArchiveData` / `PendingGraphSnapshot` 类型;不要新增 `any` 字段。如果改了 `combined-extractor` 的返回结构,必须同步改 `PendingArchiveDataSchema` (zod) + ReviewingPanel.vue 内任何残留 `any[]`。

### 6. `Memory` 历史版本按 `originUid` 取最新是隐含约定
- **位置：** `packages/memory-engine/src/index.ts`、归档阶段的 `memory-optimizer.ts`。
- **现状：** Prompt 组装时取每个 `originUid` 的最新一条；老版本仍留库，未清理。
- **为什么重要：** 看上去是"快照历史"，实际是**实现无清理策略**的副作用。表会随章节数线性增长。
- **避雷指引：** 写新代码读取 `Memory` 时用 `findMany({ where: { storyId }, orderBy: { createdAt: 'desc' } })` 然后在内存按 `originUid` 去重，**不要**用 `groupBy` 假设 Prisma 会自动取最新。清理历史是另一个独立任务。

### 7. 路由前缀不统一
- **位置：** `apps/server/src/routes/*.ts`。
- **现状：** `stories.ts` 用 `prefix: '/api/stories'`，但 `characters.ts` 等模块在内部**硬编码完整路径**（`/api/stories/:storyId/characters`）。
- **为什么重要：** 改路由前缀时容易漏改；Swagger 元数据生成不准确。
- **避雷指引：** 新建路由文件时**优先**用 `prefix` 选项；修改老路由时若想统一前缀，记得同时改 router 内部的所有子路径。

### 8. 前端无 Naive UI tree-shaking 检查
- **位置：** 每个 view 文件的开头 `import { NButton, NInput, ... } from 'naive-ui'`。
- **现状：** 项目 CLAUDE.md 与 AGENTS.md 都强调"按需导入"，但没有 CI 检查。开发体验是好的，构建体积收益无监控。
- **避雷指引：** 改 view 时维持逐项 import；不要因为方便就 `import * as N from 'naive-ui'`。如有 Vite bundle analyzer，可挂上监控。

### 9. `WorkerTask.storyId` 字段已标"兼容保留、后续废弃"
- **位置：** `prisma/schema.prisma:266`。
- **现状：** 字段被注释为"旧字段，兼容保留"，但实际取值路径未审计；替代字段是 `StoryWorkerBinding.storyId + workerType`。
- **避雷指引：** 不要在新代码里写 `workerTask.storyId`，改读 `bindings` 表；扫到时一并清理。

### 10. P1 token-counting 收口保留 3 个 packages 的 `js-tiktoken` 直接装(7→4 终态,有意保留)
- **位置：** `packages/shared/package.json` + `packages/memory-engine/package.json` + `packages/prompt-runtime/package.json`(均保留 `js-tiktoken` 直接装)。
- **现状：** P1 token-counting 收口(commit `bd62a21`)后,`js-tiktoken` 直接装从 7 个 package.json 收到 **4 个**:`packages/ai-provider`(唯一指定保留) + 上述 3 个真用者。spec 路线图(`docs/superpowers/specs/2026-06-18-decoupling-roadmap-design.md` 第 158-188 行)原计划 **7→1 不可达**。用户决策(2026-06-18,见 P1 plan 修正 commit `a9d36db`):接受 **7→4 为 P1 终态**,3 个 packages 保留直接装是**有意为之**,不是"未收口"。
- **为什么重要：** 3 个 packages 有结构性原因无法切到 `countTokens`:
  1. **Dep cycle** — `packages/ai-provider/package.json` 已依赖 `@novel-runtime/shared`(`shared` → `ai-provider` 会构成环)
  2. **API 不匹配** — `shared.tokenize(text): number[]` / `memory-engine` 的 Jaccard 语义搜索需要**真实 token ID 数组**,`countTokens(text): number` 不是等价替换(行为会 silent 退化)
  3. **Model-aware** — `prompt-runtime/budget.ts` 用 `encodingForModel(model)` + 启发式 fallback,不是单纯 `cl100k_base` 单 encoder
- **避雷指引：**
  - 新增 **token 计数**需求 → 统一用 `@novel-runtime/ai-provider` 的 `countTokens`(`packages/ai-provider/src/token-counter.ts`,Task 1 commit `5f0ba92` + 修复合并 `792b533`)
  - 新增 **token ID 数组**需求(Jaccard / 语义搜索 / 重复检测)→ 在 3 个 packages 当前边界内**直接用** `js-tiktoken`,**不要**尝试"再切一次"到 `countTokens`(会破行为)
  - 新增 **model-aware encoding**(per-model encoder 选择)→ 走 `packages/prompt-runtime/src/budget.ts` 的现成 `encodingForModel` + heuristic fallback 路径,不要自己造
  - 看到 `js-tiktoken` 在 3 个 packages 的 import,**不要当成"未收口"删**——这是 P1 收口的**有意保留**边界

---

## 安全

### S1. 完全没有认证 / 鉴权
- **现状：** 所有 `/api/*` 路由公开，无 JWT、无 session、无 API Key 校验。AI Provider 用的 Key 是后台 `AiProviderConfig.apiKey` 字段。
- **为什么重要：** 这是开发态的合理选择，但**部署到非本机环境前必须先加认证层**。如果直接暴露到公网，任意人能调生成、归档、删库。
- **避雷指引：** 不要在没有显式鉴权的情况下加新的"管理类"接口（删除、重置、批量更新）。任何 `DELETE`/`PUT` 路由默认应拒绝外部访问，直到补好认证。

### S5. 遗留 extractor 仍使用 `content.slice(0, 8000)` 粗截断
- **位置：** `apps/server/src/services/memory-extractor.ts:124`（`extractMemoryFromChapter`）、`apps/server/src/services/graph-extractor.ts:71`（`extractGraphFromChapter`）。
- **现状：** 这两个函数 prompt 模板里都有 `${content.slice(0, 8000)}`，与 P0 #2 修复前的 `combined-extractor.ts:148` 完全同模式。`combined-extractor.ts` 的活跃路径（`extractAll`）已用 `truncateByParagraph` 替换（commit `482cca9`），但这两个 legacy 函数仍存在同样截断风险。
- **调用关系：** `extractMemoryFromChapter` 仅被 `combined-extractor.ts:7` import 并在 `:262` re-export，**当前不被任何路由调用**；`extractGraphFromChapter` **完全无人 import**。属于死代码。
- **为什么重要：** P0 #2 修复只覆盖了 `extractAll`（combined path）。如果未来有人重新启用 standalone extractors（比如想做"只刷新 graph 不重跑 memory"的功能），数据丢失的 bug 会原样复现——因为问题不在调用方，而在 prompt 模板的截断方式。
- **避雷指引：** 启用任何 standalone extractor 前先在文件内替换 `${content.slice(0, 8000)}` 为 `${truncateByParagraph(content, 8000)}` 并补 import；或者直接删除 dead code（如果项目已决定不再走 standalone 路径）。

### S2. CORS 配置为 `origin: true`
- **位置：** `apps/server/src/app.ts`。
- **现状：** Fastify CORS 允许任何来源。
- **避雷指引：** 部署到生产时把 `origin` 改为白名单；本机开发时不要去掉这个限制。

### S3. `.env` 包含真实的 `DEEPSEEK_API_KEY`
- **位置：** 项目根目录 `.env`。
- **现状：** 该文件已加入 `.gitignore`，但**若曾被错误提交**会污染 git 历史。`DEEPSEEK_API_KEY` 还会被 `ai-provider-init.ts` 启动时写进数据库 `AiProviderConfig.apiKey`。
- **避雷指引：**
  - 修改路由或服务时不要把 `process.env.*` 的值 `console.log` 出来。
  - 不要在 `PromptLog.responseContent` 里回显整段 AI 响应（如果有敏感 prompt）。
  - 若怀疑 Key 泄漏，去 DeepSeek 控制台重置。
  - `prisma db:studio` 是本地访问，但生产环境的 `AiProviderConfig.apiKey` 列**绝对不要**做 `findMany({ select: { apiKey: true }})` 的 API。

### S4. 后端默认 `HOST=0.0.0.0`
- **位置：** `.env` 默认值。
- **现状：** 后端 `server.ts` 监听所有网卡，**局域网内任何设备都能访问 3000 端口**。
- **避雷指引：** 在共享网络/咖啡店工作时，临时把 `.env` 改成 `HOST=127.0.0.1`，或者加防火墙规则。

---

*新增/修正条目时，遵循 1-2 行说明 + 1 行"为什么重要" + 1 行"避雷指引"的格式，便于扫读。*
