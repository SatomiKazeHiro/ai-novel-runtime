# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**AI 小说工坊** is a pnpm monorepo for engineering long-form novels with AI assistance. It is not an autonomous writer: the human directs, the AI generates, and the runtime maintains consistency across chapters.

- `apps/server` — Fastify + Prisma + BullMQ backend
- `apps/web` — Vue 3 + Vite + Pinia + Naive UI frontend
- `packages/*` — Shared engines: AI provider, prompt runtime, memory engine, knowledge graph, scoring

## CodeGraph

This repository is indexed by CodeGraph (`.codegraph/codegraph.db`). See `.claude/CLAUDE.md` for tool selection and usage rules — those instructions are auto-loaded and authoritative. Use raw `Read`/`Grep` only to confirm a specific detail CodeGraph did not cover.

## Common Commands

All commands run from the repo root unless noted.

```bash
# Install dependencies
pnpm install

# Start full dev stack (backend + frontend)
pnpm dev
# Backend  -> http://localhost:3000
# Frontend -> http://localhost:5173 (proxies /api to :3000)

# Start backend or frontend alone
pnpm --filter server dev
pnpm --filter web dev

# Type-check everything
pnpm typecheck

# Build everything
pnpm build

# Tests
pnpm test                 # run all tests via vitest
pnpm --filter server test # run server tests / vitest directly
```

> Tests live in `apps/server/src/__tests__/` (routes + services, mock Prisma) and `apps/web/src/**/__tests__/`; both run via Vitest.

### Database Commands

```bash
pnpm db:migrate   # apply Prisma migrations in dev
pnpm db:generate  # regenerate Prisma Client (required after schema changes)
pnpm db:studio    # open Prisma Studio
pnpm db:seed      # run prisma/seed.ts
```

The dev database is SQLite at `prisma/dev.db` via `DATABASE_URL="file:./dev.db"` in `.env`.

### Prisma Client Location

Prisma generates the client to `node_modules/.prisma/client` at the repo root. After schema changes, run `pnpm db:generate` before type-checking or the build will fail.

## High-Level Architecture

### Chapter Lifecycle

**Mental model (v2):**
- Chapter = environment snapshot (大纲/正文/角色状态/时间线/知识图谱/剧情弧线 = 小说在某一点的快照)
- Candidate generation = **抽卡 (gacha)**: 抽到的卡（`Draft`）是用户对"下一份快照长什么样"的几种可能;与章节是否在编辑无关——抽卡过程不消耗、不污染、不依赖章节状态
- ChapterStatus = snapshot lifecycle (3 个值, 见下); DraftStatus = candidate lifecycle (6 个值, 独立于 ChapterStatus)

The system is organized around a chapter state machine (`prisma/schema.prisma` → `enum ChapterStatus`) that drives the entire creative workflow. As of the **v2 refactor**, `ChapterStatus` is a **3-value enum** (`draft` / `reviewing` / `archived`); candidate generation lives entirely in `Draft.status` and is orthogonal to chapter state:

```
draft ──┬─→ preparing-archive ─→ reviewing ─→ archived
        │       (AI extraction)        ↑
        └──── user re-edits / cancel ──┘ (rollback)
```

(`preparing-archive` is the transient `prepare-archive` endpoint running, not a persisted enum value.)

1. User creates a chapter (`draft`).
2. User clicks **Generate**: backend enqueues a job creating N `Draft` candidates. Candidates run independently of chapter status — the chapter stays in `draft` while drafts progress through `Draft.status` (`generating` → `completed`/`failed`).
3. User may **Score** a candidate; AI scores across 7 dimensions, with a rule-based fallback.
4. User **Selects** one candidate: its content is copied into `Chapter.content`; its siblings are marked `Draft.status='rejected'`. **Chapter status stays unchanged** — selection is a Draft-layer concept. v2: the adopted draft is NOT marked `Draft.status='selected'`; "which draft is adopted" is only known by matching `Chapter.content` against `Draft.content`.
5. User clicks **Prepare Archive**: the backend runs 4 extraction stages in parallel, parks the payload in `Chapter.pendingArchiveData` (TEXT, JSON, `version: 3`) and sets status to `reviewing`. No DB writes to derived tables or the three graph columns. Single-stage failure is recorded per-stage in the payload, not a rollback.
6. The `ReviewingPanel` lets the user edit memories, character states, the chapter graph, the cumulative graph, and plot arcs. Edits are written back to `Chapter.pendingArchiveData` via `chaptersApi.update({ pendingArchiveData })`. **Cancel = `POST /prepare-archive/cancel`, reverts status to `draft` and clears `pendingArchiveData`.**
7. User clicks **Confirm Archive**: the `archive` endpoint validates all stages succeeded and the cumulative graph was generated, copies graph data from `pendingArchiveData` into the `Chapter` columns, clears `pendingArchiveData`, and flips status to `archived`. (Derived-table writes + transaction wrapping are planned follow-up work, currently a gate stub.)

