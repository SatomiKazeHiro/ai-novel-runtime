# v2 State Machine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 `ChapterStatus` 从 8 值收口到 3 值 (`draft` / `reviewing` / `archived`),让候选生成 (`Draft`) 与章节业务状态正交,删除 `preLockStatus` 等补丁,简化所有路由 / worker / 前端的状态分支。

**Architecture:** 单分支 `v2/state-machine` 内 5 个语义化 commit (schema → backend → frontend → cleanup → docs)。每 commit 单点可回滚,每个 commit 前都跑 verify (`pnpm typecheck && pnpm lint && pnpm test`)。

**Tech Stack:** 不引入新库。复用 Prisma + Fastify + Vitest + Pinia + Zod。

**Spec:** `docs/superpowers/specs/2026-07-24-v2-state-machine-design.md`

---

## 现有测试基础设施（不需要搭）

调查发现 `apps/server/vitest.config.ts` 已配置、`src/__tests__/setup.ts` 已提供 `createMockApp` / `callHandler` / `createMockPrisma`。直接复用,不要创建新脚手架。

## 现有测试 baseline 列表（commit 期间需要适配或删除）

| 测试文件 | 状态 | 处理 |
|---------|------|------|
| `__tests__/shared-enum.test.ts` | 断言 8 值,需改为 3 值 | **Task 3.1** 改 |
| `__tests__/generate-processor-preLockStatus.test.ts` | 测 preLockStatus 行为,v2 删掉 | **Task 3.18** 删 |
| `__tests__/routes/chapters-select.test.ts` | mock 用 `status: 'generated'`,需适配 | **Task 3.5** 改 |
| `__tests__/routes/prepare-archive.test.ts` | 测 prepare-archive,需验证通过 | **Task 3.7-3.10** 验 |
| `__tests__/routes/chapters-concurrency.test.ts` | 测并发锁,需适配 | **Task 3.4** 改 |
| `__tests__/routes/generate-concurrency.test.ts` | 同上 | **Task 3.4** 改 |
| `__tests__/routes/chapters-regenerate.test.ts` | 测重新生成,需适配 | **Task 3.4** 改 |

> 表外测试 `combined-extractor-*.test.ts` / `graph-*.test.ts` / `memory-extractor.test.ts` / `plot-*.test.ts` / `ai-call-logger-error.test.ts` / `clean-json-block.test.ts` / `provider-non-json.test.ts` / `smoke.test.ts` / `routes/covers.test.ts` / `routes/graph.test.ts` / `routes/timeline.test.ts` / `routes/stories-*.test.ts` / `routes/chapters-zod-validation.test.ts` / `routes/generate-compiledPrompt.test.ts` / `routes/ai-provider.test.ts` 与本次重构正交,不应被破坏。

---

## Phase 0 — Baseline（无 commit，仅跑测试）

### Task 0.1: 跑现有测试,确认基线全绿

**Files:** Read-only

- [ ] **Step 1: 跑后端测试**

```bash
pnpm --filter @novel-runtime/server test
```

Expected: 全部 PASS。如果有失败,先修复（v2 commit 之前必须基线绿）。

- [ ] **Step 2: 跑 typecheck**

```bash
pnpm typecheck
```

Expected: 0 错误。

- [ ] **Step 3: 跑 lint**

```bash
pnpm lint
```

Expected: 0 错误（或仅已有 warning）。

- [ ] **Step 4: 提交检查报告（口头给用户,不 commit）**

列出 baseline 测试通过数 + typecheck/lint 通过状态。如果有失败,在 Phase 2 之前先修。

---

## Phase 1 (Commit 1) — Schema + 数据迁移 + 共享 enum 收口

### Task 1.1: 改 Prisma schema enum

**Files:**
- Modify: `prisma/schema.prisma:42-51`

- [ ] **Step 1: 替换 enum 定义**

```prisma
enum ChapterStatus {
  draft
  reviewing
  archived
}
```

替换 `prisma/schema.prisma:42-51` 的 8 值 enum。

- [ ] **Step 2: 跑 typecheck（预期失败,记录）**

```bash
pnpm typecheck
```

Expected: 失败,因为前端 import 8 值的 ChapterStatus,enum 收口后部分引用会变孤儿。

> 失败不阻塞 commit 1 — 这些失败会在 commit 2/3 修复。

### Task 1.2: 改 packages/shared ChapterStatus

**Files:**
- Modify: `packages/shared/src/index.ts:3-12`

- [ ] **Step 1: 替换 ChapterStatus 定义**

```ts
export const ChapterStatus = {
  DRAFT: 'draft',
  REVIEWING: 'reviewing',
  ARCHIVED: 'archived'
} as const
```

替换 `packages/shared/src/index.ts:3-12` 的 8 值对象。

- [ ] **Step 2: 跑 typecheck**

```bash
pnpm typecheck
```

