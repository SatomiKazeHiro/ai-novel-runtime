# Codebase Analysis Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Read all 12k lines of `apps/server` + `apps/web` + `packages/*` and produce 3 independent docs (`docs/LOGIC.md`, `docs/QUESTIONS.md`, `docs/ISSUES.md`) that the project owner can absorb in 15 minutes. No code changes.

**Architecture:** 3-round read-then-write pipeline. Round 1 = backend core services + schema. Round 2 = routes + frontend views + packages. Round 3 = write the 3 docs. Each round produces a 1-paragraph internal summary that seeds the next round's questions/issues. A coverage-gap grep sits between Round 2 and Round 3 to catch high-signal patterns (`as any`, `JSON.parse`, etc.) that may have been missed.

**Tech Stack:** Read-only analysis using `mcp__codegraph__*` tools (primary), `Read` (secondary for full file content), `Grep` (coverage gap check), `Bash` (`git status`, `wc -l`). No code edits, no tests, no new dependencies.

**Spec:** `docs/superpowers/specs/2026-06-16-codebase-analysis-design.md` (commit `303fea3`)

**Output deliverable paths:**
- `docs/LOGIC.md` — ≤3000 words, 15-min architectural map
- `docs/QUESTIONS.md` — ≤10 entries, AI drift candidates
- `docs/ISSUES.md` — strict P0 (data loss / crash / security), evidence chain, no fix recommendations

**Commit discipline reminder:** Before EVERY `git commit`, run `git status --short` and confirm the staged list matches what the current step intends to commit. Reject any commit where staged files include untracked work the user has not approved (see `~/.claude/.../memory/feedback-commit-scope-discipline.md`). Use `git restore --staged <file>` to narrow the staged set, never `--amend`.

---

## File Structure

This plan does NOT create or modify source code. The only files this plan produces are:

| File | Created by | Purpose |
|------|------------|---------|
| `docs/LOGIC.md` | Task 4 | 15-min architectural map |
| `docs/QUESTIONS.md` | Task 5 | ≤10 AI-drift candidates |
| `docs/ISSUES.md` | Task 6 | strict P0 findings |

**Internal working artifacts** (NOT committed, used as input to later tasks only):
- Round 1 summary paragraph — held in conversation context, used to seed Task 5/6
- Round 2 summary paragraph — same

**No source files are touched.** This is a read-only analysis. If at any point a step suggests editing source code, STOP — that is a scope violation.

---

## Task 1: Round 1 Exploration (Backend Core + Schema)

**Files:**
- Read: `apps/server/src/services/combined-extractor.ts`
- Read: `apps/server/src/services/graph-organizer.ts`
- Read: `apps/server/src/services/memory-optimizer.ts`
- Read: `apps/server/src/services/generate-processor.ts`
- Read: `prisma/schema.prisma` (already read in brainstorming; verify by re-reading key sections only)
- Read: `packages/shared/src/index.ts` (ChapterStatus enum + MemoryLayer)

**Output:** 1-paragraph internal summary (NOT a file). Carries forward to Task 5/6 as input. May be committed as `docs/superpowers/plans/_internal/round-1-summary.md` if the conversation context is becoming tight (per spec §5 R1).

- [ ] **Step 1: Breadth scan — all 15 services, first 50 lines + symbol exports**

Run:
```bash
mcp__codegraph__codegraph_explore query="services directory apps/server/src/services all 15 modules" maxFiles=15
```
Expected: 15 source blocks returned, each with the file's exported symbol map and first ~50 lines.

- [ ] **Step 2: Note in working memory which 4 services are most complex (largest exports, most cross-file calls)**

If a working-memory file is being used (see Task 1 intro), write 1 line per service with its purpose. Otherwise hold in conversation context.

- [ ] **Step 3: Read `combined-extractor.ts` in full**

