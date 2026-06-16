# Codebase Analysis — Design Spec

> Produce 3 independent docs (`docs/LOGIC.md` / `docs/QUESTIONS.md` / `docs/ISSUES.md`) that let the project owner understand 12k lines of code in 15 minutes, see where AI-written code drifted from the original design intent, and surface strictly P0 data-loss / crash / security issues.
>
> **No code changes. No fix recommendations. Reading only.**

- **Date:** 2026-06-16
- **Status:** Awaiting user review
- **Owner:** project owner (self)
- **Target reader:** project owner only

---

## 1. Goals & Non-Goals

### Goals
1. `docs/LOGIC.md` (≤3000 words) — 15-minute architectural map of the whole system
2. `docs/QUESTIONS.md` (≤10 entries, ≤5 lines each) — places where AI-written code may have drifted from the owner's design intent
3. `docs/ISSUES.md` (3 groups: data loss / crash / security) — strict P0 findings, with evidence chain, no fix recommendations
4. Full coverage: `apps/server` (14 routes + 15 services) + `apps/web` (11 api + 4 composables + 16 views) + `packages/*` (6 packages)
5. Each round of code reading produces a 1-paragraph internal summary (not committed to the 3 docs) so the user can spot drift early

### Non-Goals
- **No code changes.** No refactoring. No fix recommendations. The user said "I'll decouple after fixing the drifts myself."
- **No edits to existing docs.** `CLAUDE.md`, `AGENTS.md`, `Process.md`, `README.md`, `KNOWN-ISSUES.md` stay as they are.
- **No new tooling, dependencies, or tests.**
- **No frontend-only analysis.** Frontend is read only where it touches the state machine, the reviewing flow, or contract types shared with the backend.

---

## 2. Output Contract

### 2.1 `docs/LOGIC.md` (≤3000 words, 15-minute read)

| § | Section | Purpose | Target length |
|---|---------|---------|---------------|
| 0 | 5-minute bird's eye | One-line project statement + ASCII data-flow diagram (chapter lifecycle, archive pipeline) | 300 words |
| 1 | Module map | 14 routes + 15 services / 11 api + 4 composables + 16 views / 6 packages — one line each | 400 words |
| 2 | Core flows | 8-state chapter status machine, 5-phase archive pipeline, AI call panorama table (which call, which temperature, what for) | 700 words |
| 3 | Inter-module call graph | `routes/chapters.ts` → which services; service-to-service dependencies; shared contract types | 500 words |
| 4 | Implicit conventions worth knowing | originUid "latest by createdAt" rule, Jaccard 0.82 dedup, manual JSON.stringify on Prisma JSON columns, 3 parallel token counters, `prepare*` / `commit*` split, etc. | 700 words |
| 5 | Footnotes | Low-priority observations that don't belong in KNOWN-ISSUES but the user may want to know | 200 words |

### 2.2 `docs/QUESTIONS.md` (≤10 entries, ≤5 lines each)

Format per entry:

```
#N | file:line | phenomenon | my guess of your intent | evidence | blast radius
```

- Ordered by **design-intent certainty low → high** (the entry the user is most likely to want to clarify goes first)
- One observation per entry, no compound questions
- "Evidence" must point to a specific line or short function; if it's a feeling rather than evidence, mark it as `[speculative]`
- "Blast radius" describes what is affected if the AI's interpretation is wrong (which chapter statuses / which users / which other docs)

### 2.3 `docs/ISSUES.md` (3 groups)

Format per entry:

```
## [category] title
- File:line
- Symptom: what the user observes
- Repro: minimal steps to trigger
- Root cause hypothesis: why (cite code, do not prescribe fix)
- Blast radius: who/what is affected when it triggers
```

Three groups (strict P0 scope):
- **[Data loss]** — silent overwrite, lost writes, missing cascade, partial commit leaving orphan rows
- **[Crash]** — unhandled throw that aborts a transaction or kills the request, leaving state inconsistent
- **[Security]** — CORS / auth / API key / `process.env` leak / SQL injection / unvalidated input reaching Prisma

No fix recommendations. Order within group: **probability × severity** descending (most likely-to-trigger AND most-damaging first).

---

## 3. Reading Strategy (3 rounds, breadth + depth)