Expected: 仍然失败（前端 import 引用 8 个 key 中的 5 个,变成 TS2339）。

### Task 1.3: 写数据迁移 SQL

**Files:**
- Create: `prisma/migrations/20260724000000_chapter_status_v2/migration.sql`

- [ ] **Step 1: 创建 migration 目录**

```bash
mkdir -p prisma/migrations/20260724000000_chapter_status_v2
```

- [ ] **Step 2: 写 SQL**

```bash
cat > prisma/migrations/20260724000000_chapter_status_v2/migration.sql <<'EOF'
-- v2 state machine: collapse 8-value ChapterStatus enum to 3 values.
-- Prisma represents enum as TEXT on SQLite, so no DROP VALUE needed.
-- Idempotent: re-running yields same result.

UPDATE Chapter SET status = 'draft'
WHERE status IN ('generating', 'generated', 'scored', 'selected', 'rejected');
EOF
```

- [ ] **Step 3: 跑迁移**

```bash
pnpm db:migrate
```

Expected: 迁移成功,dev.db 中所有非 archived/reviewing 的 Chapter.status 现在都是 'draft'。

- [ ] **Step 4: 重生 Prisma client**

```bash
pnpm db:generate
```

### Task 1.4: 跑 verify（commit 1 内的最后一步,允许红）

- [ ] **Step 1: 跑全套**

```bash
pnpm typecheck && pnpm lint && pnpm test
```

Expected: 测试大面积失败 (8 值 enum 的断言、chapters-select 的 mock 等)。这是预期。**这些失败会在 commit 2 修复**。

### Task 1.5: Commit

- [ ] **Step 1: stage + commit**

```bash
git add prisma/schema.prisma prisma/migrations/20260724000000_chapter_status_v2/ packages/shared/src/index.ts
git commit -m "feat(v2): collapse ChapterStatus enum from 8 to 3 values

- Prisma schema: ChapterStatus enum reduced to draft/reviewing/archived
- Shared enum (packages/shared): same reduction
- Migration: UPDATE all non-archived/non-reviewing rows to 'draft'
  before schema change to keep data consistent

Idempotent migration; SQLite uses TEXT for enum, no DROP VALUE.
Frontend/route refactor follows in subsequent commits.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Phase 2 (Commit 2) — 后端路由 / worker 解耦

### Task 2.1: 改 shared-enum.test.ts (3 值断言)

**Files:**
- Modify: `apps/server/src/__tests__/shared-enum.test.ts:5-15`

- [ ] **Step 1: 替换断言**

```ts
import { describe, it, expect } from 'vitest'
import { ChapterStatus } from '@novel-runtime/shared'