```bash
mcp__codegraph__codegraph_node file="apps/server/src/services/combined-extractor.ts" includeCode=true
```
Expected: full source returned, with line numbers.

- [ ] **Step 4: Read `graph-organizer.ts` in full**

```bash
mcp__codegraph__codegraph_node file="apps/server/src/services/graph-organizer.ts" includeCode=true
```

- [ ] **Step 5: Read `memory-optimizer.ts` in full**

```bash
mcp__codegraph__codegraph_node file="apps/server/src/services/memory-optimizer.ts" includeCode=true
```

- [ ] **Step 6: Read `generate-processor.ts` in full**

```bash
mcp__codegraph__codegraph_node file="apps/server/src/services/generate-processor.ts" includeCode=true
```

- [ ] **Step 7: Re-read `prisma/schema.prisma` `ChapterStatus` enum + `Chapter` model + `Memory` model + `GraphNode`/`GraphEdge` models + `PromptLog.callType`**

Use the existing read in conversation context. Only re-read if schema has changed since the brainstorming read.

- [ ] **Step 8: Read `packages/shared/src/index.ts` `ChapterStatus` + `MemoryLayer` exports**

```bash
mcp__codegraph__codegraph_node file="packages/shared/src/index.ts"
```

- [ ] **Step 9: Reverse-lookup callers of the 4 deep-read services**

```bash
mcp__codegraph__codegraph_callers symbol="extractAll"
mcp__codegraph__codegraph_callers symbol="organizeGraph"
mcp__codegraph__codegraph_callers symbol="optimizeMemories"
mcp__codegraph__codegraph_callers symbol="processGenerate"
```
Expected: 4 separate caller lists, each pointing to route files in `apps/server/src/routes/`. The first three should all converge on `routes/chapters.ts` (archive flow). The fourth should converge on `routes/drafts.ts` or `routes/chapters.ts` (generate flow).

- [ ] **Step 10: Write Round 1 internal summary (1 paragraph)**

Format:
```
Round 1: [1 sentence on backend services architecture].
[2-3 sentences on how extractors/organizers/optimizer coordinate].
[1 sentence on schema surprises / drift candidates found].
[1 sentence listing P0 candidates: data loss / crash / security].
[1 sentence listing drift candidates for QUESTIONS.md].
[1 sentence on what to look for in Round 2].
```

Hold this in conversation context. If context is tight, commit to `docs/superpowers/plans/_internal/round-1-summary.md`.

- [ ] **Step 11: Commit (only if writing working-memory file)**

```bash
git status --short  # MUST show only the working-memory file
git add docs/superpowers/plans/_internal/round-1-summary.md
git commit -m "📝 internal: round 1 backend core summary"
```

---

## Task 2: Round 2 Exploration (Routes + Frontend + Packages)

**Files:**
- Read: 14 routes (breadth) + `routes/chapters.ts` (depth)
- Read: 11 api modules (breadth)
- Read: 4 composables (breadth) + `composables/useChapterEditor.ts` (depth)
- Read: `views/Chapters.vue` (depth) + `views/ReviewingPanel.vue` (depth, partially read earlier)
- Read: `packages/prompt-runtime/src/index.ts` (depth) + `packages/ai-provider/src/index.ts` (breadth) + `packages/memory-engine/src/index.ts` (breadth)

**Output:** 1-paragraph internal summary. Combined with Task 1's summary as input to Task 5/6.

- [ ] **Step 1: Breadth scan — all 14 routes' first 50 lines + exports**

```bash
mcp__codegraph__codegraph_explore query="apps/server/src/routes all 14 route files" maxFiles=14
```

- [ ] **Step 2: Read `routes/chapters.ts` in full**

```bash
mcp__codegraph__codegraph_node file="apps/server/src/routes/chapters.ts" includeCode=true
```
Focus attention on:
- the `prepare-archive` / `save-pending-archive-data` / `archive` route chain
- the `prisma.$transaction` block
- `JSON.stringify` / `JSON.parse` boundaries
- any `try/catch` that swallows errors
- any `as any`

