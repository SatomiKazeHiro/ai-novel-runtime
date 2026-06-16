# P0 修复与决策落地 — 设计

> 修复 `docs/ISSUES.md` 7 条 P0 + 落地用户对 `docs/QUESTIONS.md` 10 条决策。
> 修复完成后才进入解耦阶段（CLAUDE.md 协作约定）。

## 背景

| 文档 | 作用 |
|------|------|
| `docs/ISSUES.md` | 7 条 P0（2 数据丢失 / 3 崩溃 / 2 安全），含根因与 blast radius |
| `docs/QUESTIONS.md` | 10 条 AI 编写时可能漂移的设计意图点 |
| `docs/ISSUES.md` 末"用户决策记录"段 | 用户对 Q#1-Q#10 的回复 + 后续方向 |
| `docs/LOGIC.md` | 15 分钟可读的架构地图（前置阅读） |
| `KNOWN-ISSUES.md` | 已知非 P0 问题（不在本 spec 范围） |

## 设计决策（已与用户确认）

| # | 决策 | 理由 |
|---|------|------|
| D1 | **范围**：P0 + Q#1-Q#10 全部落地 | 用户选"决策全部落地" |
| D2 | **测试**：全链路单测覆盖 | 用户选"全链路单测覆盖"；需先在 `apps/server` 补 vitest 脚手架 |
| D3 | **Q#10 并发保护**：状态机独占锁（不加 version 字段） | 用户选"状态机独占锁"；`update: { where: { id, status: 'draft' }, data: { status: 'generating' } }` 受影响行数 0 → 409 |
| D4 | **commit 组织**：5 阶段串行 commit | 用户选方案 A；与 ISSUES.md 修复顺序建议一致 |
| D5 | **不引入新依赖**：zod 仅 `pnpm add zod`（如未安装）；prompt-runtime 的 `truncate` 已存在 | 最小依赖原则 |
| D6 | **不重构架构**：保持现有路由/服务分层；解耦阶段再做 | 与 CLAUDE.md "修复后解耦"节奏一致 |
| D7 | **Q#2 importance 范围无代码改动**：决策"prompt 4-7（偏保守）+ UI 1-10 + 用户可手动调"是接受现状，不动代码 | 用户原意"打分按用户的来，AI 只是返回近似分" |
| D8 | **Q#5 JSON.parse 统一范围**：本 spec 只修 ① `routes/graph.ts:18`（无 try/catch）② `useChapterEditor.ts:150`（HTTP 响应二次 parse）。其他路径（`useChapterEditor.ts:74-81` DB 字段、archive 路由 line 646 `safeJsonParse`）已是正确模式，保留。| 用户决策"统一就统一"，但仅限 bug 修复范围 |

## 5 阶段 commit 分解

### 阶段 1：安全 P0（2 commit）

#### 1.1 `fix(security): strip apiKey from AI provider list`

**根因**：`ai-provider.ts:6-11` 和 `:14-22` 用 `findMany`/`findFirst` 无 `select`，返回所有列含明文 `apiKey`。结合项目无认证（KNOWN-ISSUES S1），任何 GET 调用都泄漏。

**改动**：
- `apps/server/src/routes/ai-provider.ts:6-11` `findMany` 加 `select`
- `apps/server/src/routes/ai-provider.ts:14-22` `findFirst` 加 `select`
- select 字段：`id, name, model, baseUrl, isDefault, remarks, type, maxTokens, temperature, contextLength, createdAt, updatedAt`（**不含 `apiKey`**）

**风险**：
- 前端调用方依赖 `apiKey` 字段做展示？→ 检查 `apps/web/src/views/AIProviders.vue`、其他用到 `aiProviderApi.list()` 的地方。预期：只展示 name/model/isDefault，不读 apiKey。
- `POST /api/ai-providers/test` 已显式 `select: { apiKey: true }`（line 123-126），保留。

**测试**：
- `apps/server/src/__tests__/routes/ai-provider.test.ts`：调 GET 列表，断言响应 data 数组元素**没有 `apiKey` 字段**。

#### 1.2 `fix(security): select route requires draft.chapterId`

**根因**：`chapters.ts:524-527` `findUnique({ where: { id: body.draftId } })` 不校验 draft 是否属于当前 chapterId。任何 chapter 的 select 调用能选任何 draft。

