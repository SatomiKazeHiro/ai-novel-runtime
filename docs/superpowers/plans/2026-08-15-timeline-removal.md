# 时间线（Timeline）移除 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 彻底移除 Timeline 时间线（表、路由、前端页、prompt 层、编码函数、种子、脚本、文档），因为时间判断不可靠且与记忆/剧情弧线职能重叠。

**Architecture:** 按依赖顺序摘除——先生成侧注入 → 再 prompt 层/预算/workerType → 后端路由/引用 → 前端 → 共享包文件/字段 → schema + migration → 种子/脚本/测试/文档。

**Tech Stack:** TypeScript、Prisma（SQLite）、Fastify、Vitest、Vue 3

**注意：** `TimelineEvent` 表已经不写入（archive confirm 早停写），但生成时还读它注入 prompt。纯删除，无数据迁移（表直接 drop）。

---

## 文件结构（要动的）

- 修改 `apps/server/src/routes/chapters-generate.ts` — 删 timeline 查询/注入
- 修改 `packages/prompt-runtime/src/index.ts` / `budget.ts` — 删 timeline 层/预算
- 修改 `packages/shared/src/index.ts` — 删 budget.timeline + export
- 修改 `packages/ai-provider/src/runtime-compiler.ts` — 删 workerType 'timeline'
- 修改 `packages/shared/src/schemas/worker-task.ts` — 删 WORKER_TYPES 'timeline'
- 删除 `apps/server/src/routes/timeline.ts`、修改 `app.ts`、`chapters-crud.ts`、`stories.ts`
- 删除 `apps/web/src/views/Timeline.vue`、`api/timeline.ts`；修改 `router/index.ts`、`NovelDesignLayout.vue`、`ReviewingPanel.vue`
- 删除 `packages/shared/src/timeline.ts`、`timeline-encoding.ts`；修改 `archive.ts`、`extract-prompt.ts`
- 修改 `prisma/schema.prisma`（删 TimelineEvent）+ migration
- 删除 `seeds/worker-tasks/timeline.yaml`、`scripts/check-timeline-dup.py`、`check-timeline-dup.mjs`
- 删除测试 `timeline.test.ts`、`timeline-schema.test.ts`、`timeline-encoding.test.ts`；更新 mock/fixture
- 文档：CLAUDE.md / AGENTS.md / README.md / docs/LOGIC.md / docs/sql-reference.md

---

## Task 1: 生成侧摘掉 timeline 注入

**Files:**
- Modify: `apps/server/src/routes/chapters-generate.ts`

### Step 1: 删 import

删 `import { ... formatTimelinePosition ... }` 里的 `formatTimelinePosition`（约 15 行，从 `@novel-runtime/shared` import 的列表里去掉）。

### Step 2: 删 timeline 查询 + 注入（preview + generate 两处）

- 删 `const timelineEvents = await prisma.timelineEvent.findMany(...)`（约 86、182 行）。
- 删 `pipeline.run({ ... })` 里的 `timeline: timelineEvents.map(...)` 行（约 121、231 行）。

### Step 3: 验证

Run: `pnpm --filter server typecheck`

Expected: 通过（timeline 从 prompt 层摘掉，但 prompt-runtime 的 timeline 层还在，暂不影响）。

### Step 4: Commit

```bash
git add apps/server/src/routes/chapters-generate.ts
git commit -m "refactor(timeline): remove timeline injection from generate"
```

---

## Task 2: prompt 层 + 预算 + workerType 删 timeline

**Files:**
- Modify: `packages/prompt-runtime/src/index.ts`
- Modify: `packages/prompt-runtime/src/budget.ts`
- Modify: `packages/shared/src/index.ts`
- Modify: `packages/ai-provider/src/runtime-compiler.ts`
- Modify: `packages/shared/src/schemas/worker-task.ts`

### Step 1: prompt-runtime 删 timeline 层

`prompt-runtime/src/index.ts`：
- `PromptLayers` 接口删 `timeline?: string`。
- `BudgetConfig` 删 `timeline: number`。
- LayerDef 数组删 `{ key: 'timeline', label: 'Timeline', budget: this.budget.timeline }`。