- [ ] **Step 3: Breadth scan — 11 api modules' exports**

```bash
mcp__codegraph__codegraph_explore query="apps/web/src/api all 11 api modules" maxFiles=11
```

- [ ] **Step 4: Breadth scan — 4 composables' exports**

```bash
mcp__codegraph__codegraph_explore query="apps/web/src/composables all 4 composables" maxFiles=4
```

- [ ] **Step 5: Read `composables/useChapterEditor.ts` in full**

```bash
mcp__codegraph__codegraph_node file="apps/web/src/composables/useChapterEditor.ts" includeCode=true
```
Focus on `prepareArchive`, `savePendingArchiveData`, `archiveChapter` methods and how they handle errors.

- [ ] **Step 6: Read `views/Chapters.vue` in full**

```bash
mcp__codegraph__codegraph_node file="apps/web/src/views/Chapters.vue" includeCode=true
```
Focus on:
- `statusTagType` mapping (does it cover all 8 `ChapterStatus` enum values?)
- `handlePrepareArchive` / `handleConfirmArchive` / `handleCancelReviewing`
- the `ReviewingPanel` mount condition

- [ ] **Step 7: Read `views/ReviewingPanel.vue` in full**

```bash
mcp__codegraph__codegraph_node file="apps/web/src/views/ReviewingPanel.vue" includeCode=true
```
Focus on `normalizePendingData` defensive logic, the `save` / `confirm` / `cancel` event payloads, and any silent error handling.

- [ ] **Step 8: Read `packages/prompt-runtime/src/index.ts` in full**

```bash
mcp__codegraph__codegraph_node file="packages/prompt-runtime/src/index.ts" includeCode=true
```
Focus on the 9-layer assembly, budget truncation logic, and which `estimateTokens` is imported (per spec §5 R3 risk).

- [ ] **Step 9: Breadth scan — `ai-provider` and `memory-engine` exports**

```bash
mcp__codegraph__codegraph_explore query="packages/ai-provider exports" maxFiles=3
mcp__codegraph__codegraph_explore query="packages/memory-engine exports" maxFiles=3
```

- [ ] **Step 10: Reverse-lookup callers of `prepareArchive` / `archiveChapter` (frontend-side)**

```bash
mcp__codegraph__codegraph_callers symbol="prepareArchive"
mcp__codegraph__codegraph_callers symbol="archiveChapter"
```
Expected: only `views/Chapters.vue`. If anything else shows up, log it as a drift candidate.

- [ ] **Step 11: Write Round 2 internal summary (1 paragraph)**

Format:
```
Round 2: [1 sentence on route layer architecture].
[1-2 sentences on the prepare → save → archive route chain behavior].
[1 sentence on frontend reviewing flow].
[1 sentence on packages integration / token counting fragmentation].
[1 sentence on P0 candidates from frontend side].
[1 sentence on drift candidates from frontend side].
[1 sentence cross-referencing Round 1's findings].
```

- [ ] **Step 12: Commit working-memory file (if used)**

```bash
git status --short  # MUST show only the new working-memory file
git add docs/superpowers/plans/_internal/round-2-summary.md
git commit -m "📝 internal: round 2 routes+frontend+packages summary"
```

---

## Task 3: Coverage Gap Check

**Files:** No file reads yet. Output: a short list of "missed hot spots" that need a follow-up Read in Step 3.

- [ ] **Step 1: Grep for `as any` across backend + frontend**

```bash
grep -rn "as any" apps/server/src apps/web/src --include="*.ts" --include="*.vue" 2>&1 | wc -l
grep -rn "as any" apps/server/src apps/web/src --include="*.ts" --include="*.vue" 2>&1 | head -20
```
Expected: high count. Identify the 3-5 hotspots (files with most `as any` usages).