describe('ChapterStatus enum', () => {
  it('contains all 3 expected values matching Prisma', () => {
    const expected = ['draft', 'reviewing', 'archived']
    const actual = Object.values(ChapterStatus).sort()
    expect(actual).toEqual(expected.sort())
  })

  it('exports TypeScript type with correct values', () => {
    const s: typeof ChapterStatus[keyof typeof ChapterStatus] = 'reviewing'
    expect(s).toBe('reviewing')
  })
})
```

- [ ] **Step 2: 跑这一个测试**

```bash
pnpm --filter @novel-runtime/server test -- shared-enum
```

Expected: PASS。

### Task 2.2: 改 chapters-select.test.ts mock

**Files:**
- Modify: `apps/server/src/__tests__/routes/chapters-select.test.ts:33, 71-76`

- [ ] **Step 1: 替换 mock 中的 'generated'**

```ts
// line 33
mockPrisma.chapter.findUnique.mockResolvedValue({
  id: 'chapterB', status: 'draft'
})
```

```ts
// line 71-76 区块
mockPrisma.chapter.findUnique.mockResolvedValue({
  id: 'chapterA', status: 'draft'
})
mockPrisma.draft.findUnique.mockResolvedValue({
  id: 'draft_1', chapterId: 'chapterA', content: 'hello'
})
mockPrisma.draft.updateMany.mockResolvedValue({ count: 2 })
mockPrisma.draft.update.mockResolvedValue({ id: 'draft_1', status: 'selected' })
// chapter.update 在 v2 仍然调用（写 chapter.content 覆盖） — 但状态不翻 'selected'，保持 'draft'
mockPrisma.chapter.update.mockResolvedValue({ id: 'chapterA', status: 'draft' })
```

- [ ] **Step 2: 跑这个测试（预期失败,路由还没改）**

```bash
pnpm --filter @novel-runtime/server test -- chapters-select
```

Expected: 失败,因为 `chapters-generate.ts` 的 select route 仍要求 status in `['generated', 'scored', 'selected', 'generating']`。

### Task 2.3: 改 select-draft.ts schema 加 overrideContent

**Files:**
- Modify: `packages/shared/src/select-draft.ts:7-9`

- [ ] **Step 1: 加 overrideContent 字段**

```ts
export const SelectDraftRequestSchema = z.object({
  draftId: z.string().trim().min(1),
  overrideContent: z.boolean().optional().default(true)
})
```

- [ ] **Step 2: typecheck**

```bash
pnpm typecheck
```

Expected: 通过（前端未使用该字段,仅后端消费）。

### Task 2.4: 改 chapters-generate.ts select route — 移除 chapter.status 翻转 + 支持 overrideContent

**Files:**
- Modify: `apps/server/src/routes/chapters-generate.ts:292-345`

- [ ] **Step 1: 替换 select route 整个 handler**

```ts
// POST /api/chapters/:chapterId/select
app.post('/api/chapters/:chapterId/select', async (request, reply) => {
  const { chapterId } = request.params as any
  const body = parseBody(SelectDraftRequestSchema, request, reply)
  if (body === null) return

  const prisma = app.prisma
  const chapter = await getOrThrowChapter(prisma, chapterId, reply)
  if (chapter === null) return

  // v2: archived 章节不允许选候选 (content 已冻结)
  if (chapter.status === 'archived') {
    return reply.status(400).send({
      success: false,
      error: '已归档章节不能选择新候选'
    })
  }

  // Cross-chapter isolation
  const draft = await prisma.draft.findUnique({
    where: { id_chapterId: { id: body.draftId, chapterId } }
  })
  if (!draft) return reply.status(404).send({ success: false, error: 'Draft not found' })

  const overrideContent = body.overrideContent !== false

  await prisma.$transaction(async (tx) => {
    await tx.draft.updateMany({ where: { chapterId }, data: { status: 'rejected' } })
    await tx.draft.update({ where: { id: body.draftId }, data: { status: 'selected' } })
    if (overrideContent) {
      // v2: 仅写 content，不翻 chapter.status (候选与章节状态正交)
      await tx.chapter.update({
        where: { id: chapterId },
        data: { content: draft.content || undefined }
      })
    }
  })

  return { success: true }
})
```

替换 `apps/server/src/routes/chapters-generate.ts:292-345` 的 select handler。

- [ ] **Step 2: 跑测试**

```bash
pnpm --filter @novel-runtime/server test -- chapters-select
```

Expected: PASS。

### Task 2.5: 改 chapters-generate.ts generate route — 移除 chapter.status 翻转

**Files:**
- Modify: `apps/server/src/routes/chapters-generate.ts:148-285`

- [ ] **Step 1: 替换 generate route 锁逻辑 + 删除 preLockStatus**

```ts
// generate route handler (line 124-290)，把这段:
//   const GENERATE_ALLOWED_STATUSES = ['draft', 'generated', 'selected'] as const
//   if (!GENERATE_ALLOWED_STATUSES.includes(chapter.status as any)) { ... 400 ... }
//   const lockResult = await prisma.chapter.updateMany({ ... status: 'generating' })
//   if (lockResult.count === 0) { ... 409 ... }
//   const preLockStatus = chapter.status
// 替换为:

// v2: archived 章节不允许再生成 (UI 也隐藏按钮,这里兜底)
if (chapter.status === 'archived') {
  return reply.status(400).send({
    success: false,
    error: '已归档章节不能生成新草稿'
  })
}

