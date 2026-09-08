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

# Lint (root script; not all packages define their own lint script)
pnpm lint

# Tests
pnpm test                 # run all tests via vitest
pnpm --filter server test # run server tests / vitest directly
```

> Note: there are currently no test files, but Vitest is installed and `apps/server` is configured to run it.

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
5. User clicks **Prepare Archive**: the backend runs phase 1 + phase 2 of the archive pipeline, parks the extracted payload in `Chapter.pendingArchiveData` (TEXT, JSON) and sets status to `reviewing`. No DB writes to derived tables yet. On AI-extraction failure, status rolls back to `draft`.
6. The `ReviewingPanel` lets the user edit memories, character states, timeline events, the chapter graph, and plot arcs. Edits are written back to `Chapter.pendingArchiveData` via `chaptersApi.savePendingArchiveData`. **Cancel = delete the chapter.**
7. User clicks **Confirm Archive**: the persisted payload is replayed inside a `prisma.$transaction`, chapter status flips to `archived`, and phase 4 (memory optimization) runs after the transaction.

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

Archiving is the most complex flow. It is implemented in `apps/server/src/routes/chapters.ts` and the `services/*-extractor/organizer/optimizer` modules. Phases 1–4 are split across two HTTP endpoints: `prepare-archive` runs phases 1–2 and parks the result, `archive` (confirm) runs phases 3–4 from the parked payload.

| Phase | File(s) | Endpoint | What happens |
|-------|---------|----------|--------------|
| 1. Extract | `combined-extractor.ts`, `memory-extractor.ts`, `graph-extractor.ts`, `plot-extractor.ts` | `prepare-archive` | One AI call extracts memories, raw graph entities, and plot-arc progress. No DB writes yet. |
| 2. Organize graph | `graph-organizer.ts` | `prepare-archive` | AI merges the previous chapter's global graph snapshot with the new raw extraction, producing `mergedGraph` (cumulative global) and `chapterGraph` (this chapter only). |
| 2.5. Human review | `ReviewingPanel.vue` (frontend) | `save-pending-archive-data` (debounced) | The full payload is written to `Chapter.pendingArchiveData` (TEXT) and the chapter enters the `reviewing` state. The user can edit memories, graph, plot arcs, etc. before committing. The endpoint is debounced from the composable; cancel = delete the chapter. |
| 3. Transaction write | `chapters.ts` archive route | `archive` (confirm) | All DB writes run inside `prisma.$transaction` from the parked payload: `Memory`, `CharacterBranchState`, `TimelineEvent`, `PlotArc`, `GraphNode`/`GraphEdge`, `Chapter.graphSnapshot`/`graphDelta`, `Chapter.summary`, and `Chapter.status = 'archived'`. |
| 4. Optimize memory | `memory-optimizer.ts` | `archive` (post-commit) | AI fuses previous global memory with new chapter memory into the next global snapshot. Runs after the transaction; failure is logged but does not roll back the archive. |

This design guarantees that phases 1 and 2 can fail without writing data, phase 2.5 can be re-entered as many times as the user wants without losing work, and phase 3 failures roll back all writes. Memory writes are split into `prepareMemoryWrites` (pure data preparation) and `commitMemoryWrites` (transactional insert) so the archive route controls the transaction boundary.

### Queue System

The backend uses BullMQ when `REDIS_URL` is available, otherwise it falls back to an in-memory `MemoryQueue`. Only the `generateQueue` currently has a registered worker (`generate-processor.ts`). `scoreQueue` and `memoryQueue` exist but are placeholders.

Drafts are generated **serially** inside `generate-processor.ts` to reduce instantaneous API pressure, even when multiple candidates are requested. As of v2, the worker only reads/writes `Draft.status` (skipping the three user-decided/terminal statuses `rejected`/`completed`/`failed`); it never touches `Chapter.status`.

### Memory Model

Memories are stored in a single `Memory` table with a `layer` column:

- `global` — cross-chapter state, optimized after every archive
- `chapter` — raw extraction from a single chapter
- `scene` — high-importance locations
- `temporary` — ephemeral context

Prompt assembly retrieves relevant memories via semantic similarity (`memory-engine`) and Jaccard deduplication. The same logical memory may have multiple historical versions; prompt assembly takes the latest by `originUid`.

### Knowledge Graph

Graph data lives in `GraphNode` and `GraphEdge` tables. Each archived chapter also stores:

- `graphSnapshot` — the cumulative global graph after this chapter (`mergedGraph`)
- `graphDelta` — the chapter-only graph (`chapterGraph`)

The frontend visualizes this with Cytoscape.

### Main vs Side Stories

- Main-line chapters form a strictly linear sequence (`1, 2, 3, ...`).
- Side stories (`isSideStory = true`) are decimal chapters (`1.01`, `1.02`) and can branch from any archived chapter.
- Deleting an archived chapter cascades: it removes derived data (memories, timeline events, character branch states) that share the same `fromChapterNumber` and rebuilds the graph from the previous chapter snapshot.

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

Prisma JSON fields (`personality`, `metadata`, `params`, `settings`, `graphSnapshot`, `graphDelta`, `score`, etc.) are manually `JSON.stringify`/`JSON.parse` in route handlers. The frontend often has to `JSON.parse` them after receiving.

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
- `apps/server/src/routes/chapters-*.ts` — chapter API split by concern: `chapters-crud` (create/list/update/delete), `chapters-tree` (chapter-tree endpoint), `chapters-generate` (preview / generate drafts / select), `chapters-archive` (prepare-archive / save-pending-archive-data / archive), and `chapters.ts` (umbrella register + misc). New chapter endpoints should follow this family pattern, not pile into `chapters.ts`.
- `apps/server/src/services/ai-call-logger.ts` — mandatory wrapper for all AI calls
- `apps/server/src/services/generate-processor.ts` — queue worker that generates drafts serially
- `apps/server/src/services/combined-extractor.ts` — archive phase 1: memory + graph + plot extraction
- `apps/server/src/services/graph-organizer.ts` — archive phase 2: merge global graph with new extraction
- `apps/server/src/services/graph-snapshot.ts` — `defaultTokenEstimator` + snapshot/delta helpers used by combined-extractor / graph-organizer; estimation vs validation boundary is documented at the top
- `apps/server/src/services/memory-optimizer.ts` — archive phase 4: global memory fusion
- `apps/server/src/services/memory-compressor.ts` / `memory-organizer.ts` — memory shaping helpers invoked before/after optimizer
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
- 写实现代码前，对项目已有测试覆盖的路径调 `test-driven-development`；项目目前**无测试文件**
  （见 `KNOWN-ISSUES.md`），新代码落 TDD 之前需先在 `apps/server` 补最小测试脚手架（Vitest 已就绪）。
- 完成任务、准备声称"完成"前，必须先调 `verification-before-completion`，跑过 `pnpm typecheck`
  与 `pnpm lint` 再下结论。
- 用户可以直接说"这次跳过 brainstorming / 跳过 TDD"——这条规则是兜底，不是镣铐。