Only `archived` chapters feed forward into the next chapter's prompt.

**Candidate generation is orthogonal to chapter state.** A draft can be generated for any non-`archived` chapter (`generate` / `select` return 400 on an `archived` chapter). The worker respects `Draft.status` (skipping user-decided/completed/failed drafts) but never reads or writes `Chapter.status`.

Frontend polling: after submitting generation, the UI polls `draftsApi.list` every 2 seconds (`useIntervalFn` in `useDraftManager.ts`) until all drafts are `completed` or `failed`. Both `generate` and `archive` API calls set `timeout: 0` because they may be long-running.

The `ReviewingPanel` is mounted inside `apps/web/src/views/Chapters.vue` once `currentChapter.status === 'reviewing'`; it does not poll — saving and confirming are explicit user actions.

### Prompt Pipeline

Generation is **stateless**: every prompt is assembled fresh from the database, not from a chat history.

The prompt is built in fixed layers (bottom to top):

```
System Message  ← Identity + Settings + Behavior + Jailbreak + Task
User Message    ← Style → Story → Lore → Character → Scene → Memory → Timeline → PlotArc → Output
```

Each layer has a token budget. The budgets scale relative to the model's `contextLength` (default benchmark 64k tokens). Implementation is split across:

- `packages/prompt-runtime` — layer assembly and budget logic
- `packages/ai-provider` — provider abstraction and the runtime prompt compiler
- `apps/server/src/services/runtime-loader.ts` — loads `RuntimeProfile` and `WorkerTask` with a fallback chain
- `apps/server/src/services/ai-call-logger.ts` — the single required wrapper for every AI call; it records `PromptLog` rows

### Archive Pipeline (Five-Phase)

Archiving is the most complex flow. It is implemented in `apps/server/src/routes/chapters-archive.ts` and the `services/stages/*` modules. Phases 1–4 are split across HTTP endpoints: `prepare-archive` runs phases 1–2 and parks the result, the user reviews via `ReviewingPanel.vue` (writes via `chaptersApi.update({ pendingArchiveData })`), `archive` (confirm) runs phases 3–4 from the parked payload.

| Phase | File(s) | Endpoint | What happens |
|-------|---------|----------|--------------|
| 1. Extract | `services/stages/{character,memory,plot-arc,graph-extract}-stage.ts` (并行 4 stage) | `prepare-archive` | 4 个 stage 并行 (`Promise.all`) 抽出 characterStates / memories / plotArcs / chapterGraph,各自结果落到 `pendingArchiveData.stages[name]`。单 stage 失败不影响其他 stage。reviewing 期间 `Chapter.chapterGraph / cumulativeGraph / cumulativeGraphGeneratedAt` 三列整个过程不被读写。 |
| 1.5. Optimize memory | `memory-optimizer.ts` | `prepare-archive` (4 stage 完成之后) | 在 4 stage `Promise.all` 完成后追加调 optimizer,读现有 `layer='global'` + 当前 memory-stage output,AI 融合产出 `stages.memory.result.memories`(统一数组,每条 `{content, originUid, importance, type: 'event'\|'state'}`,后端落表时加 `'auto-extracted'` 前缀)。覆盖原 raw output,user review 时看到的是融合结果。**不再** post-commit 跑(原 v2 `archive` post-commit 触发已删除)。失败时该 stage 标记 failed,不影响 graph / character / plot-arc。 |
| 2. Organize graph | (内嵌在 graph-extract stage 里读 `prevCumulativeGraph`) | `prepare-archive` | graph stage 读上一章归档的 `Chapter.cumulativeGraph` (parent 优先,主线回退) + 本章 chapterGraph,产出新的 `chapterGraph`。累计合成下个 user action 「生成累计图谱」时再走 `services/cumulative-graph.ts`。 |
| 2.5. Human review | `ReviewingPanel.vue` (前端) | `chaptersApi.update({ pendingArchiveData })` | 用户在审查阶段编辑后点「保存调整」→ `composables/useChapterEditor.ts:savePendingArchiveData` → `PUT /api/chapters/:id` 把整份 `PendingArchiveDataV3` 写回 `Chapter.pendingArchiveData` (TEXT JSON)。累计图谱编辑后保存走同一条路(PATCH 端点已删除)。Cancel = `POST /prepare-archive/cancel`,只清 `pendingArchiveData`。 |
| 3. Transaction write | `chapters-archive.ts` archive route | `archive` (confirm) | commit-only 端点,**不调 AI 不调 optimizer**。`prisma.$transaction` 内依次:① `tx.memory.create` 写三层(`chapter` from main/sideEvents/emotions/foreshadowing/relationshipChanges、`scene` from scenes、`global` from optimizer 融合 memories)② `tx.chapter.update({summary})` ③ `tx.chapter.update({chapterGraph, cumulativeGraph, cumulativeGraphGeneratedAt, status: 'archived', pendingArchiveData: null})`。**CharacterBranchState / PlotArc 写入另文档讨论**;`TimelineEvent` 在 v3 删除,不再写。 |