- [ ] **Step 2: Grep for `JSON.parse` near AI call / Prisma write sites**

```bash
grep -rn -B1 -A3 "JSON.parse" apps/server/src/routes apps/server/src/services 2>&1 | head -50
```
Look for: parse-then-write patterns where parse failure is not handled.

- [ ] **Step 3: Grep for `try {` near `await prisma`**

```bash
grep -rn -B2 -A2 "try {" apps/server/src 2>&1 | grep -B2 -A2 "await prisma" | head -40
```
Look for: catches that swallow errors silently (empty catch blocks, or `console.error` + continue).

- [ ] **Step 4: Grep for `process.env` / `apiKey` exposure**

```bash
grep -rn "process.env" apps/server/src --include="*.ts" 2>&1
grep -rn "apiKey" apps/server/src --include="*.ts" 2>&1
```
Look for: env var values being logged, apiKey columns being returned to clients.

- [ ] **Step 5: Grep for `deleteMany` / cascade deletion patterns**

```bash
grep -rn "deleteMany" apps/server/src --include="*.ts" 2>&1
grep -rn "onDelete" prisma/schema.prisma 2>&1
```
Look for: cascading deletes that might orphan data, or `onDelete: Cascade` chains.

- [ ] **Step 6: Read any follow-up files identified by Steps 1-5**

For each hotspot file identified (max 3-5 files), use `mcp__codegraph__codegraph_node` to read the relevant section. If a working-memory file is being used, append "coverage gap findings" to it.

- [ ] **Step 7: Final coverage check — `codegraph_explore` on the most-called backend symbol**

Pick the symbol that appeared in the most `codegraph_callers` results across Tasks 1-2 (likely `extractAll` or `organizeGraph`). Run:

```bash
mcp__codegraph__codegraph_explore query="<chosen symbol> all callers and callees"
```

Verify no caller was missed. If new ones surface, do a quick Read.

- [ ] **Step 8: No commit needed for this task (findings are appended to working-memory)**

---

## Task 4: Write `docs/LOGIC.md`

**Files:**
- Create: `docs/LOGIC.md`

- [ ] **Step 1: Write §0 — 5-minute bird's eye (≤300 words)**

Required content:
- One-sentence project statement (lift from `README.md` first paragraph, translated if needed)
- ASCII data-flow diagram for the chapter lifecycle (Draft → ... → Archived, including the new `Reviewing` state per the spec change in `CLAUDE.md`)
- ASCII data-flow diagram for the 5-phase archive pipeline (per `CLAUDE.md` "Archive Pipeline (Five-Phase)")

The two ASCII diagrams combined should fit in ≤40 lines.

- [ ] **Step 2: Write §1 — Module map (≤400 words)**

Required content:
- 14 routes listed by file, one line each (route path + one-line purpose)
- 15 services listed by file, one line each
- 11 api modules listed, one line each
- 4 composables listed, one line each
- 16 views listed, one line each
- 6 packages listed, one line each

Total ~50 lines of file list. Source the descriptions from `codegraph_explore` outputs of Tasks 1-2.

- [ ] **Step 3: Write §2 — Core flows (≤700 words)**

Required content:
- 8-state `ChapterStatus` enum table (state, who can transition in, who can transition out, what triggers transition)
- 5-phase archive pipeline table (phase, files, what AI call, what DB write, rollback semantics)
- AI call panorama table (call type, temperature, what for, which model)

- [ ] **Step 4: Write §3 — Inter-module call graph (≤500 words)**

Required content:
- ASCII or bullet-tree: `routes/chapters.ts` → which services (and which method on each)
- ASCII or bullet-tree: service-to-service dependencies (e.g., `combined-extractor` calls what, `memory-optimizer` calls what)
- Frontend → backend contract surface: which `chaptersApi.*` calls map to which route
- A "shared contract" note: which types are defined in `packages/shared` and consumed by both frontend and backend (focus on `ChapterStatus`)