**改动**：
- `chapters.ts:524-527`：`findUnique` 改 `where: { id: body.draftId, chapterId }`（Prisma 复合查询）
- 若返回 null → 返回 404 `{ success: false, error: 'Draft not found' }`（**不暴露** draft 是否存在）
- 移除 `include: { chapter: true }`（不再需要）

**风险**：
- 前端 selectDraft 调用是否在当前 chapter 上下文？→ 检查 `useChapterEditor.ts` 和 `Chapters.vue` 确认调用方传的是同一 chapterId。预期：是。

**测试**：
- `select.test.ts`：① 正常 select 同 chapter 的 draft → 200；② cross-chapter select → 404；③ draftId 不存在 → 404。

### 阶段 2：崩溃 P0（2 commit）

#### 2.1 `fix(crash): unify JSON.parse via safeJsonParse`

**根因**：项目内 `JSON.parse` 调用分散在 3 个模式：
- HTTP 响应路径：`useChapterEditor.ts:150` `JSON.parse(res.data.data)` —— **错误**（res.data.data 已经是对象）
- DB 字段路径：`useChapterEditor.ts:74-81` `JSON.parse(row.pendingArchiveData)` —— 正确（DB 是 String? 列）
- 后端 DB 字段：`routes/graph.ts:18` `JSON.parse(lastArchived.graphSnapshot)` —— **错误**（无 try/catch）

**改动**：
- `apps/web/src/composables/useChapterEditor.ts:150`：移除 `JSON.parse(res.data.data)`，改为直接 `pendingArchiveData.value = res.data.data`
- `apps/server/src/routes/graph.ts:18`：`JSON.parse(lastArchived.graphSnapshot)` → `safeJsonParse(lastArchived.graphSnapshot, null)`，加 null fallback 返回 `{ nodes: [], edges: [] }`（与 line 16 的空 snapshot 行为一致）
- `useChapterEditor.ts:74-81` 保持原样（DB String? 列存 JSON 文本，需 parse）

**风险**：
- 是否有其他前端代码有同样 bug？→ grep `JSON.parse(res.data` 排查。
- 后端其他路由是否也有无保护的 `JSON.parse`？→ 已记录在 LOGIC.md 第 5 节，本 spec 修复 graph.ts:18 一处，其他由解耦阶段处理。

**测试**：
- `graph.test.ts`：手动 UPDATE 损坏 `graphSnapshot` 字段，断言 GET 不抛错、返回空 graph。

#### 2.2 `fix(crash): wrap prepare-archive in try/catch`

**根因**：`chapters.ts:585-593` `prepareArchiveData` 直接 throw，冒泡到 Fastify 全局 500。`chapter.status` 已是 `reviewing`（line 605 在抛错前已设置——实际是 line 602-608 在抛错后不执行），前端 UI 断片。

**改动**：
- `chapters.ts:585`：包裹 try/catch
- catch 内：
  - `app.log.error` 记录 `prepareArchiveData` 失败原因
  - `prisma.chapter.update({ where: { id: chapterId }, data: { status: 'selected' } })` —— **回滚 status**
  - return reply.status(500).send({ success: false, error: '准备归档失败：AI 提取出错（xxx），请检查 AI 配置后重试' })
- 前端 `useChapterEditor.ts:158` catch 内显示后端具体错误（已有 line 158 `e.response?.data?.error`），无需改

**测试**：
- `prepare-archive.test.ts`：mock `prepareArchiveData` 抛错，断言：① 返回 500；② chapter.status 回滚到 `selected`；③ 前端能 retry。

### 阶段 3：数据丢失 P0（2 commit）

#### 3.1 `fix(data-loss): drop user-edited tag from buildData`

**根因**：`ReviewingPanel.vue:454-465` `buildData` 给所有 memory 加 `user-edited` tag。原 Agent 误解用户"归档后沉寂"原意。`memory-optimizer.ts:60-64` 据此跳过整章 AI 融合，全局记忆优化失效。

**改动**：
- `apps/web/src/views/ReviewingPanel.vue:454-465`：删除 `for (const mem of ...) { if (!tags.includes('user-edited')) tags.push('user-edited') }` 循环
- `apps/server/src/services/memory-optimizer.ts:60-64`：保留 `userEditedMemories` 分支代码（**不删**），留作未来"精准标记"扩展的接入点