**数据流硬规则(v3)**:reviewing 期间所有图谱数据只活 `pendingArchiveData` JSON;`Chapter` 三列(`chapterGraph` / `cumulativeGraph` / `cumulativeGraphGeneratedAt`)在 `archive` confirm 之前一直为 null。`GraphView.vue` 只查 `archived` 章节,读三列,读到的是用户终稿。详见 `docs/superpowers/specs/2026-07-29-graph-cleanup-design.md` + `docs/superpowers/specs/2026-07-29-graph-v2-deadcode-cleanup-design.md`。

### Queue System

The backend uses BullMQ when `REDIS_URL` is available, otherwise it falls back to an in-memory `MemoryQueue`. Only the `generateQueue` currently has a registered worker (`generate-processor.ts`). `scoreQueue` and `memoryQueue` exist but are placeholders.

Drafts are generated **serially** inside `generate-processor.ts` to reduce instantaneous API pressure, even when multiple candidates are requested. As of v2, the worker only reads/writes `Draft.status` (skipping the three user-decided/terminal statuses `rejected`/`completed`/`failed`); it never touches `Chapter.status`.

### Memory Model

Memories are stored in a single `Memory` table with a `layer` column:

- `global` — cross-chapter state, written by `memory-optimizer` after every archive (optimizer 在 prepare-archive 阶段跑,覆盖 `stages.memory.result.memories`;tags=`['auto-extracted','event'|'state']`)
- `chapter` — raw extraction from a single chapter, written by archive confirm 直接从 memory-stage 原 mainEvents / sideEvents / emotions / foreshadowing / relationshipChanges 转表(tags=`['auto-extracted']`,mainEvents 多带 `'main-plot'`)
- `scene` — key locations (`scenes[]` 字段),archive confirm 转表,importance 7-10(tags=`['auto-extracted','scene-memory']`,**不进 prompt 注入,仅 Memory.vue UI 显示**)
- `temporary` — ephemeral context,API 手动 CRUD;当前业务未使用

archive confirm **commit-only 不调 AI**,在 `prisma.$transaction` 内一次写完三层。`Chapter.summary` 写 `Chapter.summary` 列,**不进 Memory 表**(理由:`memory-engine.searchRelevant` 不读 summary 字段)。

Prompt assembly retrieves relevant memories via semantic similarity (`memory-engine`) and Jaccard deduplication. `searchRelevant` (`packages/memory-engine/src/index.ts:103`) 读 `layer IN ('global', 'chapter')`,按相似度排序、按 content 文本相似度 > 0.82 去重。**v3 memory system 拍板**:`searchRelevant` 加 originUid 分组取最新版本逻辑(**仅 layer='global'**),避免同 UID 多版本同时塞 prompt 导致 AI 矛盾描述。layer='chapter' 不参与 UID 分组(章节内 raw 提取独立)。

