# Product Naming & Dashboard Copy Localization (中文化) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rename product to Chinese "AI 小说工坊" across 11 user-facing + doc surfaces; localize Dashboard hero copy to Chinese. Internal identifiers (`ai-novel-runtime` package/repo/keys) preserved.

**Architecture:** Pure text replacement across 6 frontend + 2 backend + 5 doc files. No logic change, no new tests, no new files. Two atomic commits: platform branding (frontend + backend) first, then doc title sync. Each commit independently verifiable via typecheck + grep.

**Tech Stack:** Vue 3, Naive UI, Vite (frontend); Fastify, Swagger (backend); Markdown (docs). Existing 12 unit tests in `apps/web/src/{stores,styles}/__tests__/` stay green throughout.

**Spec:** `docs/superpowers/specs/2026-06-21-product-i18n-zh.md`

---

## Pre-Implementation Baseline

Before any edits, establish the baseline so we can measure progress and verify completeness at the end.

- [ ] **Step 1: Count current "AI Novel Runtime" / "AI NOVEL RUNTIME" hits**

Run:
```bash
cd D:/MGit-Projects/ai-novel-runtime
grep -rn "AI Novel Runtime\|AI NOVEL RUNTIME" \
  apps/web/src \
  apps/web/index.html \
  apps/server/src \
  README.md AGENTS.md CLAUDE.md Process.md \
  docs/LOGIC.md docs/DESIGN.md \
  2>&1 | wc -l
```

Expected output: `12` (one hit per line we plan to change: NavBar L15, NavBar L47, Dashboard L8, Dashboard L10-11 (counted as 1 grep hit on `Build novels` is not matched; eyebrow `AI NOVEL RUNTIME · DASHBOARD` is 1 hit), Dashboard L10 `Build novels` is not in grep pattern but L11 `with one runtime` IS — let me re-check).

Actually the grep pattern is `AI Novel Runtime\|AI NOVEL RUNTIME`. Let me redo:

| File | Line | Text | Hits in grep pattern |
|---|---|---|---|
| NavBar.vue | 15 | `AI Novel Runtime` | 1 |
| NavBar.vue | 47 | `AI Novel Runtime v0.1.0` | 1 |
| Dashboard.vue | 8 | `AI NOVEL RUNTIME · DASHBOARD` | 1 |
| Dashboard.vue | 10-11 | `Build novels / with one runtime.` | 0 (not in pattern) |
| index.html | 13 | `<title>AI Novel Runtime</title>` | 1 |
| app.ts | 36 | `title: 'AI Novel Runtime API'` | 1 |
| app.ts | 37 | `description: 'API documentation for AI Novel Runtime'` | 1 |
| README.md | 1 | `# AI Novel Runtime` | 1 |
| AGENTS.md | 1 | `# AI Novel Runtime — Agent Guide` | 1 |
| AGENTS.md | 2 | (comment, may or may not match — verify) | 0 or 1 |
| AGENTS.md | 12 | `**AI Novel Runtime** 是一个...` | 1 |
| CLAUDE.md | 7 | `**AI Novel Runtime** is a pnpm monorepo ...` | 1 |
| Process.md | 1 | `# AI Novel Runtime 运行流程说明` | 1 |
| LOGIC.md | 1 | `# LOGIC.md — AI Novel Runtime 架构速览` | 1 |

Expected grep total: **11-12**. The baseline verifies nothing was already changed out of band.

**Note:** The grep pattern intentionally excludes:
- `Build novels` / `with one runtime` (different grep needed — Task 2 step 4)
- `novel-runtime` (lowercase, package name — intentionally not renamed)
- `ai-novel-runtime` (package/repo — intentionally not renamed)
- `2026-06-21-product-i18n-zh.md` (this file — not yet created when running)