**风险**：
- 若未来真要做"精准标记"，需要 baseline 对比（line 224 `baselineChapterGraph` 只覆盖 graph 不覆盖 memory）。本次不动。
- `memory-optimizer` 之前可能已写入 `user-edited` tag 到 DB（如果有 archived 章节已经走过流程）。本次只移除 buildData 的注入，不清理存量数据。理由：tag 在 memory-optimizer 内只决定"是否参与融合"，不影响显示。

**测试**：
- `buildData.test.ts`：mock 一组 memories + 一次"保存调整"调用，断言 buildData 输出**不含 `user-edited` tag**。
- `memory-optimizer.test.ts`：输入一组 memories，断言 `userEditedMemories` 分支**不会因 memory 无 user-edited tag 而被命中**。

#### 3.2 `fix(data-loss): use prompt-runtime truncate for content > 8000`

**根因**：`combined-extractor.ts:148` `content.slice(0, 8000)` 粗截断，后半部分不被 AI 看到。

**改动**：
- `apps/server/src/services/combined-extractor.ts:148`：用 `packages/prompt-runtime` 的 `truncate` 或新增 `truncateByParagraph` 按段落裁剪
- 设计：
  - 默认按段落截断（`\n\n` 分段），从前往后累加段落直到接近 budget
  - 最后一段若超 budget，按字符硬截断
  - budget 来源：`budget.userMessage`（prompt 预算层）
- 现有 `slice(0, 8000)` 保留为 fallback（极端情况 budget 未配置时）

**风险**：
- `packages/prompt-runtime` 是否真有 `truncate`？→ 验证。如无，新增 `truncateByParagraph(text, budget)` 到 `packages/prompt-runtime/src/`。
- 段落截断可能切到对话中间 → 用户可读 prompt log 检查（无 UI 变化）。

**测试**：
- `combined-extractor.test.ts`：输入 10000 字章节，断言：① 提交给 AI 的内容包含后段关键句；② 段落边界对齐（不在句子中间断）。

### 阶段 4：架构一致性（4 commit）

#### 4.1 `refactor(shared): align ChapterStatus enum + share PendingArchiveData`

**Q#1 + Q#6 落地**

**改动**：
- `packages/shared/src/index.ts:3-10`：
  ```typescript
  export const ChapterStatus = {
    DRAFT: 'draft',
    GENERATING: 'generating',
    GENERATED: 'generated',
    SCORED: 'scored',
    SELECTED: 'selected',
    REVIEWING: 'reviewing',
    ARCHIVED: 'archived',
    REJECTED: 'rejected'
  } as const
  ```
- 新建 `packages/shared/src/archive.ts`：
  - 导出 `PendingArchiveData` interface（从 `combined-extractor.ts:18-29` 搬过来）
  - 导出 `GraphSnapshot` interface（如有）
- `apps/server/src/services/combined-extractor.ts:18-29`：删除本地 interface，import shared
- `apps/web/src/views/ReviewingPanel.vue:167-183`：删除本地 interface，import shared
- `apps/web/src/views/Chapters.vue:1057`：`statusTagType` 补 `scored` + `rejected` 颜色映射

**测试**：
- `packages/shared/src/__tests__/index.test.ts`：断言 `ChapterStatus` 8 个值齐全、与 prisma enum 一致。

#### 4.2 `chore: drop dead-code assertStatusTransition`

**Q#3 落地**

**改动**：
- `apps/server/src/routes/chapters.ts:18-37`：删除 `VALID_STATUS_TRANSITIONS` const + `assertStatusTransition` helper（死代码）
- `chapters.ts:388, 517, 551, 630` 的硬编码 `chapter.status === 'xxx'` 暂不动（保持现有分散判断风格，避免 scope creep 到解耦阶段）

**测试**：无（纯删除）

#### 4.3 `refactor(zod): validate generate.compiledPrompt`

**Q#9 落地**

**改动**：
- 新建 `packages/shared/src/chapter-prompt.ts`：
  ```typescript
  import { z } from 'zod'
  export const CompiledPromptSchema = z.object({
    systemMessage: z.string().min(1),
    userMessage: z.string().min(1),
    meta: z.object({
      systemTokens: z.number().nonnegative(),
      userTokens: z.number().nonnegative(),
      totalTokens: z.number().nonnegative()
    }).optional()
  })
  ```