optimizer 每章归档对同 UID 产生新行 layer='global'(**累加**,不是 update by UID)。删除章节(`chapters-crud.ts:179-194`)只 delete where `fromChapterNumber=N`,前 N-1 章同 UID 版本保留 → searchRelevant 取最新版本自然实现"删章节回退"语义,无需特殊代码。

### Knowledge Graph

v3: graph data lives entirely on the `Chapter` row as JSON columns (the `GraphNode`/`GraphEdge` tables were dropped in migration `20260729000000_drop_graph_node_edge`):

- `chapterGraph` — the chapter-only graph extracted at prepare-archive
- `cumulativeGraph` — the cumulative global graph up to this chapter (user-triggered merge via `services/cumulative-graph.ts`)
- `cumulativeGraphGeneratedAt` — when the user first generated the cumulative graph; `null` = not generated

During `reviewing` these three columns stay `null`; the working copies live in `pendingArchiveData`. Only `archive` confirm writes them. `GraphView.vue` reads the columns of `archived` chapters via `cumulativeGraphApi` and visualizes with Cytoscape.

### Character Snapshot Editing

已归档的角色快照（`CharacterBranchState`，每角色每归档章一行）可在角色页编辑弹窗的右侧快照面板中手动编辑（`PUT /api/stories/:storyId/characters/:charId/snapshot/:chapterNumber`，`updateMany` 幂等更新，无行则 404）。手动修改由用户负责（UI 有 warning 提醒），编辑结果直接作为后续章节生成时的角色参考（`getCharactersWithLatestState` 无缓存）；删除章节时该章快照连同修改一并删除。详见 `docs/superpowers/specs/2026-08-13-character-snapshot-editing-design.md`。

### Main vs Side Stories

- Main-line chapters form a strictly linear sequence (`1, 2, 3, ...`).
- Side stories (`isSideStory = true`) are decimal chapters (`1.01`, `1.02`) and can branch from any archived chapter.
- Deleting an archived chapter cascades: it removes derived data (memories, timeline events, character branch states, plot arcs, prompt logs) that share the same `fromChapterNumber`. v3: no graph-table rebuild — the cumulative graph is per-chapter JSON (`Chapter.cumulativeGraph`), so earlier chapters keep their own snapshots.

### Timeline Position Encoding

`TimelineEvent.position` is stored as a single-decimal **Y.DDDHH** float where the integer part is the year (negative = pre-history) and the decimal part is exactly 5 digits `DDDHH` (day-of-year 1–365 + hour 0–23). Rendered through `formatTimelinePosition()` (currently in `apps/server/src/routes/chapters-generate.ts`); use the same encoding when inserting or comparing positions. Schema migration `20260626000000_timeline_position_encoding` introduced this; pre-migration rows should already be backfilled.

> **TimelineEvent 在 v3 删除**（2026-07-24 标记）。强 Y.DDDHH 时间戳假设排除无时间/模糊时间类故事；`findMany` 全量注入与 Memory.semantic recall 重复。v3 实施见 `docs/DESIGN.md` 决策日志。v2 期间不要在新代码里依赖 TimelineEvent。

## Key Conventions

### Import Rules

- **Backend and packages** use `module: NodeNext`. Relative imports **must** include the `.js` extension, e.g. `import './app.js'`.
- **Frontend** uses `module: ESNext` with `allowImportingTsExtensions` and the `@/` alias to `src/`.

### AI Provider Setup

On startup, `ai-provider-init.ts` reads `DEEPSEEK_API_KEY`, `DEEPSEEK_BASE_URL`, and `DEEPSEEK_MODEL` from `.env` and creates/updates the default `AiProviderConfig`. Only `DeepSeekProvider` is fully implemented; `OpenAIProvider` is a stub.

### Runtime / Worker Loading

Both `loadRuntimeBase()` and `loadWorkerTask()` resolve in this order:

1. Story-specific config (`storyId` match)
2. Global default (`isDefault = true`)
3. Hard-coded neutral fallback

`RuntimeProfile` loading follows a similar chain: chapter-level → story-level → global default → hard-coded fallback.

### JSON Fields

Prisma JSON fields (`personality`, `metadata`, `params`, `settings`, `pendingArchiveData`, `chapterGraph`, `cumulativeGraph`, `score`, etc.) are manually `JSON.stringify`/`JSON.parse` in route handlers. The frontend often has to `JSON.parse` them after receiving.