`prompt-runtime/src/budget.ts`：
- 删 `'Timeline': this.budget.timeline`（2 处）。

### Step 2: shared index 删 budget.timeline + export

`shared/src/index.ts`：
- 删 `DEFAULT_PIPELINE_BUDGET` 里的 `timeline: 4000`。
- 删类型里的 `timeline: number`。
- 删 `scaleBudget` 里的 `timeline: Math.floor(...)`。
- 删 `export * from './timeline.js'`、`export * from './timeline-encoding.js'`。

### Step 3: ai-provider + worker-task 删 'timeline'

- `ai-provider/src/runtime-compiler.ts`：`WorkerTask.workerType` 联合类型删 `'timeline'`。
- `shared/src/schemas/worker-task.ts`：`WORKER_TYPES` 数组删 `'timeline'`。

### Step 4: 重建包 + 验证

Run: `pnpm -r --filter "./packages/*" build`

Run: `pnpm --filter server typecheck`

Expected: 通过（若报错，逐个修残留引用）。

### Step 5: Commit

```bash
git add packages/prompt-runtime packages/shared/src/index.ts packages/ai-provider/src/runtime-compiler.ts packages/shared/src/schemas/worker-task.ts
git commit -m "refactor(timeline): remove timeline from prompt pipeline + workerType"
```

---

## Task 3: 后端删 timeline 路由 + 引用

**Files:**
- Delete: `apps/server/src/routes/timeline.ts`
- Modify: `apps/server/src/app.ts`
- Modify: `apps/server/src/routes/chapters-crud.ts`
- Modify: `apps/server/src/routes/stories.ts`

### Step 1: 删路由文件 + 注册

- 删 `apps/server/src/routes/timeline.ts`。
- `app.ts` 删 `import { timelineRoutes }` + `await app.register(timelineRoutes)`。

### Step 2: 删引用

- `chapters-crud.ts` 删删除章节时的 `const { count: teCount } = await prisma.timelineEvent.deleteMany(...)`（约 186 行），并更新 log 里 `timeline=${teCount}`。
- `stories.ts` 删故事详情的 `timelineEvents: { orderBy: { position: 'asc' } }` include（约 90 行）。

### Step 3: 验证

Run: `pnpm --filter server typecheck`

Expected: 通过。

### Step 4: Commit

```bash
git add apps/server/src/routes/timeline.ts apps/server/src/app.ts apps/server/src/routes/chapters-crud.ts apps/server/src/routes/stories.ts
git commit -m "refactor(timeline): remove timeline route + references"
```

---

## Task 4: 前端删 timeline

**Files:**
- Delete: `apps/web/src/views/Timeline.vue`
- Delete: `apps/web/src/api/timeline.ts`
- Modify: `apps/web/src/router/index.ts`
- Modify: `apps/web/src/views/NovelDesignLayout.vue`
- Modify: `apps/web/src/views/ReviewingPanel.vue`

### Step 1: 删页面 + API + 路由 + 导航

- 删 `views/Timeline.vue`、`api/timeline.ts`。
- `router/index.ts` 删 `import Timeline` + `{ path: 'timeline', ... }` 路由 + 重定向。
- `NovelDesignLayout.vue` 删 `TimerOutline` import、`{ label: '时间线', key: 'Timeline', ... }` 菜单项、`Timeline: ...` map 项。

### Step 2: ReviewingPanel 删时间线 tab

删 `ReviewingPanel.vue` 里 `<n-tab-pane name="timeline">...</n-tab-pane>` 整块。

### Step 3: 验证

Run: `pnpm --filter web typecheck`

Expected: 通过（删残留引用）。

### Step 4: Commit

```bash
git add apps/web/src/views/Timeline.vue apps/web/src/api/timeline.ts apps/web/src/router/index.ts apps/web/src/views/NovelDesignLayout.vue apps/web/src/views/ReviewingPanel.vue
git commit -m "refactor(timeline): remove timeline page + nav"
```

---

## Task 5: 共享包删 timeline 文件 + archive/extract-prompt 字段

