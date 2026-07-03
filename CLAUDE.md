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

# `pnpm dev` runs `scripts/dev.mjs` (not concurrently): on Windows it avoids
# the cmd.exe "终止批处理操作 (Y/N)?" trap so Ctrl+C exits cleanly. Both
# `apps/server` and `apps/web` have `predev` hooks that rebuild all packages
# under `packages/*` first — package edits do not require a manual build.

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

The system is organized around a chapter state machine (`prisma/schema.prisma` → `enum ChapterStatus`) that drives the entire creative workflow:

```
Draft -> Generating -> Generated -> (Scored) -> Selected -> Reviewing -> Archived
                                                                       \-> (cancel: deleted)
                                                                                \-> (Rejected)
```

1. User creates a chapter (`draft`).
2. User clicks **Generate**: the backend assembles a prompt and enqueues a job to create multiple `Draft` candidates. While running, the chapter is `generating`; once all drafts finish, it becomes `generated`.
3. User may **Score** a candidate; AI scores across 7 dimensions, with a rule-based fallback. A scored chapter has the `scored` status.
4. User **Selects** one candidate; its content is copied into the `Chapter` and its status becomes `selected`.
5. User clicks **Prepare Archive**: the backend runs phase 1 + phase 2 of the archive pipeline, then parks the extracted payload in `Chapter.pendingArchiveData` (TEXT, JSON) and sets status to `reviewing`. No DB writes yet.
6. The `ReviewingPanel` lets the user edit memories, character states, timeline events, the chapter graph, and plot arcs. Edits are written back to `Chapter.pendingArchiveData` via `chaptersApi.savePendingArchiveData`. **Cancel = delete the chapter.**
7. User clicks **Confirm Archive**: the persisted payload is replayed inside a `prisma.$transaction`, chapter status flips to `archived`, and phase 4 (memory optimization) runs after the transaction.

Only `archived` chapters feed forward into the next chapter's prompt.

Frontend polling: after submitting generation, the UI polls `draftsApi.list` every 2 seconds (`useIntervalFn` in `useDraftManager.ts`) until all drafts are `completed` or `failed`. Both `generate` and `archive` API calls set `timeout: 0` because they may be long-running.

The `ReviewingPanel` is mounted inside `apps/web/src/views/Chapters.vue` once `currentChapter.status === 'reviewing'`; it does not poll — saving and confirming are explicit user actions.

### V2 Chapter Lifecycle (parallel rewrite)

A parallel rewrite of the chapter workflow lives under `apps/server/src/{routes-v2,services-v2}/` and `apps/web/src/{views-v2,composables-v2,api-v2}/`, on route prefix `/api/v2/...`. **V2 is the actively-developed implementation** — V1 (`/api/...`) above is legacy and only receives bug fixes.

The V2 state machine has only **3 effective states** (`prisma/schema.prisma` → `enum V2ChapterStatus`):

```
draft -> analyzing -> archived
```

The enum lists 4 values (`draft / generating / analyzing / archived`), but `chapter.status` never actually flips to `generating` — that label lives only on `V2Draft.status` (草稿级, see `apps/server/src/routes-v2/chapters.ts:436`). So V2 不需要 `updateMany` 原子锁 → 没有 V1 那种 4 套 allowed-status 白名单分散维护 → 没有"取消 review = 删章节"那条退路痛点。

Why 4 states instead of V1's 8? V2 intentionally drops the experimental features that V1 had固化成了必经步骤：AI 评分、必经 selectDraft 选最佳候选、ReviewingPanel 必经归档审查、reject 半成品态. V2's 5-way parallel AI analysis (`/api/v2/chapters/:id/analyze`) + 草稿级 DELETE 候选 provides the same value without locking.

**Full V2 architecture, data model, V1/V2 design differences, and Q6 调研结论 (4 态 vs 8 态) live in `docs/v2-architecture.md` — read it before touching V2 code.**

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

Drafts are generated **serially** inside `generate-processor.ts` to reduce instantaneous API pressure, even when multiple candidates are requested.

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

## Security & Operational Caveats

These will bite you if you forget them. The canonical list is `KNOWN-ISSUES.md` (`S1`–`S5` + `KNOWN-ISSUES.md` items 1–10); this is the short version a new session needs on day one.

- **No authentication on any `/api/*` route** (`S1`). Do not add `DELETE` / `PUT` / `archive` / `reset` endpoints without first deciding how they will be gated in production. All `/api/*` are open on the dev box.
- **CORS is `origin: true`** (`S2`). The 5173 → 3000 Vite proxy works because of this; production deployment must whitelist origins.
- **`.env` contains a real `DEEPSEEK_API_KEY`** (`S3`). Gitignored, but the value is also written into `AiProviderConfig.apiKey` at startup by `ai-provider-init.ts` and surfaces in DB dumps and prompt-log redaction. Never commit, never log, never echo.
- **Two parallel route conventions** (`KNOWN-ISSUES.md #7`): `stories.ts` uses `fastify.register(..., { prefix: '/api/stories' })`, while older files hardcode `/api/stories/:storyId/...` paths inside the router. New route files must use the `prefix` option.
- **Prisma JSON columns are `String`** under the hood (`KNOWN-ISSUES.md #4`): fields like `graphSnapshot`, `pendingArchiveData`, `score` require manual `JSON.stringify` / `JSON.parse` at the route layer. Missing one round-trip will store the literal text `[object Object]`.
- **Legacy `slice(0, 8000)` extractors are dead code** (`S5`) — `memory-extractor.ts` and `graph-extractor.ts` are no longer called by any route. Do not re-enable them; the truncation bug from P0 #2 is still embedded in their prompt templates.
- **`WorkerTask.storyId` is deprecated** (`KNOWN-ISSUES.md #9`); use the `StoryWorkerBinding` join table. New code should never read `workerTask.storyId`.

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
- `seeds/profiles/*.yaml` and `seeds/worker-tasks/*.yaml` — **at the repo root, not under `apps/`**. Scanned and imported on server startup (`runtime-profile-init.ts`, `worker-task-init.ts`); new YAMLs are picked up automatically, parse errors fail-fast.

## Documentation

- `AGENTS.md` — broader agent guide with route/service tables and tech-stack detail
- `Process.md` — narrative walkthrough of the chapter lifecycle and data flow
- `README.md` — project intro, setup, and deployment notes
- `docs/DESIGN.md` — design-level rationale and decisions
- `docs/LOGIC.md` — domain logic notes (timeline encoding, scoring rules, etc.)
- `docs/ISSUES.md` — P0/P1 issue tracker with file:line citations and resolution commits
- `docs/sql-reference.md` — SQL reference
- `docs/v2-architecture.md` — **V2 (novel-design-in-v2) 架构 + 模块 + 已知问题 + 兜底策略** (动手前必读)
- `docs/TimeLine设计.md` — V2 时间线系统设计 (Y.DDDHH 编码 + story/narrative 双轨)
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