- [ ] **Step 5: Write §4 — Implicit conventions (≤700 words)**

Required content (one paragraph or short list per convention):
- `originUid` "latest by `createdAt`" rule (Memory, Jaccard)
- Jaccard 0.82 dedup threshold (in `memory-extractor.ts`)
- Manual `JSON.stringify` on Prisma JSON columns (`schema.prisma` declares them as `String`, routes do their own ser/deser)
- Three parallel `estimateTokens` implementations (per `KNOWN-ISSUES.md` #3)
- `prepareXxxWrites` / `commitXxxWrites` split (transaction boundary control)
- `compiledPrompt` and `pendingArchiveData` as TEXT fields with JSON contents
- The 4 same-name `init` migrations (mention as an observation; full discussion in QUESTIONS.md)

- [ ] **Step 6: Write §5 — Footnotes (≤200 words)**

Required content:
- Low-priority observations that don't belong in KNOWN-ISSUES.md but the user should know
- Examples: services marked `@deprecated` still in repo (`memory-compressor.ts`, `memory-organizer.ts`); the 4 same-name init migrations; any other "I noticed but it's not P0" items from Tasks 1-2

- [ ] **Step 7: Word count check**

```bash
wc -w docs/LOGIC.md
```
Expected: ≤3000 words. If over, compress §4 (implicit conventions) first, then §2, then §3.

- [ ] **Step 8: Self-review**

Check:
- No "TODO" / "TBD" / "fill in later" placeholders
- Internal consistency: state machine in §2 matches the data flow in §0
- Section cross-references work: e.g., "see §4 for X" actually points to a section that has X

- [ ] **Step 9: Commit**

```bash
git status --short  # MUST show only docs/LOGIC.md as new file
git add docs/LOGIC.md
git commit -m "📃 docs(analysis): add LOGIC.md (15-min architectural map)"
```

---

## Task 5: Write `docs/QUESTIONS.md`

**Files:**
- Create: `docs/QUESTIONS.md`

- [ ] **Step 1: Aggregate drift candidates from Tasks 1-2 internal summaries**

From the Round 1 and Round 2 summary paragraphs, extract every "drift candidate" mentioned. Expected source list:
- Schema surprises (e.g., `pendingArchiveData` TEXT field behavior)
- Frontend/backend mismatch (e.g., `statusTagType` missing cases)
- API shape surprises (e.g., `chaptersApi.savePendingArchiveData` debounced vs sync)
- Convention surprises (e.g., `as any` count is high in certain files)
- Anything where you had to stop and ask "wait, is this intentional?"

- [ ] **Step 2: For each candidate, gather evidence**

For each candidate, find the file:line of the code that triggered the question. Use `codegraph_node` or `Grep` if needed. The evidence must be specific.

- [ ] **Step 3: Filter to ≤10 entries, prioritize by "design-intent certainty low → high"**

If more than 10 candidates emerged, drop the ones where the answer is most likely "yes, that's what I meant" and keep the ones where you're genuinely uncertain. Quality > quantity.

- [ ] **Step 4: Write each entry using the format from spec §2.2**

Format per entry (≤5 lines):
```
#N | file:line | phenomenon | my guess of your intent | evidence | blast radius
```

Mark any entry that's "feeling" not "evidence" with `[speculative]` after the entry number.

- [ ] **Step 5: Header + footer**

Add at top:
```
# Questions for the project owner

> Things in the code where the AI that wrote it may have drifted from your original design intent. Each entry: file:line of the code that triggered the question, my guess of your intent, evidence, blast radius.

> Format: `#N | file:line | phenomenon | my guess of your intent | evidence | blast radius`
> `[speculative]` after the number = I don't have hard evidence, this is a feeling.
> Ordered by design-intent certainty: lowest first (most likely to be a real drift).
```

Add at bottom:
```
---
*Generated by ai-novel-runtime codebase analysis. <word count> entries. See spec at `docs/superpowers/specs/2026-06-16-codebase-analysis-design.md`.*
```

- [ ] **Step 6: Self-review**

Check:
- No entry is duplicated (each phenomenon is unique)
- No entry is "actually obvious" (e.g., "Chapter has an id field" — drop it)
- Every entry has a specific file:line
- `[speculative]` is used sparingly (≤2 entries)

- [ ] **Step 7: Commit**

```bash
git status --short  # MUST show only docs/QUESTIONS.md as new file
git add docs/QUESTIONS.md
git commit -m "📃 docs(analysis): add QUESTIONS.md (AI-drift candidates)"
```

---

## Task 6: Write `docs/ISSUES.md`

**Files:**
- Create: `docs/ISSUES.md`

- [ ] **Step 1: Aggregate P0 candidates from Tasks 1-3**

From Round 1, Round 2, and Coverage Gap findings, extract every P0 candidate. Categorize each into:
- **[Data loss]** — silent overwrite, lost write, missing cascade, partial commit
- **[Crash]** — unhandled throw, aborted transaction, inconsistent state
- **[Security]** — CORS / auth / API key leak / `process.env` exposure / unvalidated input to Prisma

- [ ] **Step 2: For each candidate, gather full evidence chain**

For each candidate, identify:
- The exact file:line that contains the bug pattern
- The minimum repro steps (which endpoint, what payload, what user action)
- The root cause hypothesis (cite the code; do not prescribe a fix)
- The blast radius (which users / chapters / data is affected)

- [ ] **Step 3: Filter to P0 only — drop anything that's "code smell" or "low priority"**

The user said "strict: only data loss / crash / security". Anything that doesn't fit must be dropped (or moved to QUESTIONS.md if it's a drift candidate instead).

- [ ] **Step 4: Order within each group by "probability × severity" descending**

For [Data loss] group, [Crash] group, [Security] group:
- First entry = most likely to trigger AND most damaging
- Last entry = least likely OR least damaging

- [ ] **Step 5: Write each entry using the format from spec §2.3**

Format per entry:
```
## [Category] Title

- **File:line:** `path/to/file.ts:123`
- **Symptom:** what the user observes when this triggers
- **Repro:** minimal steps to trigger
- **Root cause hypothesis:** cite the code, no fix recommended
- **Blast radius:** who/what is affected
```

- [ ] **Step 6: Header + footer**

Add at top:
```
# P0 Issues

> Strict P0: data loss, crash, security. No fix recommendations — the project owner will fix and then ask for decoupling.

> Format per entry: `## [Category] Title` followed by file:line / symptom / repro / root cause hypothesis / blast radius.
> Categories: `[Data loss]`, `[Crash]`, `[Security]`.
> Order within each group: probability × severity, descending.
```

Add at bottom:
```
---
*Generated by ai-novel-runtime codebase analysis. <N> entries total. See spec at `docs/superpowers/specs/2026-06-16-codebase-analysis-design.md`.*
```

- [ ] **Step 7: Self-review**

Check:
- No entry is "code smell" (e.g., "the function is too long") — drop or move to QUESTIONS
- No entry has a "fix recommendation" field — strip if present
- Every entry has all 5 fields filled
- Categories are exactly `[Data loss]`, `[Crash]`, `[Security]` (no invented categories)

- [ ] **Step 8: Commit**

```bash
git status --short  # MUST show only docs/ISSUES.md as new file
git add docs/ISSUES.md
git commit -m "📃 docs(analysis): add ISSUES.md (strict P0 findings)"
```

---

## Task 7: Final Self-Review + Report to User

**Files:** No new files. Output: a final report to the user in conversation.

- [ ] **Step 1: Run spec self-review checks across all 3 docs**

For each of `docs/LOGIC.md`, `docs/QUESTIONS.md`, `docs/ISSUES.md`:
- No `TODO` / `TBD` / placeholder text (`grep -n "TODO\|TBD\|fill in" <file>`)
- No internal contradictions (e.g., state machine in LOGIC.md matches the diagram, QUESTIONS.md blast radii are consistent with ISSUES.md)
- No scope violations (LOGIC.md doesn't include fix recommendations, ISSUES.md doesn't include drift candidates, QUESTIONS.md doesn't include P0 issues)

- [ ] **Step 2: Verify git log shows clean commit history**

```bash
git log --oneline 303fea3..HEAD
```
Expected: 4-5 commits, each scoped to one of the 3 docs (or working-memory files). No untracked files. No accidental commits.

- [ ] **Step 3: Verify final word/entry counts meet spec**

```bash
wc -w docs/LOGIC.md  # expect ≤3000
grep -c "^# " docs/QUESTIONS.md  # expect ≤10
grep -c "^## \[" docs/ISSUES.md  # expect whatever count, but all in P0 categories
```

- [ ] **Step 4: Produce final report to user**

Required content in the report:
- 3 file paths
- Suggested reading order: LOGIC.md first (15 min), then QUESTIONS.md (5 min), then ISSUES.md (5 min)
- Brief note on what's interesting / surprising / worth your attention first
- "After you review, tell me which QUESTIONS.md items to convert into a separate fix-list spec, and which ISSUES.md items you want me to brainstorm a fix design for."

- [ ] **Step 5: No commit needed (final report is in conversation, not a file)**

---

## Self-Review (Spec Coverage Check)

Checklist run by the planner before committing this plan:

| Spec section | Covered by task |
|--------------|-----------------|
| §1 Goals (3 docs, full coverage, strict P0) | Tasks 4-6 |
| §1 Non-Goals (no code changes, no fix recs) | Header + per-task File Structure note + Task 6 Step 5 |
| §2.1 LOGIC.md (5 sections, ≤3000 words) | Task 4 |
| §2.2 QUESTIONS.md (≤10 entries, format) | Task 5 |
| §2.3 ISSUES.md (3 groups, format, no fix recs) | Task 6 |
| §3 Reading strategy (3 rounds, breadth+depth) | Tasks 1-2 |
| §3 Round 1 scope (4 services + schema + shared) | Task 1 Steps 3-8 |
| §3 Round 2 scope (routes + frontend + packages) | Task 2 |
| §3 Round 3 (write docs) | Tasks 4-6 |
| §4 Out of Scope (.kimi/, profiles, init migrations) | Header + Task 4 Step 5 |
| §5 R1 (context exhaustion → working memory) | Task 1/2 Step 11 / Step 12 |
| §5 R2 (P0 no fix recs) | Task 6 Steps 5-6 |
| §5 R3 (coverage gap grep) | Task 3 |
| §5 R4 (drift marking `[speculative]`) | Task 5 Step 4 |
| §5 R5 (codegraph reverse lookup) | Task 1 Step 9, Task 2 Step 10, Task 3 Step 7 |
| §6 Sequencing | Tasks 1→2→3→4→5→6→7 |

**No spec gaps found.**

**Placeholder scan:** Searched for "TBD", "TODO", "implement later", "add appropriate error handling", "fill in details", "similar to Task N" — none found.

**Type consistency:**
- `extractAll`, `organizeGraph`, `optimizeMemories`, `processGenerate` referenced consistently in Tasks 1 and 3 (per their `codegraph_callers` use in Task 1 Step 9 and Task 3 Step 7)
- `prepareArchive`, `archiveChapter` referenced consistently in Tasks 2 and 5 (Tasks 2 Steps 5-6, Task 2 Step 10)
- `pendingArchiveData` referenced consistently in Tasks 4 and 5 (LOGIC.md §0/§4, QUESTIONS.md as candidate format)
- File paths use forward slashes consistently (matches Bash on Windows; Read tool accepts either)

**No issues to fix inline.**