**Files:**
- Delete: `packages/shared/src/timeline.ts`
- Delete: `packages/shared/src/timeline-encoding.ts`
- Modify: `packages/shared/src/archive.ts`
- Modify: `packages/shared/src/extract-prompt.ts`

### Step 1: 删文件

删 `timeline.ts`、`timeline-encoding.ts`。

### Step 2: archive.ts 删字段

删 `PendingTimelineEventWrite` 接口、`PendingArchiveData` 里的 `timelineEvents`/`timelinePosition` 字段、zod schema 里的对应字段。

### Step 3: extract-prompt.ts 删 full/slim 的 timeline 字段

删 full mode / slim mode 的 prompt 输出格式里 `timelinePosition`/`timelineEvents` 字段（memory-only 已删，full/slim 残留）。

### Step 4: 重建 + 验证

Run: `pnpm -r --filter "./packages/*" build && pnpm --filter server typecheck`

Expected: 通过。

### Step 5: Commit

```bash
git add packages/shared/src/timeline.ts packages/shared/src/timeline-encoding.ts packages/shared/src/archive.ts packages/shared/src/extract-prompt.ts
git commit -m "refactor(timeline): remove shared timeline files + fields"
```

---

## Task 6: schema 删 TimelineEvent + migration

**Files:**
- Modify: `prisma/schema.prisma`

### Step 1: 删模型

删 `model TimelineEvent { ... }`（约 179-194 行，标了 @deprecated）。

### Step 2: 生成 migration

Run: `pnpm exec prisma migrate diff --from-schema-datasource prisma/schema.prisma --to-schema-datamodel prisma/schema.prisma --script`

把输出（`DROP TABLE "TimelineEvent"`）写成 migration 文件，然后 `pnpm exec prisma migrate deploy && pnpm db:generate`。

### Step 3: 验证

Run: `pnpm --filter server typecheck && pnpm --filter server exec vitest run`

Expected: 通过。

### Step 4: Commit

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "refactor(timeline): drop TimelineEvent table"
```

---

## Task 7: 种子 + 脚本 + 测试 + 文档

**Files:**
- Delete: `seeds/worker-tasks/timeline.yaml`
- Delete: `scripts/check-timeline-dup.py`、`check-timeline-dup.mjs`
- Delete: `apps/server/src/__tests__/routes/timeline.test.ts`、`packages/shared/src/__tests__/timeline-schema.test.ts`、`packages/shared/src/__tests__/timeline-encoding.test.ts`
- Modify: `apps/server/src/__tests__/setup.ts`（删 timelineEvent mock）、各 route 测试的 timelineEvent mock、`stages-memory.test.ts`、`chapters-zod-validation.test.ts`
- Modify: 文档 CLAUDE.md / AGENTS.md / README.md / docs/LOGIC.md / docs/sql-reference.md

### Step 1: 删种子 + 脚本

删 `seeds/worker-tasks/timeline.yaml`、`scripts/check-timeline-dup.py`、`check-timeline-dup.mjs`。

### Step 2: 删测试 + 更新 mock/fixture

- 删 3 个 timeline 测试文件。
- `setup.ts` 删 `timelineEvent: { findMany: vi.fn() }`。
- 各 route 测试删 `timelineEvent` mock。
- `stages-memory.test.ts` 删 timelineEvents 相关断言。
- `chapters-zod-validation.test.ts` 删 timelineEvents fixture。

### Step 3: 更新文档

CLAUDE.md 删 Timeline Position Encoding 段（`TimelineEvent.position` 描述 + 删除标记）；AGENTS.md / README.md / docs 同步。

### Step 4: 全量验证

Run: `pnpm --filter server test && pnpm typecheck`

Expected: 全过。

### Step 5: Commit

```bash
git add -A
git commit -m "refactor(timeline): remove seeds, scripts, tests, docs"
```

---

## 完成验证

所有 Task 完成后：

1. `pnpm --filter server test` 全量通过。
2. `pnpm typecheck` 全仓通过。
3. `git grep -i timeline` 确认无残留（除历史文档/迁移）。