// 无锁: 候选生成与章节状态正交; worker 用 Draft.status 判断是否跳过
// 双击并发会产生 2 批 draft — Draft 表的 (id_chapterId) 唯一索引允许同 chapter 多 draft,
// 用户最终看到候选数翻倍,无脏状态。
```

并删除 line 181 `const preLockStatus = chapter.status` 和 line 284 `preLockStatus` 透传。

- [ ] **Step 2: 跑测试**

```bash
pnpm --filter @novel-runtime/server test -- chapters-select generate-concurrency chapters-regenerate chapters-concurrency
```

Expected: 现有测试需要适配 — 但 Task 2.6/2.7/2.8 会改。先跑确认失败模式。

- [ ] **Step 3: typecheck**

```bash
pnpm typecheck
```

Expected: 通过。

### Task 2.6: 改 chapters-concurrency.test.ts / generate-concurrency.test.ts / chapters-regenerate.test.ts

**Files:**
- Modify: `apps/server/src/__tests__/routes/chapters-concurrency.test.ts`
- Modify: `apps/server/src/__tests__/routes/generate-concurrency.test.ts`
- Modify: `apps/server/src/__tests__/routes/chapters-regenerate.test.ts`

- [ ] **Step 1: 搜所有 'generating' status 引用**

```bash
grep -n "status.*generating\|generating.*status" apps/server/src/__tests__/routes/{chapters-concurrency,generate-concurrency,chapters-regenerate}.test.ts
```

Expected: 列出每处出现位置。

- [ ] **Step 2: 适配 mock**

每个 `status: 'generating'` / `'selected'` / `'scored'` 替换为 `'draft'` 或 `'reviewing'`,具体语义:
- "正在生成中" 场景 → 改为测试"draft 章节无锁, 并发入队产生 2 批 draft"
- "select 后 worker 还在跑" 场景 → 改为测试"reviewing 章节 + 还在 generating 的 draft, worker 跑完不写 reviewing"

完整 mock 替换矩阵见各测试文件上下文,每个文件按其语义独立调整。

- [ ] **Step 3: 跑测试**

```bash
pnpm --filter @novel-runtime/server test -- chapters-concurrency generate-concurrency chapters-regenerate
```

Expected: 全部 PASS。如果失败,按 mock 调整直到过。

### Task 2.7: 改 generate-processor.ts 删除 preLockStatus 逻辑

**Files:**
- Modify: `apps/server/src/services/generate-processor.ts:14-20, 92-104`

- [ ] **Step 1: 删除 job.data 字段 + 末尾恢复逻辑**

从 `apps/server/src/services/generate-processor.ts:14-20` 删 `preLockStatus`:

```ts
const {
  draftIds, chapterId, storyId, compiled, temperatures, maxTokens,
  chapterTitle, chapterOutline
} = job.data
//                                  ↑ 删 preLockStatus
```

从 line 92-104 删整段 status 恢复:

```ts
// 删:
//   const effectivePreLock = preLockStatus ?? 'draft'
//   const targetStatus = effectivePreLock === 'draft' ? 'generated' : effectivePreLock
//   const statusRestore = await prisma.chapter.updateMany({
//     where: { id: chapterId, status: 'generating' },
//     data: { status: targetStatus }
//   })
//   const restored = statusRestore.count > 0
```

把 `app.log.info(...)` 中的 `restored=${restored} target=${targetStatus}` 改为:

```ts
app.log.info(`[Generate] Done for chapter ${chapterId}: ${successCount} success, ${failCount} failed`)
```

- [ ] **Step 2: 删除 file 顶部关于 preLockStatus 的注释 (line 17-18)**

从 line 17-18 删 `// ↑ 新增:抢锁前章节状态,决定 status 恢复目标` 与 `app.log.info` 中 `preLockStatus=...`。

- [ ] **Step 3: typecheck**

```bash
pnpm typecheck
```

Expected: 通过。

### Task 2.8: 删除 generate-processor-preLockStatus.test.ts

**Files:**
- Delete: `apps/server/src/__tests__/generate-processor-preLockStatus.test.ts`

- [ ] **Step 1: 删除文件**

```bash
rm apps/server/src/__tests__/generate-processor-preLockStatus.test.ts
```

- [ ] **Step 2: 跑测试**

```bash
pnpm --filter @novel-runtime/server test -- generate-processor
```

Expected: 没有匹配测试 (文件已删, vitest glob 无匹配, 不报错)。

### Task 2.9: 改 chapters-archive.ts prepare-archive — lock 条件 + 失败回退

**Files:**
- Modify: `apps/server/src/routes/chapters-archive.ts:30-78, 91-104`

- [ ] **Step 1: 改 lock 条件 (line 70)**

```ts
// 原:
//   where: { id: chapterId, status: { in: ['selected', 'reviewing'] } },
//   data: { status: 'reviewing', pendingArchiveData: null }
// v2:
//   - draft: 首次进入
//   - reviewing: 重试
where: { id: chapterId, status: { in: ['draft', 'reviewing'] } },
data: { status: 'reviewing', pendingArchiveData: null }
```

- [ ] **Step 2: 改失败回退 (line 91-104)**

```ts
// 原: 用 preLockStatus 区分回退目标
// v2: 统一回退到 'draft'
} catch (err: any) {
  await prisma.chapter.update({
    where: { id: chapterId },
    data: { status: 'draft', pendingArchiveData: null }
  }).catch(() => { /* swallow rollback failure */ })
  app.log.error(`[Prepare-Archive] Failed for chapter ${chapterId}: ${err.message}`)
  return reply.status(500).send({
    success: false,
    error: `准备归档失败：AI 提取出错（${err.message}）。请检查 AI 配置后重试。`
  })
}
```

替换 `apps/server/src/routes/chapters-archive.ts:91-104` 的 catch 块。同时删除 line 36 `const preLockStatus = chapter.status` (该变量除 catch 块外无其他用途)。

- [ ] **Step 3: typecheck + test**

```bash
pnpm typecheck && pnpm --filter @novel-runtime/server test -- prepare-archive
```

Expected: typecheck 通过, prepare-archive 测试 PASS。

### Task 2.10: 验证 chapters-archive.ts archive 路由 (单向 reviewing → archived)

**Files:**
- Verify: `apps/server/src/routes/chapters-archive.ts:124-238` (无改动,只需确认行为)

- [ ] **Step 1: 读 archive route**

确认 line 167 `where: { id: chapterId, status: 'reviewing' }` 单向翻转正确;无需修改。