- `apps/server/src/routes/chapters.ts:432`：`if (customCompiled && customCompiled.systemMessage && customCompiled.userMessage)` → `if (customCompiled) { const parsed = CompiledPromptSchema.safeParse(customCompiled); if (parsed.success) compiled = parsed.data; else return reply.status(400).send({ success: false, error: 'compiledPrompt 格式错误', details: parsed.error.flatten() }) }`
- `apps/server/package.json`：检查 `zod` 是否已安装；如无 `pnpm add zod`
- `apps/web/src/api/chapters.ts:29`：`generate: (chapterId, data: any)` → `generate: (chapterId, data: CompiledPromptInput)`（类型来自 shared re-export）

**风险**：
- `body.compiledPrompt` 可能为 `undefined`（前端不传，走默认 pipeline）→ 检查 `if (customCompiled)` 守门
- zod 版本兼容性 → 看 `package.json`

**测试**：
- `generate.test.ts`：① 合法 compiledPrompt → 200；② 缺字段 → 400 + 字段错误；③ 类型错误 → 400。

#### 4.4 `refactor(locks): status-exclusive-lock for generate`

**Q#10 落地**

**改动**：
- `apps/server/src/routes/chapters.ts:382-393`：
  - 移除 line 396-400 的 `if (chapter.status === 'generated') { ... status: 'draft' }` 二次重置逻辑（与独占锁冲突，单独处理）
  - 替换为独占锁：
    ```typescript
    // 状态机独占锁：原子性 update 影响行数判定
    const lockResult = await prisma.chapter.updateMany({
      where: { id: chapterId, status: 'draft' },
      data: { status: 'generating' }
    })
    if (lockResult.count === 0) {
      return reply.status(409).send({
        success: false,
        error: '章节正在生成中或状态不允许，请刷新后重试'
      })
    }
    ```
  - 后续 line 466-501 的 draft 创建、`generateQueue.add` 保持不变
- 前端 `apps/web/src/composables/useChapterEditor.ts`：`generate` 调用 catch 409 时显示"正在生成中，请等待"

**风险**：
- `generated` 状态重新生成的语义变化：之前是先 reset 到 `draft` 再排队。现在改成"已生成过的不允许再 generate"？或者单独设计 `regenerate` 路由？
- **决策**：本次修复只解决双击并发，**不**改变 `generated` 状态的语义。`generated` 状态重新生成的逻辑保留为单独路由或显式 reset 调用（用户后续如需要可加 Q#10.1）。

**测试**：
- `generate-concurrency.test.ts`：mock 慢任务，并发两次 generate 调用，断言第二次返回 409。

### 阶段 5：测试脚手架 + 验证（2 commit）

#### 5.1 `chore(test): scaffold vitest for apps/server`

**改动**：
- `apps/server/vitest.config.ts`：基本配置（NodeNext、路径别名、`@/` → `./src/`）
- `apps/server/src/__tests__/setup.ts`：mock Prisma client 的 helper（避免真实 DB 依赖）
- `apps/server/package.json`：
  - 添加 `"test": "vitest run"`、`"test:watch": "vitest"`
  - 确认 vitest 已安装（CLAUDE.md 说已就绪）
- 测试文件：每个 `*.test.ts` 文件 stub 占位（实际测试在 1.1-4.4 已写）

#### 5.2 `chore: verify lint + typecheck + test`

不写新代码，只跑：
```bash
pnpm typecheck
pnpm lint
pnpm test
```

如有报错，本 commit 修复。

## 文件改动总览