If baseline is NOT 11-12, STOP — investigate before editing. (Possibilities: a previous commit already changed something, or AGENTS.md L2 comment doesn't include the product name in expected form.)

- [ ] **Step 2: Save baseline output**

Run:
```bash
cd D:/MGit-Projects/ai-novel-runtime
grep -rn "AI Novel Runtime\|AI NOVEL RUNTIME" \
  apps/web/src apps/web/index.html apps/server/src \
  README.md AGENTS.md CLAUDE.md Process.md docs/LOGIC.md docs/DESIGN.md \
  > /tmp/i18n-baseline.txt
cat /tmp/i18n-baseline.txt
```

Save the output for reference. This is what `0` should look like at the end.

---

## Task 1: Frontend Platform Branding (NavBar + Dashboard + index.html)

**Files:**
- Modify: `apps/web/src/components/NavBar.vue:15`
- Modify: `apps/web/src/components/NavBar.vue:47`
- Modify: `apps/web/src/views/Dashboard.vue:8`
- Modify: `apps/web/src/views/Dashboard.vue:10-11`
- Modify: `apps/web/index.html:13`

- [ ] **Step 1: Verify NavBar.vue L15 current text**

Run:
```bash
sed -n '15p' apps/web/src/components/NavBar.vue
```

Expected output: A line containing `<span class="cap-nav__brand-text">AI Novel Runtime</span>` (or close).

If the line doesn't contain `AI Novel Runtime`, this task is already done — skip to Step 2.

- [ ] **Step 2: Edit NavBar.vue L15 — brand text**

Open `apps/web/src/components/NavBar.vue`. Find the line containing:
```vue
<span class="cap-nav__brand-text">AI Novel Runtime</span>
```

Replace `AI Novel Runtime` (within that line) with `AI 小说工坊`. Line becomes:
```vue
<span class="cap-nav__brand-text">AI 小说工坊</span>
```

Save the file.

- [ ] **Step 3: Edit NavBar.vue L47 — about dropdown title**

In the same file, find the line containing:
```vue
<n-text>AI Novel Runtime v0.1.0</n-text>
```

Replace `AI Novel Runtime` with `AI 小说工坊`. Line becomes:
```vue
<n-text>AI 小说工坊 v0.1.0</n-text>
```

Save the file.

- [ ] **Step 4: Edit Dashboard.vue L8 — hero eyebrow**

Open `apps/web/src/views/Dashboard.vue`. Find:
```vue
AI NOVEL RUNTIME · DASHBOARD
```

Replace with:
```vue
AI 小说工坊 · 控制台
```

(The "控制台" choice is documented in spec §3.2 — see spec table footnote.)

Save the file.

- [ ] **Step 5: Edit Dashboard.vue L10-11 — hero title**

In the same file, find:
```vue
<h1 class="cap-display cap-rise" data-rise="2" style="margin: 16px 0 0">
  Build novels<br /><em>with one runtime.</em>
</h1>
```

Replace the inner content so the block becomes:
```vue
<h1 class="cap-display cap-rise" data-rise="2" style="margin: 16px 0 0">
  打造小说<br /><em>在一个 AI 小说工坊里。</em>
</h1>
```

Save the file.

- [ ] **Step 6: Edit index.html L13 — page title**

Open `apps/web/index.html`. Find:
```html
<title>AI Novel Runtime</title>
```

Replace with:
```html
<title>AI 小说工坊</title>
```

Save the file.

- [ ] **Step 7: Verify frontend changes**

Run:
```bash
cd D:/MGit-Projects/ai-novel-runtime
echo "=== NavBar L15 ==="
sed -n '15p' apps/web/src/components/NavBar.vue
echo "=== NavBar L47 ==="
sed -n '47p' apps/web/src/components/NavBar.vue
echo "=== Dashboard L8 ==="
sed -n '8p' apps/web/src/views/Dashboard.vue
echo "=== Dashboard L10-11 ==="
sed -n '10,11p' apps/web/src/views/Dashboard.vue
echo "=== index.html L13 ==="
sed -n '13p' apps/web/index.html
```

Expected:
- NavBar L15 contains `AI 小说工坊`
- NavBar L47 contains `AI 小说工坊 v0.1.0`
- Dashboard L8 contains `AI 小说工坊 · 控制台`
- Dashboard L10-11 contains `打造小说` and `在一个 AI 小说工坊里。`
- index.html L13 contains `<title>AI 小说工坊</title>`

If any line is wrong, fix before committing.

- [ ] **Step 8: Run typecheck + tests**

Run:
```bash
cd D:/MGit-Projects/ai-novel-runtime
pnpm typecheck 2>&1 | tail -20
```

Expected: All 8 workspace projects finish with `Done`. No errors.

Then:
```bash
cd D:/MGit-Projects/ai-novel-runtime
pnpm --filter web test 2>&1 | tail -15
```

Expected: `Tests 12 passed (12)`. No regressions.

If either fails, STOP — investigate root cause before committing. (Likely cause: none — these are text-only changes. But guard against accidental file corruption.)

- [ ] **Step 9: Commit frontend changes**

Run:
```bash
cd D:/MGit-Projects/ai-novel-runtime
git status --short
```

Expected: shows modifications only in `apps/web/src/components/NavBar.vue`, `apps/web/src/views/Dashboard.vue`, `apps/web/index.html`. NO unexpected files.

If unexpected files appear (e.g. unstaged leftovers from a previous task), STOP and resolve before committing. Per memory `commit 前必须 git status 确认范围` — never commit out-of-scope files.

Then commit:
```bash
cd D:/MGit-Projects/ai-novel-runtime
git add apps/web/src/components/NavBar.vue apps/web/src/views/Dashboard.vue apps/web/index.html
git commit -m "$(cat <<'EOF'
feat(web): rename brand to AI 小说工坊 + localize Dashboard hero

- NavBar brand: AI Novel Runtime -> AI 小说工坊
- NavBar about dropdown title
- Dashboard hero eyebrow: AI NOVEL RUNTIME · DASHBOARD -> AI 小说工坊 · 控制台
- Dashboard hero title: Build novels / with one runtime. -> 打造小说 / 在一个 AI 小说工坊里。
- index.html <title>: AI Novel Runtime -> AI 小说工坊

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

Expected: commit created, no error.

---

## Task 2: Backend Swagger Branding

**Files:**
- Modify: `apps/server/src/app.ts:36`
- Modify: `apps/server/src/app.ts:37`

- [ ] **Step 1: Verify app.ts L36-37 current text**

Run:
```bash
cd D:/MGit-Projects/ai-novel-runtime
sed -n '36,37p' apps/server/src/app.ts
```

Expected: shows `title: 'AI Novel Runtime API',` and `description: 'API documentation for AI Novel Runtime',`.

- [ ] **Step 2: Edit app.ts L36 — Swagger title**

Open `apps/server/src/app.ts`. Find:
```ts
title: 'AI Novel Runtime API',
```

Replace with:
```ts
title: 'AI 小说工坊 API',
```

Save the file.

- [ ] **Step 3: Edit app.ts L37 — Swagger description**

In the same file, find:
```ts
description: 'API documentation for AI Novel Runtime',
```

Replace with:
```ts
description: 'AI 小说工坊 的 API 文档',
```

Save the file.

- [ ] **Step 4: Verify backend change**

Run:
```bash
cd D:/MGit-Projects/ai-novel-runtime
sed -n '36,37p' apps/server/src/app.ts
```

Expected: shows `title: 'AI 小说工坊 API',` and `description: 'AI 小说工坊 的 API 文档',`.

- [ ] **Step 5: Run typecheck**

Run:
```bash
cd D:/MGit-Projects/ai-novel-runtime
pnpm --filter server typecheck 2>&1 | tail -10
```

Expected: `apps/server typecheck: Done`. No errors.

- [ ] **Step 6: Commit backend changes**

Run:
```bash
cd D:/MGit-Projects/ai-novel-runtime
git status --short
```

Expected: only `apps/server/src/app.ts` modified.

Then:
```bash
cd D:/MGit-Projects/ai-novel-runtime
git add apps/server/src/app.ts
git commit -m "$(cat <<'EOF'
feat(server): rename Swagger branding to AI 小说工坊

- Swagger UI title: AI Novel Runtime API -> AI 小说工坊 API
- Swagger UI description: API documentation for AI Novel Runtime -> AI 小说工坊 的 API 文档

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

Note: Tasks 1 and 2 were originally one commit in spec §9, but splitting keeps each commit focused on a single package boundary (web vs server) and makes individual rollback easier. Two small commits are better than one mixed commit.

---

## Task 3: Doc Title Sync (5 files)

**Files:**
- Modify: `README.md:1`
- Modify: `AGENTS.md:1`
- Modify: `AGENTS.md:2`
- Modify: `AGENTS.md:12`
- Modify: `CLAUDE.md:7`
- Modify: `Process.md:1`
- Modify: `docs/LOGIC.md:1`

- [ ] **Step 1: Edit README.md L1**

Open `README.md`. Find:
```markdown
# AI Novel Runtime
```

Replace with:
```markdown
# AI 小说工坊
```

Save the file.

- [ ] **Step 2: Edit AGENTS.md L1**

Open `AGENTS.md`. Find:
```markdown
# AI Novel Runtime — Agent Guide
```

Replace with:
```markdown
# AI 小说工坊 — Agent Guide
```

Save the file.

- [ ] **Step 3: Edit AGENTS.md L2**

In the same file, find the comment line at L2 containing the path:

```markdown
<!-- From: D:\MGit-Projects\ai-novel-runtime\AGENTS.md -->
```

(Note: this line is a comment auto-generated by an external tool — verify the exact text. If it contains "AI Novel Runtime" anywhere in the comment text after the path, replace that occurrence with `AI 小说工坊`. Otherwise skip this step.)

If unsure, run:
```bash
cd D:/MGit-Projects/ai-novel-runtime
sed -n '2p' AGENTS.md
```

If L2 contains `AI Novel Runtime`, edit it. If not, skip to Step 4.

- [ ] **Step 4: Edit AGENTS.md L12**

In the same file, find:
```markdown
**AI Novel Runtime** 是一个「AI 小说工程化 Runtime 系统」。
```

Replace with:
```markdown
**AI 小说工坊** 是一个「AI 小说工程化 Runtime 系统」。
```

Save the file.

- [ ] **Step 5: Edit CLAUDE.md L7**

Open `CLAUDE.md`. Find:
```markdown
**AI Novel Runtime** is a pnpm monorepo for engineering long-form novels with AI assistance.
```

Replace with:
```markdown
**AI 小说工坊** is a pnpm monorepo for engineering long-form novels with AI assistance.
```

Save the file.

- [ ] **Step 6: Edit Process.md L1**

Open `Process.md`. Find:
```markdown
# AI Novel Runtime 运行流程说明
```

Replace with:
```markdown
# AI 小说工坊 运行流程说明
```

Save the file.

- [ ] **Step 7: Edit docs/LOGIC.md L1**

Open `docs/LOGIC.md`. Find:
```markdown
# LOGIC.md — AI Novel Runtime 架构速览
```

Replace with:
```markdown
# LOGIC.md — AI 小说工坊 架构速览
```

Save the file.

- [ ] **Step 8: Verify all doc changes**

Run:
```bash
cd D:/MGit-Projects/ai-novel-runtime
echo "=== README L1 ==="
sed -n '1p' README.md
echo "=== AGENTS L1 ==="
sed -n '1p' AGENTS.md
echo "=== AGENTS L12 ==="
sed -n '12p' AGENTS.md
echo "=== CLAUDE L7 ==="
sed -n '7p' CLAUDE.md
echo "=== Process L1 ==="
sed -n '1p' Process.md
echo "=== LOGIC L1 ==="
sed -n '1p' docs/LOGIC.md
```

Expected:
- README L1: `# AI 小说工坊`
- AGENTS L1: `# AI 小说工坊 — Agent Guide`
- AGENTS L12: `**AI 小说工坊** 是一个...`
- CLAUDE L7: `**AI 小说工坊** is a pnpm monorepo ...`
- Process L1: `# AI 小说工坊 运行流程说明`
- LOGIC L1: `# LOGIC.md — AI 小说工坊 架构速览`

If any line is wrong, fix before committing.

- [ ] **Step 9: Final grep兜底 — verify 0 remaining "AI Novel Runtime" hits in target files**

Run:
```bash
cd D:/MGit-Projects/ai-novel-runtime
grep -rn "AI Novel Runtime\|AI NOVEL RUNTIME" \
  apps/web/src apps/web/index.html apps/server/src \
  README.md AGENTS.md CLAUDE.md Process.md docs/LOGIC.md docs/DESIGN.md \
  2>&1
echo "=== exit code: $? ==="
```

Expected: NO output (empty), exit code `1` (grep returns 1 when no matches found).

If any matches remain, STOP — there's a missed location. Re-grep with broader pattern:
```bash
grep -rni "novel runtime" apps/web/src apps/web/index.html apps/server/src README.md AGENTS.md CLAUDE.md Process.md docs/LOGIC.md docs/DESIGN.md 2>&1
```
Find any missed mention and edit.

Note: history spec `docs/superpowers/specs/2026-06-21-theme-switch.md` is intentionally NOT in the grep list — it contains historical references to "AI Novel Runtime" and should not be modified.

- [ ] **Step 10: Run typecheck + tests as final regression check**

Run:
```bash
cd D:/MGit-Projects/ai-novel-runtime
pnpm typecheck 2>&1 | tail -15
```

Expected: all 8 workspace projects finish with `Done`.

Then:
```bash
cd D:/MGit-Projects/ai-novel-runtime
pnpm --filter web test 2>&1 | tail -10
```

Expected: 12 tests pass.

- [ ] **Step 11: Commit doc changes**

Run:
```bash
cd D:/MGit-Projects/ai-novel-runtime
git status --short
```

Expected: shows modifications only in `README.md`, `AGENTS.md`, `CLAUDE.md`, `Process.md`, `docs/LOGIC.md`. No unexpected files.

If unexpected files appear, STOP — resolve before committing.

Then:
```bash
cd D:/MGit-Projects/ai-novel-runtime
git add README.md AGENTS.md CLAUDE.md Process.md docs/LOGIC.md
git commit -m "$(cat <<'EOF'
docs: rename product to AI 小说工坊 in 5 doc headers

- README.md: # AI Novel Runtime -> # AI 小说工坊
- AGENTS.md: title + self-reference
- CLAUDE.md: project intro
- Process.md: title
- docs/LOGIC.md: title

Doc body content unchanged — only title + first-paragraph self-reference.
Internal identifiers (package name, repo URL, localStorage keys) stay
as ai-novel-runtime.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Post-Implementation Verification

- [ ] **Step 1: Diff review**

Run:
```bash
cd D:/MGit-Projects/ai-novel-runtime
git log --oneline -5
git show --stat HEAD~2..HEAD
```

Expected: 3 commits since last push:
1. `feat(web): rename brand to AI 小说工坊 + localize Dashboard hero`
2. `feat(server): rename Swagger branding to AI 小说工坊`
3. `docs: rename product to AI 小说工坊 in 5 doc headers`

Each commit touches only its stated files. No scope creep.

- [ ] **Step 2: Full grep sweep — confirm only intentional references remain**

Run:
```bash
cd D:/MGit-Projects/ai-novel-runtime
echo "=== Should match (history spec, intentionally untouched): ==="
grep -rn "AI Novel Runtime" docs/superpowers/specs/2026-06-21-theme-switch.md | head -5
echo ""
echo "=== Should NOT match (must be empty): ==="
grep -rn "AI Novel Runtime\|AI NOVEL RUNTIME" \
  apps/web/src apps/web/index.html apps/server/src \
  README.md AGENTS.md CLAUDE.md Process.md docs/LOGIC.md docs/DESIGN.md \
  2>&1
echo ""
echo "=== Should NOT match (Build novels / with one runtime — Dashboard hero was rewritten): ==="
grep -rn "Build novels\|with one runtime" apps/web/src 2>&1
```

Expected:
- First grep: at least 1 line from theme-switch.md (historical reference, kept)
- Second grep: empty (or only the spec file we just wrote, which is `2026-06-21-product-i18n-zh.md` — verify it doesn't contain "AI Novel Runtime")
- Third grep: empty

If any of these conditions fail, fix before declaring complete.

- [ ] **Step 3: Optional manual visual check**

If `pnpm dev` is available, manually verify:
- NavBar brand shows `AI 小说工坊`
- NavBar about dropdown shows `AI 小说工坊 v0.1.0`
- Dashboard hero eyebrow shows `AI 小说工坊 · 控制台`
- Dashboard hero title shows `打造小说 / 在一个 AI 小说工坊里。`
- Browser tab title shows `AI 小说工坊`
- Swagger UI at `/api/docs` shows `AI 小说工坊 API`

If anything looks misaligned or text overflows, document in commit notes for follow-up.

---

## Notes

- **No new tests:** This is a pure-text refactor. Existing 12 tests in `theme.spec.ts` (8) and `tokens.spec.ts` (4) stay green throughout. Spec §6.1 documents this decision.
- **No typecheck changes:** No TS types affected. `pnpm typecheck` should pass identically before and after.
- **No dependency changes:** `package.json` not touched. No `pnpm install` needed.
- **No migrations / DB changes:** Backend config string-only.
- **Frequency of commits:** 3 small commits (frontend, backend, docs) instead of 2 — better per-package focus. Each commit independently revertible.
- **Rollback plan:** `git revert <commit>` for any single commit. Doc changes don't affect runtime behavior, frontend changes are purely text. All safe to revert individually.