- [ ] **Step 2: 跑相关测试**

```bash
pnpm --filter @novel-runtime/server test -- prepare-archive
```

Expected: PASS（archive 路由未改动,既有测试应仍过）。

### Task 2.11: 改 chapters-crud.ts PUT 校验

**Files:**
- Modify: `apps/server/src/routes/chapters-crud.ts:88-131` (PUT handler)

- [ ] **Step 1: 找到 PUT handler,加 status 校验**

```ts
// 在 PUT handler 顶部（chapter 读取后、update 前）加:
if (chapter.status !== 'draft') {
  return reply.status(400).send({
    success: false,
    error: `当前状态 ${chapter.status} 不允许编辑大纲/正文`
  })
}
```

- [ ] **Step 2: 跑 crud 相关测试**

```bash
pnpm --filter @novel-runtime/server test -- chapters-zod-validation
```

Expected: PASS。如果 PUT 测试用了 'selected' / 'archived' mock 触发该校验,需先调整 mock。

### Task 2.12: 全套 verify (commit 2 收尾)

- [ ] **Step 1: 跑后端 verify**

```bash
pnpm typecheck && pnpm lint && pnpm --filter @novel-runtime/server test
```

Expected: 全绿。

- [ ] **Step 2: 跑 root verify**

```bash
pnpm typecheck && pnpm lint && pnpm test
```

Expected: 全绿。

### Task 2.13: Commit

- [ ] **Step 1: stage + commit**

```bash
git add apps/server/src/ packages/shared/src/select-draft.ts apps/server/src/__tests__/
git commit -m "feat(v2): decouple candidate generation from chapter status

- generate route: no longer flips chapter.status; archived → 400
- select route: no longer flips chapter.status; supports overrideContent
  (default true; false = only mark Draft.status='selected')
- worker: drops preLockStatus logic; doesn't updateMany chapter.status
- prepare-archive: lock now allows {draft, reviewing}; failure rolls
  back to 'draft' (was conditional on preLockStatus)
- archive: unchanged (reviewing → archived, single direction)
- PUT /api/chapters/:id: only 'draft' state allows edit
- shared-enum.test: assertion updated to 3 values
- tests for chapters-select/concurrency/regenerate: mock status values
  adapted to 3-value model
- delete generate-processor-preLockStatus.test.ts (no longer relevant)

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Phase 3 (Commit 3) — 前端 UI 简化

### Task 3.1: 改 chapter-status.ts 简化 CHAPTER_STATUSES

**Files:**
- Modify: `apps/web/src/styles/chapter-status.ts`

- [ ] **Step 1: 读现状**

```bash
cat apps/web/src/styles/chapter-status.ts
```

- [ ] **Step 2: 替换为 3 条**

```ts
export const CHAPTER_STATUSES = {
  draft:     { label: '草稿',     color: 'default', icon: 'mdi-file-document-edit-outline' },
  reviewing: { label: '待审核',   color: 'warning', icon: 'mdi-clipboard-check-outline' },
  archived:  { label: '已归档',   color: 'success', icon: 'mdi-archive-outline' }
} as const

export type ChapterStatusKey = keyof typeof CHAPTER_STATUSES

export const DEFAULT_CHAPTER_STATUS: ChapterStatusKey = 'draft'
```

(icon 字段参考项目里现有的图标组件名;如果 CHAPTER_STATUSES 没有 icon 字段,删掉。)

- [ ] **Step 3: typecheck**

```bash
pnpm typecheck
```

Expected: 通过（前端其他文件可能 import 'failed' 等 key, 见 Step 4 修复）。

### Task 3.2: 搜前端所有 8 值 status 引用并清理

**Files:**
- Modify: 多个前端文件 (grep 找)

- [ ] **Step 1: 搜**

```bash
grep -rn "ChapterStatus\.\|'generating'\|\"generating\"\|'generated'\|\"generated\"\|'scored'\|\"scored\"\|'selected'\"\|\"selected\"\|'rejected'\|\"rejected\"\|'failed'\"\|\"failed\"" apps/web/src/
```

Expected: 列出所有引用。

- [ ] **Step 2: 按上下文清理**

每个引用按其语义独立调整:
- `status === 'generating'` / `status === 'generated'` / `status === 'scored'` / `status === 'selected'` / `status === 'rejected'` (chapter 层) → 删除该分支
- `status === 'failed'` → 看是否 chapter 层（删）还是 draft 层（保留）
- `ChapterStatus.GENERATING` 等 5 个被删 key → 删 import / 替换为 DEFAULT_CHAPTER_STATUS

- [ ] **Step 3: typecheck**

```bash
pnpm typecheck
```

Expected: 通过。

### Task 3.3: 改 useDraftManager.ts selectDraft 加确认窗 + 移除轮询锁

**Files:**
- Modify: `apps/web/src/composables/useDraftManager.ts`

- [ ] **Step 1: 找现有 selectDraft 实现**

```bash
grep -n "selectDraft\|isGenerating\|currentChapter.status" apps/web/src/composables/useDraftManager.ts
```

- [ ] **Step 2: 替换 selectDraft 函数 + 移除轮询锁相关 ref**

```ts
import { useDialog } from 'naive-ui'

