# 评分（Scoring）移除 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 彻底移除评分子系统（Score 表、scores 路由、scoring-engine 包、前端评分 UI、workerType scoring、文档），因为很少使用且 AI 评分不严谨（同稿多评分数漂移）。

**Architecture:** 删引用（后端/前端/packages）→ 删 schema + migration → 清文档。

**Tech Stack:** TypeScript、Prisma（SQLite）、Fastify、Vitest、Vue 3

**注意：** `scoreQueue` 实际已不存在（queue/index.ts 只有 generateQueue），CLAUDE.md 里「scoreQueue placeholder」是过时描述，一并清掉。

---

## 文件结构

- 删除 `apps/server/src/routes/scores.ts`；修改 `app.ts`、`setting.ts`
- 修改 `apps/web/src/api/chapters.ts`、`views/chapters/DraftList.vue`、`composables/useDraftManager.ts`、`components/graph/ChapterReel.vue`、`views/WorkerTask.vue`、`views/StoryWorkerTask.vue`、`styles/prompt-log-types.ts` + spec
- 删除 `packages/scoring-engine`（整个包）；修改 `shared/worker-task.ts`、`ai-provider/runtime-compiler.ts` + 测试
- 修改 `prisma/schema.prisma`（删 Score 模型 + Draft.score + relation）+ migration
- 文档：CLAUDE.md / AGENTS.md / README.md / docs

---

## Task 1: 后端删 scores 路由 + 引用

**Files:**
- Delete: `apps/server/src/routes/scores.ts`
- Modify: `apps/server/src/app.ts`
- Modify: `apps/server/src/setting.ts`

### Step 1: 删路由文件 + 注册

- 删 `routes/scores.ts`。
- `app.ts` 删 `import { scoreRoutes }` + `await app.register(scoreRoutes)`。

### Step 2: setting.ts 删 scoring

`setting.ts` 的 `HARDCODED_TASK_DEFAULTS` 删 `scoring: '...'` 条目。

### Step 3: 验证 + Commit

Run: `pnpm --filter server typecheck`

Expected: 通过（若 scoring-engine 引用报错，属预期，Task 3 删包）。

```bash
git add apps/server/src/routes/scores.ts apps/server/src/app.ts apps/server/src/setting.ts
git commit -m "refactor(scoring): remove scores route + references"
```

---

## Task 2: 前端删评分

**Files:**
- Modify: `apps/web/src/api/chapters.ts`
- Modify: `apps/web/src/views/chapters/DraftList.vue`
- Modify: `apps/web/src/composables/useDraftManager.ts`
- Modify: `apps/web/src/components/graph/ChapterReel.vue`
- Modify: `apps/web/src/views/WorkerTask.vue`
- Modify: `apps/web/src/views/StoryWorkerTask.vue`
- Modify: `apps/web/src/styles/prompt-log-types.ts` + `__tests__/prompt-log-types.spec.ts`

### Step 1: 删评分 API + UI + 逻辑

- `api/chapters.ts` 删 `draftsApi.score`。
- `DraftList.vue` 删评分按钮 + 分数展示。
- `useDraftManager.ts` 删评分调用逻辑。
- `ChapterReel.vue` 删分数展示。

### Step 2: 删 workerType 'scoring' + callType 'score'

- `WorkerTask.vue` / `StoryWorkerTask.vue` 删 `scoring` 选项。
- `prompt-log-types.ts` 删 `{ id: 'score', ... }` + spec 删 'score' 期望值。

### Step 3: 验证 + Commit

Run: `pnpm --filter web typecheck`

Expected: 通过。

```bash
git add apps/web/src
git commit -m "refactor(scoring): remove scoring UI + logic + workerType option"
```

---

## Task 3: packages 删 scoring-engine + workerType

**Files:**
- Delete: `packages/scoring-engine`（整个包）
- Modify: `packages/shared/src/schemas/worker-task.ts`
- Modify: `packages/ai-provider/src/runtime-compiler.ts`
- Modify: `packages/shared/src/__tests__/yaml-config.test.ts`、`packages/ai-provider/src/__tests__/runtime-compiler.test.ts`

### Step 1: 删包 + workerType

- 删 `packages/scoring-engine` 目录。
- `shared/worker-task.ts` 的 `WORKER_TYPES` 删 `'scoring'`。
- `ai-provider/runtime-compiler.ts` 的 `WorkerTask.workerType` 删 `'scoring'`。

### Step 2: 更新测试

- `yaml-config.test.ts` 的 WORKER_TYPES 期望删 `'scoring'`。
- `runtime-compiler.test.ts` 删 scoring 相关断言。

### Step 3: 重建 + 验证 + Commit

Run: `pnpm -r --filter "./packages/*" build && pnpm --filter server typecheck`

Expected: 通过。

```bash
git add packages/scoring-engine packages/shared/src/schemas/worker-task.ts packages/ai-provider/src/runtime-compiler.ts packages/shared/src/__tests__/yaml-config.test.ts packages/ai-provider/src/__tests__/runtime-compiler.test.ts
git commit -m "refactor(scoring): remove scoring-engine package + workerType"
```

---

## Task 4: schema 删 Score + Draft.score + migration

**Files:**
- Modify: `prisma/schema.prisma`

### Step 1: 删字段 + 模型

- 删 `Score` 模型。
- 删 `Story.scores`、`Chapter.scores` relation。
- 删 `Draft.score` 字段。

### Step 2: 生成 migration

`prisma migrate diff` 生成 `DROP TABLE "Score"` + `DROP COLUMN score`，写 migration + deploy + generate。

### Step 3: 验证 + Commit

Run: `pnpm --filter server typecheck && pnpm --filter server exec vitest run`

Expected: 通过。

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "refactor(scoring): drop Score table + Draft.score"
```

---

## Task 5: 文档

**Files:**
- Modify: CLAUDE.md / AGENTS.md / README.md / docs

### Step 1: 清评分描述

- CLAUDE.md 删「AI scores across 7 dimensions, with a rule-based fallback」、`scoreQueue` placeholder 描述、scoring-engine 引用。

### Step 2: 验证 + Commit

Run: `pnpm typecheck`

Expected: 通过。

```bash
git add CLAUDE.md
git commit -m "refactor(scoring): remove scoring docs"
```

---

## 完成验证

1. `pnpm --filter server test` 全量通过。
2. `pnpm typecheck` 全仓通过。
3. `git grep -i "scoring\|score" apps packages prisma/schema.prisma` 确认无残留（除 docs/历史迁移）。