### Response Shape

Route handlers generally return:

```json
{ "success": true, "data": ... }
```

or

```json
{ "success": false, "error": "..." }
```

The frontend API layer (`apps/web/src/api/*.ts`) does not unwrap this automatically; callers check `response.data.success` themselves.

### Naive UI Imports

Import each Naive UI component explicitly. Table action columns are rendered with Vue's `h()` function, not JSX.

## Important Files to Know

- `apps/server/src/server.ts` — entry point: env, queue worker, HTTP listener
- `apps/server/src/app.ts` — Fastify app assembly
- `apps/server/src/routes/chapters-*.ts` — chapter API split by concern: `chapters-crud` (create/list/update/delete), `chapters-tree` (chapter-tree endpoint), `chapters-generate` (preview / generate drafts / select), `chapters-archive` (prepare-archive / prepare-archive/cancel / cumulative-graph get+build / archive), and `chapters.ts` (umbrella register + misc). New chapter endpoints should follow this family pattern, not pile into `chapters.ts`.
- `apps/server/src/services/ai-call-logger.ts` — mandatory wrapper for all AI calls
- `apps/server/src/services/generate-processor.ts` — queue worker that generates drafts serially
- `apps/server/src/services/stages/` — v3 archive extraction stages (`character-stage` / `memory-stage` / `plot-arc-stage` / `graph-extract-stage`), run in parallel by `prepare-archive`
- `apps/server/src/services/cumulative-graph.ts` — user-triggered cumulative graph merge (`cumulative-graph/build` endpoint)
- `apps/server/src/services/graph-snapshot.ts` — graph snapshot data shapes (`GraphNodeSnapshot` / `GraphEdgeSnapshot` / `GraphSnapshot`)
- `apps/server/src/services/memory-optimizer.ts` — 在 `prepare-archive` 阶段(4 stage `Promise.all` 完成后)调,读现有 `layer='global'` + memory-stage output,AI 融合产出统一 `memories[]`,覆盖 `pendingArchiveData.stages.memory.result.memories`。archive confirm **不**再调(commit-only)。详见 `docs/superpowers/specs/2026-07-30-v3-memory-system-design.md`。
- `packages/prompt-runtime/src/index.ts` — prompt assembly pipeline
- `packages/ai-provider/src/index.ts` — provider abstraction and runtime compiler
- `packages/memory-engine/src/index.ts` — semantic search and memory formatting
- `prisma/schema.prisma` — single source of truth for data models

## Documentation

- `AGENTS.md` — broader agent guide with route/service tables and tech-stack detail
- `Process.md` — narrative walkthrough of the chapter lifecycle and data flow
- `README.md` — project intro, setup, and deployment notes
- `docs/DESIGN.md` — design-level rationale and decisions
- `docs/LOGIC.md` — domain logic notes (timeline encoding, scoring rules, etc.)
- `docs/ISSUES.md` — P0/P1 issue tracker with file:line citations and resolution commits
- `docs/sql-reference.md` — SQL reference
- `docs/superpowers/plans/` — implementation plans produced via superpowers:writing-plans
- `docs/superpowers/specs/` — brainstorming specs produced via superpowers:brainstorming
- `KNOWN-ISSUES.md` — known pitfalls (loose types, token-counting fragmentation, etc.) and security caveats (no auth, open CORS, real keys in `.env`)

## 协作约定

- 接到非平凡的代码任务（新增功能、跨模块改动、bug 修复），AI 应先调 superpowers 的
  `brainstorming` skill 做意图探索，再视情况调 `writing-plans` 出方案。
- 写实现代码前，对项目已有测试覆盖的路径调 `test-driven-development`；server 与 web 均已有
  Vitest 测试（`apps/server/src/__tests__/`、`apps/web/src/**/__tests__/`），改动相关路径时先跑对应测试。
- 完成任务、准备声称"完成"前，必须先调 `verification-before-completion`，跑过 `pnpm typecheck`
  再下结论。（全仓暂无 ESLint 配置，`pnpm lint` 已于 2026-08 移除；引入 lint 体系后再恢复。）
- 用户可以直接说"这次跳过 brainstorming / 跳过 TDD"——这条规则是兜底，不是镣铐。