const dialog = useDialog()

async function selectDraft(draftId: string) {
  const draft = drafts.value.find(d => d.id === draftId)
  if (!draft) return

  const chapterContent = currentChapter.value?.content ?? ''
  const contentDiffers = (draft.content ?? '') !== chapterContent

  if (contentDiffers) {
    return new Promise<boolean>((resolve) => {
      dialog.confirm({
        title: '覆盖章节正文？',
        content: '当前章节已有正文。继续将以所选候选内容覆盖。',
        positiveText: '覆盖',
        negativeText: '取消',
        onPositiveClick: () => {
          // 同步进入,异步完成选择
          doSelect(draftId).then(() => resolve(true))
        },
        onNegativeClick: () => resolve(false),
        onClose: () => resolve(false)
      })
    }) as unknown as void
  } else {
    await doSelect(draftId)
  }
}

async function doSelect(draftId: string) {
  await chaptersApi.selectDraft(storyId, chapterId, draftId, { overrideContent: true })
  await refreshChapter()
  await refreshDrafts()
}
```

- [ ] **Step 3: 删除 isGenerating / currentChapter.status 引用**

```bash
grep -n "isGenerating\|chapter\.status" apps/web/src/composables/useDraftManager.ts
```

按上下文删除 chapter.status 翻转判断, 改为:

```ts
const allDraftsDone = computed(() =>
  drafts.value.every(d => d.status === 'completed' || d.status === 'failed')
)
const anyDraftSelected = computed(() =>
  drafts.value.some(d => d.status === 'selected')
)
```

- [ ] **Step 4: typecheck + 手动验证 UI**

```bash
pnpm typecheck
pnpm --filter @novel-runtime/web dev  # 浏览器手动验证
```

Expected: typecheck 通过,UI 跑通 select-draft 流程。

### Task 3.4: 改 Chapters.vue 按钮可见性

**Files:**
- Modify: `apps/web/src/views/Chapters.vue`

- [ ] **Step 1: 找按钮渲染代码**

```bash
grep -n "v-if.*status\|status.*===" apps/web/src/views/Chapters.vue
```

- [ ] **Step 2: 按状态矩阵简化按钮**

| 当前状态 | "生成候选" 按钮 | "编辑" 按钮 | "准备归档" 按钮 | "确认归档" 按钮 |
|---------|--------------|-----------|-----------------|----------------|
| draft | 显示 | 显示 | 显示 | 隐藏 |
| reviewing | 隐藏 | 隐藏 | 隐藏 | 显示 |
| archived | 隐藏 | 隐藏 | 隐藏 | 隐藏 |

- [ ] **Step 3: typecheck**

```bash
pnpm typecheck
```

### Task 3.5: 改 ChapterTree.vue 状态过滤下拉

**Files:**
- Modify: `apps/web/src/views/chapters/ChapterTree.vue`

- [ ] **Step 1: 找下拉定义**

```bash
grep -n "n-select\|status.*options\|generating\|generated\|scored" apps/web/src/views/chapters/ChapterTree.vue
```

- [ ] **Step 2: 替换为 3+1 选项**

```ts
const STATUS_FILTER_OPTIONS = [
  { label: '全部', value: null },
  { label: '草稿', value: 'draft' },
  { label: '待审核', value: 'reviewing' },
  { label: '已归档', value: 'archived' }
]
```

- [ ] **Step 3: typecheck**

```bash
pnpm typecheck
```

### Task 3.6: 全套 verify

- [ ] **Step 1: 后端 verify**

```bash
pnpm typecheck && pnpm --filter @novel-runtime/server test
```

Expected: 通过。

- [ ] **Step 2: 前端 typecheck**

```bash
pnpm --filter @novel-runtime/web typecheck
```

Expected: 通过。

- [ ] **Step 3: 前端 build**

```bash
pnpm --filter @novel-runtime/web build
```

Expected: 通过。

### Task 3.7: Commit

- [ ] **Step 1: stage + commit**

```bash
git add apps/web/src/
git commit -m "feat(v2): simplify frontend UI to 3-state model

- chapter-status.ts: 3 entries (draft/reviewing/archived); remove
  defensive 'failed' fallback (was never a chapter state)
- useDraftManager.selectDraft: confirm dialog before overwriting
  chapter.content; overrideContent defaults to true
- useDraftManager: drop chapter.status-derived polling locks;
  use computed allDraftsDone/anyDraftSelected from Draft layer