### Round 1 — Backend core + schema (~30-40k tokens)

**Breadth (one `codegraph_explore` call):**
- All 15 service files' first 50 lines + exported symbol map
- Exported types / enums from `packages/shared/src/index.ts`

**Depth (full Read of each):**
- `apps/server/src/services/combined-extractor.ts`
- `apps/server/src/services/graph-organizer.ts`
- `apps/server/src/services/memory-optimizer.ts`
- `apps/server/src/services/generate-processor.ts`
- `prisma/schema.prisma` (already read in this session)

**Internal output (not in 3 docs):**
- 1-paragraph summary: "P0 candidates found this round, drift candidates found this round, things to dig into in Round 2"
- Use `codegraph_callers` to map: "who calls combined-extractor / graph-organizer / memory-optimizer / generate-processor"

### Round 2 — Routes + Frontend + packages (~30-40k tokens)

**Breadth (multiple `codegraph_explore` calls):**
- 14 routes' first 50 lines + exported routes
- 11 api modules' exported functions
- 4 composables' exported functions
- `packages/prompt-runtime/src/index.ts`, `packages/ai-provider/src/index.ts`, `packages/memory-engine/src/index.ts` exports

**Depth (full Read of each):**
- `apps/server/src/routes/chapters.ts` (largest route; contains the new `prepare-archive` / `save-pending-archive-data` / `archive` chain)
- `apps/web/src/views/Chapters.vue` (touches the reviewing state)
- `apps/web/src/composables/useChapterEditor.ts` (contains `prepareArchive` / `savePendingArchiveData` / `archiveChapter`)
- `apps/web/src/views/ReviewingPanel.vue` (partially read earlier in this session)

**Internal output:**
- 1-paragraph summary, same template as Round 1

### Round 3 — Write docs (~10-15k tokens)

- Write `docs/LOGIC.md`
- Write `docs/QUESTIONS.md`
- Write `docs/ISSUES.md`
- **Self-review each doc** (see §5)
- `git add docs/LOGIC.md docs/QUESTIONS.md docs/ISSUES.md` + commit
- Final report: paths + suggested reading order to user

---

## 4. Out of Scope

- `.kimi/` directory (git status shows it exists, but it doesn't affect business logic)
- `docs/profiles/*.json` (auto-imported at startup, not business logic)
- The 4 same-name `init` Prisma migrations (not in user's ask; will appear in `QUESTIONS.md` as a drift candidate, **not** in `ISSUES.md`)
- Migration history audit, schema redesign, naming convention enforcement

---

## 5. Risks & Mitigations

| # | Risk | Mitigation |
|---|------|------------|
| R1 | Reading 12k lines exhausts the conversation context | Force a "summary + clear working memory" checkpoint at the end of Rounds 1 and 2. Carry only the summary forward, not the full file contents. |
| R2 | P0 findings surface but user said "decouple later" — risk of me wanting to suggest fixes | All P0s go to `ISSUES.md` in the strict scope. No "Recommendation" or "Suggested fix" field in the entry format. |
| R3 | Coverage gaps after 3 rounds | After Round 2, run targeted `Grep` for high-signal patterns: `as any`, `JSON.parse`, `try {` near `await prisma`, `console.log(.*process.env)`, `findMany.*apiKey`, `deleteMany`. Any hit is followed by a focused Read. |
| R4 | Drift in `QUESTIONS.md` entries (I read the code wrong, call something a drift when it isn't) | Mark anything that is "feeling" not "evidence" with `[speculative]`. The user gets to re-classify as "actually fine" without losing the entry's audit trail. |
| R5 | The 3 rounds miss something because the code graph is incomplete | After Round 2, do one `codegraph_explore` on "ChapterArchive" or similar high-traffic symbol to find callers I haven't read. |

---

## 6. Sequencing (final)

1. **Round 1** — Backend core + schema → internal summary
2. **Round 2** — Routes + Frontend + packages → internal summary
3. **Coverage gap check** — `Grep` + `codegraph_callers` for high-signal patterns
4. **Round 3** — Write 3 docs
5. **Self-review** the 3 docs (placeholders, contradictions, scope, ambiguity)
6. **`git add` + commit** the 3 docs
7. **Final report** to user with paths + suggested reading order