| 文件 | 阶段 | 改动 |
|------|------|------|
| `apps/server/src/routes/ai-provider.ts` | 1.1 | list/default 加 select 排除 apiKey |
| `apps/server/src/routes/chapters.ts` | 1.2, 2.2, 4.2, 4.3, 4.4 | select 加 chapterId / prepare try/catch / 删死代码 / zod / 状态机锁 |
| `apps/server/src/routes/graph.ts` | 2.1 | `safeJsonParse` |
| `apps/server/src/services/combined-extractor.ts` | 3.2, 4.1 | truncate 替代 slice / import shared PendingArchiveData |
| `apps/server/src/services/memory-optimizer.ts` | 3.1 | 不改（保留分支） |
| `apps/server/vitest.config.ts` | 5.1 | 新建 |
| `apps/server/src/__tests__/` | 1.1-4.4, 5.1 | 新建测试目录 |
| `apps/server/package.json` | 4.3, 5.1 | zod dependency + test scripts |
| `apps/web/src/composables/useChapterEditor.ts` | 2.1, 4.4 | 移除冗余 parse / 409 处理 |
| `apps/web/src/views/ReviewingPanel.vue` | 3.1, 4.1 | 移除 user-edited tag / import shared interface |
| `apps/web/src/views/Chapters.vue` | 4.1 | `statusTagType` 补 scored + rejected |
| `apps/web/src/api/chapters.ts` | 4.3 | generate 入参类型化 |
| `packages/shared/src/index.ts` | 4.1 | ChapterStatus 补 generating + reviewing |
| `packages/shared/src/archive.ts` | 4.1 | 新建 PendingArchiveData |
| `packages/shared/src/chapter-prompt.ts` | 4.3 | 新建 zod schema |

## 验收标准

每阶段完成后：

1. **代码**：通过 `pnpm typecheck`（零错误）
2. **lint**：通过 `pnpm lint`（零警告）
3. **测试**：通过 `pnpm test`（新增单测全绿）
4. **commit**：5 个 commit 顺序，每阶段 commit message 描述清楚修复点
5. **文档**：`docs/ISSUES.md` 修复进度标记（可选）

**最终验收**（阶段 5）：
- `pnpm typecheck` ✓
- `pnpm lint` ✓
- `pnpm test` ✓
- `pnpm --filter server dev` 启动后：
  - GET `/api/ai-providers` 响应无 `apiKey` 字段（curl 验证）
  - 模拟 graphSnapshot 损坏 → GET `/api/stories/:id/graph` 返回空 graph 而非 500
  - 双击"生成候选"按钮 → 第二次返回 409
  - 走过 review 的章节，global 记忆包含 review 后的内容（手动走流程验证）

## 不在范围（避免 scope creep）

| 议题 | 原因 | 后续 |
|------|------|------|
| token-counting 三套实现合并 | 解耦阶段 | `docs/LOGIC.md` 第 5 节 |
| `chapters.ts` 状态机分散判断 → helper 集中 | 解耦阶段 | Q#3 仅删死代码，不重构 |
| `routes/chapters.ts` 路由文件过大（809 行）拆分 | 解耦阶段 | 拆 services + 拆 route files |
| ReviewingPanel.vue 的 `any[]` 收紧 | 解耦阶段 | KNOWN-ISSUES K6 |
| 鉴权、CORS、`.env` 密钥管理 | 部署阶段 | KNOWN-ISSUES S1-S4 |
| 单元测试覆盖率阈值配置 | 解耦阶段 | 5.1 只搭脚手架，不设阈值 |

## 风险与缓解

| 风险 | 影响 | 缓解 |
|------|------|------|
| 5 commit 串行执行中某阶段失败 | 阻塞后续 | 每阶段独立可回滚；失败即停不掩盖 |
| Q#10 状态机锁与 generated 重新生成冲突 | UX 退化 | 本 spec 仅修双击并发，重新生成语义留 Q#10.1 |
| `truncate` 在 `packages/prompt-runtime` 不存在 | 3.2 阻塞 | 提前 grep 验证；缺失则新增 `truncateByParagraph` |
| zod 未安装 | 4.3 阻塞 | 提前 `cat package.json` 验证 |
| vitest 配置与 NodeNext 兼容 | 5.1 阻塞 | 提前看现有 vitest 引用；如有问题用 `vitest.config.ts` 调整 |
| 测试中 mock Prisma 不准确 | 测试通过但运行时挂 | 用真实 SQLite in-memory + 每个测试 setup/teardown |

## 参考

- `docs/ISSUES.md` P0 列表 + 用户决策记录
- `docs/QUESTIONS.md` 10 条决策原文
- `docs/LOGIC.md` 架构地图
- `KNOWN-ISSUES.md` 已知问题（不在本 spec 范围）
- `CLAUDE.md` 协作约定（TDD、verification-before-completion）