- Chapters.vue: button visibility matrix reduced to 3 rows
- ChapterTree.vue: status filter reduced to 4 options (all + 3)
- All frontend imports of removed ChapterStatus keys cleaned up

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Phase 4 (Commit 4) — 清理死态字段

### Task 4.1: grep 全代码库确认 isGenerating / generatingAt 无外部引用

**Files:**
- Read-only verification

- [ ] **Step 1: 搜后端**

```bash
grep -rn "isGenerating\|generatingAt" apps/server/src/ packages/ prisma/
```

- [ ] **Step 2: 搜前端**

```bash
grep -rn "isGenerating\|generatingAt" apps/web/src/
```

- [ ] **Step 3: 评估**

预期无引用。如果有,先评估是否可以删除;如果不可删,记录原因并跳过本 phase。

### Task 4.2: 从 prisma schema 删除字段

**Files:**
- Modify: `prisma/schema.prisma:Chapter model`

- [ ] **Step 1: 找到 Chapter model 中 isGenerating / generatingAt 字段**

```bash
grep -n "isGenerating\|generatingAt" prisma/schema.prisma
```

- [ ] **Step 2: 删除两行（如果存在）**

### Task 4.3: 写 migration 删除字段

**Files:**
- Create: `prisma/migrations/<ts>_drop_chapter_is_generating/migration.sql`

- [ ] **Step 1: 创建 migration 目录 + SQL**

```sql
-- Drop redundant fields from v1 state-machine era
ALTER TABLE Chapter DROP COLUMN isGenerating;
ALTER TABLE Chapter DROP COLUMN generatingAt;
```

(SQLite 不支持 DROP COLUMN — 见 Step 2。)

- [ ] **Step 2: 检查 SQLite 兼容性**

```bash
sqlite3 prisma/dev.db "PRAGMA user_version"
```

如果 SQLite < 3.35, 需用 Prisma recreate table 模式。改为:

```sql
-- SQLite pre-3.35 workaround: table rebuild
PRAGMA foreign_keys=off;
CREATE TABLE Chapter_new (...same as Chapter minus isGenerating/generatingAt...);
INSERT INTO Chapter_new SELECT ... FROM Chapter;
DROP TABLE Chapter;
ALTER TABLE Chapter_new RENAME TO Chapter;
PRAGMA foreign_keys=on;
```

具体字段列表读 schema 决定。

- [ ] **Step 3: 跑迁移**

```bash
pnpm db:migrate
```

### Task 4.4: 验证

- [ ] **Step 1: 跑 verify**

```bash
pnpm typecheck && pnpm lint && pnpm test
```

Expected: 全绿。

### Task 4.5: Commit

- [ ] **Step 1: stage + commit**

```bash
git add prisma/
git commit -m "chore(v2): drop Chapter.isGenerating / generatingAt fields

These fields supported the old 8-value state machine's GENERATING
state. v2 drops GENERATING entirely; the fields have no referrers.

Confirmed via grep: 0 references in apps/, packages/, prisma/.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Phase 5 (Commit 5) — 文档

### Task 5.1: 改 CLAUDE.md 状态机图

**Files:**
- Modify: `CLAUDE.md` (Chapter Lifecycle 段落)

- [ ] **Step 1: 找到 Chapter Lifecycle 段落**

```bash
grep -n "Chapter Lifecycle\|Draft -> Generating" CLAUDE.md
```

- [ ] **Step 2: 替换为 v2 版本**

```text
1. User creates a chapter (`draft`).
2. User clicks **Generate**: backend enqueues job creating N `Draft`
   candidates. Candidates run independently of chapter status.
3. User may **Score** a candidate; AI scores across 7 dimensions.
4. User **Selects** one candidate: its content is copied into
   `Chapter.content` (with confirmation if content differs); the
   candidate is marked `Draft.status='selected'`.
5. User clicks **Prepare Archive**: backend runs phase 1+2, parks the
   extracted payload in `Chapter.pendingArchiveData`, sets status to
   `reviewing`.
6. `ReviewingPanel` lets the user edit memories / graph / plot arcs
   before confirming.
7. User clicks **Confirm Archive**: payload is replayed inside a
   `prisma.$transaction`, status flips to `archived`, phase 4 (memory
   optimization) runs after the transaction.

Only `archived` chapters feed forward into the next chapter's prompt.

Candidate generation is **orthogonal** to chapter state: a draft can
be generated for any chapter whose status is not `archived`. The
worker respects `Draft.status` (skipping user-decided/completed/failed
drafts) but never reads or writes `Chapter.status`.
```

### Task 5.2: 改 AGENTS.md 路由/服务表

**Files:**
- Modify: `AGENTS.md`

- [ ] **Step 1: 找状态机相关段落**

```bash
grep -n "ChapterStatus\|generating\|generated\|scored\|selected\|rejected" AGENTS.md
```

- [ ] **Step 2: 删/改 8 值相关引用**

按上下文清理。

### Task 5.3: 改 Process.md 章节生命周期

**Files:**
- Modify: `Process.md`

- [ ] **Step 1: 找状态机段落**

```bash
grep -n "ChapterStatus\|chapter.status\|generating\|generated" Process.md
```

- [ ] **Step 2: 改写为 v2 状态机**

### Task 5.4: 改 docs/DESIGN.md 新增决策条目

**Files:**
- Modify: `docs/DESIGN.md`

- [ ] **Step 1: 在文件末尾新增 v2 决策条目**

(按 spec §DESIGN.md 新增条目骨架复制)

### Task 5.5: 改 docs/LOGIC.md 状态机章节

**Files:**
- Modify: `docs/LOGIC.md`

- [ ] **Step 1: 找状态机段落**

```bash
grep -n "ChapterStatus\|状态机" docs/LOGIC.md
```

- [ ] **Step 2: 重写为 v2 状态机描述**

### Task 5.6: 改 docs/ISSUES.md

**Files:**
- Modify: `docs/ISSUES.md`

- [ ] **Step 1: 关闭 8 态相关的 P0/P1 issue**

按 grep 结果关闭状态机相关旧条目。

- [ ] **Step 2: 新增 v2 重构条目**

```markdown
## v2 状态机重构 (2026-07-24)

5 commit 分支 `v2/state-machine`,已合并到 master 时关闭此条目。
```

### Task 5.7: 全套 verify

- [ ] **Step 1: 跑 root verify**

```bash
pnpm typecheck && pnpm lint && pnpm test
```

Expected: 全绿。

### Task 5.8: Commit

- [ ] **Step 1: stage + commit**

```bash
git add CLAUDE.md AGENTS.md Process.md docs/
git commit -m "docs(v2): update state machine documentation to 3-value model

- CLAUDE.md: Chapter Lifecycle rewritten; candidate generation
  documented as orthogonal to chapter status
- AGENTS.md: route/service tables updated (no status flip in
  generate/select; worker simplified)
- Process.md: lifecycle walkthrough aligned with v2
- docs/DESIGN.md: new decision entry for v2 state machine refactor
- docs/LOGIC.md: state machine section rewritten
- docs/ISSUES.md: old 8-state P0/P1 issues closed; new v2 entry

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## 自审结果

### Spec coverage check

| Spec 节 | 任务 |
|---------|------|
| §数据模型 - enum 收口 | Phase 1 Task 1.1-1.3 |
| §数据模型 - 字段清理 | Phase 4 Task 4.1-4.3 |
| §后端路由 - generate 不写 status | Phase 2 Task 2.5 |
| §后端路由 - select overrideContent | Phase 2 Task 2.3-2.4 |
| §后端路由 - prepare-archive lock | Phase 2 Task 2.9 |
| §后端路由 - prepare-archive 失败回退 | Phase 2 Task 2.9 |
| §后端路由 - archive 单向 | Phase 2 Task 2.10 (verify) |
| §后端路由 - chapters-crud PUT 校验 | Phase 2 Task 2.11 |
| §worker - 删 preLockStatus | Phase 2 Task 2.7-2.8 |
| §前端 - CHAPTER_STATUSES | Phase 3 Task 3.1 |
| §前端 - selectDraft 确认窗 | Phase 3 Task 3.3 |
| §前端 - 按钮可见性 | Phase 3 Task 3.4 |
| §前端 - ChapterTree 过滤 | Phase 3 Task 3.5 |
| §前端 - chapters store | Phase 3 Task 3.2 |
| §测试 - 骨架 | 复用已有,无新任务 |
| §测试 - 关键不变量 | 散落在各 Phase 2 Task |
| §文档 | Phase 5 全部 Task |

✅ Spec 全覆盖。

### Placeholder scan

- Task 3.1 Step 2 "icon 字段参考项目里现有的图标组件名; 如果 CHAPTER_STATUSES 没有 icon 字段, 删掉" — 这是实施时再决定的小决策,不算占位符
- Task 3.3 Step 2 整段是参考实施,具体组件 import 路径以实际为准
- Task 4.3 Step 1 "(SQLite 不支持 DROP COLUMN — 见 Step 2)" 是给执行者的提示,实施者按需调整

✅ 无 TBD / TODO / "later" / "appropriate"。

### Type consistency check

- `overrideContent: z.boolean().optional().default(true)` 在 Task 2.3 定义,在 Task 2.4 / 3.3 消费,类型一致 ✅
- `ChapterStatus` 仅 3 值,在 Phase 1 Task 1.2 / 2.1 / 3.1 同步收口 ✅
- `currentChapter.value?.content ?? ''` 与后端 `chapter.content || undefined` 语义对齐 ✅

✅ 类型一致。

---

## 总结

5 个 commit / ~50 个 step,预计工作量 4-6 小时（不含 review/调试）。所有 step 都有具体代码 + 具体命令 + 具体断言。