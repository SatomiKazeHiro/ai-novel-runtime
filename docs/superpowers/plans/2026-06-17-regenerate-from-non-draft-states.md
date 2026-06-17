# 重新生成候选（generated / selected 状态）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让章节在 `generated` / `selected` 状态也能调 generate,纯加法追加新候选,不动旧候选、不动 `Chapter.content`、不重置已选 draft 标记。

**Architecture:** generate 路由把"抢锁前状态"作为 `preLockStatus` 透传到 queue job;generate-processor 完成后用 `preLockStatus` 决定 chapter.status 的恢复目标（替代写死 'generated'）。select 路由的原子锁扩到包含 `selected`,让用户能切换到更好的新候选。UI 加按钮 v-if + 动态文案 + token 成本确认对话框 + 候选 Tab 的 ✓ 标记。

**Tech Stack:** Fastify + Prisma + BullMQ (server);Vue 3 + Naive UI (web);Vitest (tests). 状态机/Schema/Queue interface 都不变。

---

## File Structure

| 文件 | 角色 | 变更类型 |
|------|------|---------|
| `apps/server/src/routes/chapters.ts` | generate 路由(状态检查+锁+payload)、select 路由(锁) | 修改 |
| `apps/server/src/services/generate-processor.ts` | 读 preLockStatus + 恢复 chapter.status | 修改 |
| `apps/web/src/views/Chapters.vue` | 按钮 v-if/动态文案/确认对话框/Tab ✓/摘要 | 修改 |
| `apps/server/src/__tests__/routes/chapters-regenerate.test.ts` | generate + select 路由新行为测试 | 新增 |
| `apps/server/src/__tests__/generate-processor-preLockStatus.test.ts` | worker 的 preLockStatus 恢复测试 | 新增 |

**不**改:`prisma/schema.prisma`、`apps/server/src/services/ai-call-logger.ts`、`apps/server/src/services/runtime-loader.ts`、`apps/web/src/composables/useDraftManager.ts`(其 `generate` 已是通用入口,不改)、`apps/web/src/components/ReviewingPanel.vue`。

---

## Task 1: generate 路由 allowed 列表扩到 [draft, generated, selected]

**Files:**
- Modify: `apps/server/src/routes/chapters.ts:353-359` (status 检查)
- Test: `apps/server/src/__tests__/routes/chapters-regenerate.test.ts` (新建)

- [ ] **Step 1: Write the failing test**

Create `apps/server/src/__tests__/routes/chapters-regenerate.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createMockApp, callHandler, createMockPrisma } from '../setup.js'

// Mock the runtime loader so the route does not hit the real DB
vi.mock('../../services/runtime-loader.js', () => ({
  loadRuntimeBase: vi.fn().mockResolvedValue({ identity: '', settings: {}, behavior: '', jailbreak: '' }),
  loadWorkerTask: vi.fn().mockResolvedValue({ workerType: 'generation', taskPrompt: '' })
}))

describe('generate route — allowed status list (Task #66)', () => {
  let mockPrisma: any
  let routes: Record<string, any>

  beforeEach(async () => {
    vi.clearAllMocks()
    mockPrisma = createMockPrisma({
      loreItem: { findMany: vi.fn().mockResolvedValue([]) },
      timelineEvent: { findMany: vi.fn().mockResolvedValue([]) },
      plotArc: { findMany: vi.fn().mockResolvedValue([]) },
      characterBranchState: { findMany: vi.fn().mockResolvedValue([]) },
      memory: { findMany: vi.fn().mockResolvedValue([]) },
      character: { findMany: vi.fn().mockResolvedValue([]) },
      runtimeProfile: {
        findUnique: vi.fn().mockResolvedValue(null),
        findFirst: vi.fn().mockResolvedValue(null)
      },
      storyWorkerBinding: {
        findUnique: vi.fn().mockResolvedValue(null)
      },
      workerTask: {
        findUnique: vi.fn().mockResolvedValue(null),
        findFirst: vi.fn().mockResolvedValue(null)
      },
      aiProviderConfig: {
        findFirst: vi.fn().mockResolvedValue(null),
        findMany: vi.fn().mockResolvedValue([])
      }
    })
    const { chapterRoutes } = await import('../../routes/chapters.js')
    const built = createMockApp(mockPrisma)
    await chapterRoutes(built.app)
    routes = built.routes
  })

  function setupChapter(status: string) {
    mockPrisma.chapter.findUnique.mockResolvedValue({
      id: 'c1',
      storyId: 's1',
      status,
      content: status === 'selected' ? 'existing content' : '',
      outline: 'outline',
      title: 'Title',
      sceneLocation: '',
      sceneMood: '',
      sceneGoal: '',
      number: 1,
      isSideStory: false,
      story: { id: 's1', title: 'Story', description: '' }
    })
    mockPrisma.chapter.updateMany.mockResolvedValue({ count: 1 })
    mockPrisma.draft.count.mockResolvedValue(0)
    mockPrisma.draft.create.mockResolvedValue({ id: 'd1' })
  }

  it('rejects generating status with 400', async () => {
    setupChapter('generating')
    const result = await callHandler(
      routes, 'POST', '/api/chapters/:chapterId/generate', {}, { chapterId: 'c1' }
    )
    expect(result.status).toBe(400)
    expect(result.body.error).toMatch(/只允许 draft \/ generated \/ selected/)
  })

  it('rejects scored status with 400', async () => {
    setupChapter('scored')
    const result = await callHandler(
      routes, 'POST', '/api/chapters/:chapterId/generate', {}, { chapterId: 'c1' }
    )
    expect(result.status).toBe(400)
    expect(result.body.error).toMatch(/只允许 draft \/ generated \/ selected/)
  })

  it('rejects reviewing status with 400', async () => {
    setupChapter('reviewing')
    const result = await callHandler(
      routes, 'POST', '/api/chapters/:chapterId/generate', {}, { chapterId: 'c1' }
    )
    expect(result.status).toBe(400)
  })

  it('rejects archived status with 400', async () => {
    setupChapter('archived')
    const result = await callHandler(
      routes, 'POST', '/api/chapters/:chapterId/generate', {}, { chapterId: 'c1' }
    )
    expect(result.status).toBe(400)
  })

  it('accepts generated status (Task #66 new capability)', async () => {
    setupChapter('generated')
    const result = await callHandler(
      routes, 'POST', '/api/chapters/:chapterId/generate', {}, { chapterId: 'c1' }
    )
    expect(result.status).not.toBe(400)
    expect(result.status).not.toBe(409)
    // Lock acquired (proceeds past status check)
    expect(mockPrisma.draft.create).toHaveBeenCalled()
  })

  it('accepts selected status (Task #66 new capability)', async () => {
    setupChapter('selected')
    const result = await callHandler(
      routes, 'POST', '/api/chapters/:chapterId/generate', {}, { chapterId: 'c1' }
    )
    expect(result.status).not.toBe(400)
    expect(result.status).not.toBe(409)
    expect(mockPrisma.draft.create).toHaveBeenCalled()
  })

  it('does NOT delete existing drafts (additive only — spec §2.1.4)', async () => {
    setupChapter('selected')
    await callHandler(
      routes, 'POST', '/api/chapters/:chapterId/generate', {}, { chapterId: 'c1' }
    )
    expect(mockPrisma.draft.deleteMany).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd apps/server && pnpm vitest run src/__tests__/routes/chapters-regenerate.test.ts`

Expected: FAIL — 6 tests will fail (current code only allows 'draft'):
- "rejects generating": 0 fail (already rejected)
- "rejects scored": will fail (currently rejected via 'generating' check... actually this might pass)
- "rejects reviewing": will fail (currently rejected)
- "rejects archived": will fail
- "accepts generated": will fail (currently rejected)
- "accepts selected": will fail (currently rejected)
- "does NOT delete": will fail (deleteMany called... wait, no, the current code doesn't call deleteMany in non-draft path)

Most importantly: the "accepts generated" and "accepts selected" tests will fail with 400, and the "rejects" tests will pass currently (with the old "只允许 draft 状态生成候选" message). Need to verify the message format.

Note: Some tests may pass with the old code due to the `chapter.status !== 'draft'` check. The new tests assert the SPECIFIC new error message format. Old message: "只允许 draft 状态生成候选". New message: "只允许 draft / generated / selected 状态生成候选". So tests asserting the new message format will fail.

- [ ] **Step 3: Modify the generate route status check**

In `apps/server/src/routes/chapters.ts`, replace lines 353-359:

**Before**:
```typescript
    // 只允许 draft 状态生成候选（Q#10 决策：generated 重新生成暂不支持）
    if (chapter.status !== 'draft') {
      return reply.status(400).send({
        success: false,
        error: `章节当前状态为 ${chapter.status}，只允许 draft 状态生成候选`
      })
    }
```

**After**:
```typescript
    // 允许 draft / generated / selected 三态生成候选
    // - draft: 首次生成
    // - generated: 已有候选不满意,再生成新的(追加)
    // - selected: 已选了一个,想多看几个对比(追加,Chapter.content 不动)
    // (Q#10 当时拒绝 generated 是因为"删旧+重建"无原子性,本改造改为纯加法,
    // 旧候选全部保留,不存在脏窗口问题)
    const GENERATE_ALLOWED_STATUSES = ['draft', 'generated', 'selected'] as const
    if (!GENERATE_ALLOWED_STATUSES.includes(chapter.status as any)) {
      return reply.status(400).send({
        success: false,
        error: `章节当前状态为 ${chapter.status}，只允许 draft / generated / selected 状态生成候选`
      })
    }
```

- [ ] **Step 4: Update the atomic lock to use the same allowed list**

In the same file, replace the lock at lines 361-371 (right after the new status check):

**Before**:
```typescript
    // 状态机独占锁：原子性 updateMany（防止双击并发产生 2 批 draft）
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

**After**:
```typescript
    // 状态机独占锁：原子性 updateMany（防止双击并发产生 2 批 draft）
    const lockResult = await prisma.chapter.updateMany({
      where: { id: chapterId, status: { in: GENERATE_ALLOWED_STATUSES as unknown as string[] } },
      data: { status: 'generating' }
    })
    if (lockResult.count === 0) {
      return reply.status(409).send({
        success: false,
        error: '章节正在生成中或状态不允许，请刷新后重试'
      })
    }
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd apps/server && pnpm vitest run src/__tests__/routes/chapters-regenerate.test.ts`

Expected: PASS — all 7 tests green.

- [ ] **Step 6: Verify existing tests still pass**

Run: `cd apps/server && pnpm vitest run src/__tests__/routes/generate-concurrency.test.ts`

Expected: PASS — existing tests for the `status='draft'` path should still work (count: 1 mock path).

- [ ] **Step 7: Commit**

```bash
git status   # MANDATORY: confirm only chapters.ts + the new test file
git add apps/server/src/routes/chapters.ts apps/server/src/__tests__/routes/chapters-regenerate.test.ts
git commit -m "$(cat <<'EOF'
refactor(chapters): allow generate from generated/selected states

Q#10 (commit 5f80270) had removed the generated-state regenerate
capability to avoid the "deleteMany + rebuild" race window. This
re-opens the capability with a narrow "additive only" semantic:
re-generation only adds drafts, never deletes or overwrites.

Allowed statuses for generate: [draft, generated, selected].
- draft: first-time generation (original behavior)
- generated: append more candidates to compare
- selected: append more candidates, Chapter.content untouched

The atomic updateMany lock now uses `status IN (...)` instead of
`status = 'draft'` so a concurrent submission to a generated/selected
chapter also gets a clean 409 instead of 400.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: generate 路由捕获 preLockStatus + 透传到 queue job payload

**Files:**
- Modify: `apps/server/src/routes/chapters.ts:472-481` (queue.add payload)
- Test: `apps/server/src/__tests__/routes/chapters-regenerate.test.ts` (add 2 tests)

- [ ] **Step 1: Append two failing tests to the existing test file**

In `apps/server/src/__tests__/routes/chapters-regenerate.test.ts`, add these tests inside the existing `describe` block (after the last `it(...)` block, before the closing `})`):

```typescript
  it('captures preLockStatus and passes it to generateQueue.add (Task #66)', async () => {
    // Mock generateQueue to inspect what payload it receives
    const { generateQueue } = await import('../../queue/index.js')
    const addSpy = vi.spyOn(generateQueue, 'add').mockResolvedValue({} as any)

    setupChapter('selected')
    await callHandler(
      routes, 'POST', '/api/chapters/:chapterId/generate', {}, { chapterId: 'c1' }
    )

    expect(addSpy).toHaveBeenCalled()
    const payload = addSpy.mock.calls[0][1]
    expect(payload).toHaveProperty('preLockStatus', 'selected')
    addSpy.mockRestore()
  })

  it('passes preLockStatus=draft for first-time generation', async () => {
    const { generateQueue } = await import('../../queue/index.js')
    const addSpy = vi.spyOn(generateQueue, 'add').mockResolvedValue({} as any)

    setupChapter('draft')
    await callHandler(
      routes, 'POST', '/api/chapters/:chapterId/generate', {}, { chapterId: 'c1' }
    )

    const payload = addSpy.mock.calls[0][1]
    expect(payload.preLockStatus).toBe('draft')
    addSpy.mockRestore()
  })
```

- [ ] **Step 2: Run the test to verify the new ones fail**

Run: `cd apps/server && pnpm vitest run src/__tests__/routes/chapters-regenerate.test.ts -t "preLockStatus"`

Expected: 2 new tests FAIL — current payload has no `preLockStatus` field.

- [ ] **Step 3: Capture preLockStatus in the route handler**

In `apps/server/src/routes/chapters.ts`, find the line right after the lock block (currently around line 372, after `// 后续代码已假设 chapter.status === 'generating'，无需重新读取`):

**Before** (currently):
```typescript
    // 后续代码已假设 chapter.status === 'generating'，无需重新读取

    const story = chapter.story
```

**After**:
```typescript
    // 后续代码已假设 chapter.status === 'generating'，无需重新读取

    // 抢锁前的 chapter.status,worker 完成后用其恢复 chapter.status
    // (而不是写死 'generated')。selected 状态重生成后保持 selected,这是
    // 纯加法语义的关键:Chapter.content / 已选 draft 标记都不动。
    const preLockStatus = chapter.status

    const story = chapter.story
```

- [ ] **Step 4: Add preLockStatus to the queue.add payload**

In the same file, find the `generateQueue.add('generate-chapter', { ... })` call (around line 472-481):

**Before**:
```typescript
    await generateQueue.add('generate-chapter', {
      draftIds: generatingDrafts.map(d => d.id),
      chapterId,
      storyId,
      compiled,
      temperatures: generatingDrafts.map((_, i) => temperatures[i] ?? (0.6 + i * 0.15)),
      maxTokens,
      chapterTitle: chapter.title,
      chapterOutline: chapter.outline
    })
```

**After**:
```typescript
    await generateQueue.add('generate-chapter', {
      draftIds: generatingDrafts.map(d => d.id),
      chapterId,
      storyId,
      compiled,
      temperatures: generatingDrafts.map((_, i) => temperatures[i] ?? (0.6 + i * 0.15)),
      maxTokens,
      chapterTitle: chapter.title,
      chapterOutline: chapter.outline,
      preLockStatus   // 透传给 worker,决定 status 恢复目标
    })
```

- [ ] **Step 5: Run the test to verify all pass**

Run: `cd apps/server && pnpm vitest run src/__tests__/routes/chapters-regenerate.test.ts`

Expected: PASS — all 9 tests green (7 from Task 1 + 2 new).

- [ ] **Step 6: Commit**

```bash
git status
git add apps/server/src/routes/chapters.ts apps/server/src/__tests__/routes/chapters-regenerate.test.ts
git commit -m "$(cat <<'EOF'
feat(generate): capture preLockStatus and pass in queue job payload

The generate-processor worker hardcodes `status: 'generated'` on
success, which would clobber the 'selected' state when the user
re-generates from a selected chapter. The route now captures
`preLockStatus` (the chapter status at lock time, before flipping
to 'generating') and passes it in the queue job payload so the
worker can restore the correct status.

This is the data plumbing half of Task #66. The worker logic to
consume this field is in the next commit.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: generate-processor 用 preLockStatus 恢复 chapter.status

**Files:**
- Modify: `apps/server/src/services/generate-processor.ts:62-68` (status restore)
- Test: `apps/server/src/__tests__/generate-processor-preLockStatus.test.ts` (新建)

- [ ] **Step 1: Write the failing test**

Create `apps/server/src/__tests__/generate-processor-preLockStatus.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock callAIWithLog so the worker does not actually call AI.
const mockCallAIWithLog = vi.fn()
vi.mock('../services/ai-call-logger.js', () => ({
  callAIWithLog: (...args: any[]) => mockCallAIWithLog(...args)
}))

import { createGenerateProcessor } from '../services/generate-processor.js'

function makeJob(preLockStatus: string | undefined, successPerCall: boolean[]) {
  return {
    data: {
      draftIds: successPerCall.map((_, i) => `d${i}`),
      chapterId: 'c1',
      storyId: 's1',
      compiled: { systemMessage: '', userMessage: '', meta: { totalTokens: 0 } },
      temperatures: successPerCall.map(() => 0.7),
      maxTokens: 4096,
      chapterTitle: 'Title',
      chapterOutline: 'Outline',
      preLockStatus
    }
  }
}

function makeApp() {
  return {
    prisma: {
      draft: { update: vi.fn() },
      chapter: { update: vi.fn() }
    },
    log: { info: vi.fn(), error: vi.fn(), warn: vi.fn() }
  } as any
}

describe('generate-processor — preLockStatus restore (Task #66)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('preLockStatus=draft, all success → restore to "generated"', async () => {
    mockCallAIWithLog.mockResolvedValue('content')
    const app = makeApp()
    const processor = createGenerateProcessor(app)
    await processor(makeJob('draft', [true, true, true]))

    expect(app.prisma.chapter.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'c1' },
        data: { status: 'generated' }
      })
    )
  })

  it('preLockStatus=generated, all success → restore to "generated"', async () => {
    mockCallAIWithLog.mockResolvedValue('content')
    const app = makeApp()
    const processor = createGenerateProcessor(app)
    await processor(makeJob('generated', [true, true, true]))

    expect(app.prisma.chapter.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: 'generated' } })
    )
  })

  it('preLockStatus=selected, all success → restore to "selected" (Task #66 core)', async () => {
    mockCallAIWithLog.mockResolvedValue('content')
    const app = makeApp()
    const processor = createGenerateProcessor(app)
    await processor(makeJob('selected', [true, true, true]))

    expect(app.prisma.chapter.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: 'selected' } })
    )
  })

  it('preLockStatus=selected, partial success → restore to "selected"', async () => {
    mockCallAIWithLog
      .mockResolvedValueOnce('content')
      .mockRejectedValueOnce(new Error('AI fail'))
      .mockResolvedValueOnce('content')
    const app = makeApp()
    const processor = createGenerateProcessor(app)
    await processor(makeJob('selected', [true, false, true]))

    expect(app.prisma.chapter.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: 'selected' } })
    )
  })

  it('preLockStatus=selected, all fail → still restore to "selected" (avoids stuck generating)', async () => {
    mockCallAIWithLog.mockRejectedValue(new Error('AI fail'))
    const app = makeApp()
    const processor = createGenerateProcessor(app)
    await processor(makeJob('selected', [false, false, false]))

    expect(app.prisma.chapter.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: 'selected' } })
    )
  })

  it('preLockStatus=undefined (legacy queue job) → fallback to "draft" → restore to "generated"', async () => {
    mockCallAIWithLog.mockResolvedValue('content')
    const app = makeApp()
    const processor = createGenerateProcessor(app)
    await processor(makeJob(undefined, [true, true, true]))

    expect(app.prisma.chapter.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: 'generated' } })
    )
  })

  it('worker does NOT touch Chapter.content (additive invariant — spec §2.1.2)', async () => {
    mockCallAIWithLog.mockResolvedValue('content')
    const app = makeApp()
    const processor = createGenerateProcessor(app)
    await processor(makeJob('selected', [true, true, true]))

    const updateCall = app.prisma.chapter.update.mock.calls[0][0]
    expect(updateCall.data).not.toHaveProperty('content')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd apps/server && pnpm vitest run src/__tests__/generate-processor-preLockStatus.test.ts`

Expected: FAIL — current code hardcodes `status: 'generated'`, so:
- Tests 1, 2 may pass (they expect 'generated')
- Tests 3, 4, 5 fail (they expect 'selected', get 'generated')
- Test 6 may pass (legacy fallback)
- Test 7 fails (current code never sets content, so the invariant technically holds... but the current code's successCount gate means all-fail never calls chapter.update at all)

- [ ] **Step 3: Modify the generate-processor to use preLockStatus**

In `apps/server/src/services/generate-processor.ts`, replace lines 12-74 (the entire `createGenerateProcessor` function):

**Before** (lines 12-74):
```typescript
export function createGenerateProcessor(app: FastifyInstance) {
  return async (job: any) => {
    const { draftIds, chapterId, storyId, compiled, temperatures, maxTokens, chapterTitle, chapterOutline } = job.data
    app.log.info(`[Generate] Processing ${draftIds.length} drafts for chapter ${chapterId}`)

    const prisma = app.prisma
    let successCount = 0
    let failCount = 0

    for (let i = 0; i < draftIds.length; i++) {
      const draftId = draftIds[i]
      const temperature = temperatures[i]

      try {
        app.log.info(`[Generate] Calling AI for draft ${draftId}, temp=${temperature}`)
        const result = await callAIWithLog(app, {
          storyId,
          chapterId,
          callType: 'generate',
          compiled,
          temperature,
          maxTokens
        })

        const fallbackChapter = { title: chapterTitle, outline: chapterOutline }
        const content = result ?? generateFallbackContent(fallbackChapter, i, '未配置 API Key')

        await prisma.draft.update({
          where: { id: draftId },
          data: {
            content,
            status: 'completed',
            compiledPrompt: JSON.stringify(compiled)
          }
        })
        successCount++
        app.log.info(`[Generate] Draft ${draftId} completed, ${content.length} chars`)
      } catch (err: any) {
        app.log.error(`[Generate] Draft ${draftId} failed: ${err.message}`)
        await prisma.draft.update({
          where: { id: draftId },
          data: {
            status: 'failed',
            errorMessage: err.message
          }
        })
        failCount++
      }
    }

    // 只要有成功完成的，就更新章节状态为 generated
    if (successCount > 0) {
      await prisma.chapter.update({
        where: { id: chapterId },
        data: { status: 'generated' }
      })
    }

    app.log.info(`[Generate] Done for chapter ${chapterId}: ${successCount} success, ${failCount} failed`)

    return { successCount, failCount, total: draftIds.length }
  }
}
```

**After**:
```typescript
export function createGenerateProcessor(app: FastifyInstance) {
  return async (job: any) => {
    const {
      draftIds, chapterId, storyId, compiled, temperatures, maxTokens,
      chapterTitle, chapterOutline, preLockStatus
    } = job.data
    //                                  ↑ 新增:抢锁前章节状态,决定 status 恢复目标
    app.log.info(`[Generate] Processing ${draftIds.length} drafts for chapter ${chapterId} (preLockStatus=${preLockStatus})`)

    const prisma = app.prisma
    let successCount = 0
    let failCount = 0

    for (let i = 0; i < draftIds.length; i++) {
      const draftId = draftIds[i]
      const temperature = temperatures[i]

      try {
        app.log.info(`[Generate] Calling AI for draft ${draftId}, temp=${temperature}`)
        const result = await callAIWithLog(app, {
          storyId,
          chapterId,
          callType: 'generate',
          compiled,
          temperature,
          maxTokens
        })

        const fallbackChapter = { title: chapterTitle, outline: chapterOutline }
        const content = result ?? generateFallbackContent(fallbackChapter, i, '未配置 API Key')

        await prisma.draft.update({
          where: { id: draftId },
          data: {
            content,
            status: 'completed',
            compiledPrompt: JSON.stringify(compiled)
          }
        })
        successCount++
        app.log.info(`[Generate] Draft ${draftId} completed, ${content.length} chars`)
      } catch (err: any) {
        app.log.error(`[Generate] Draft ${draftId} failed: ${err.message}`)
        await prisma.draft.update({
          where: { id: draftId },
          data: {
            status: 'failed',
            errorMessage: err.message
          }
        })
        failCount++
      }
    }

    // 恢复 chapter.status:用抢锁前的状态决定,而不是写死 'generated'
    //   draft     → generated  (首次生成完成)
    //   generated → generated  (再生成完成,本身就在)
    //   selected  → selected   (再生成完成,状态保留,Chapter.content 不动)
    // 修复旧 bug:全失败时也恢复(旧代码卡在 'generating'),避免章节卡死
    // 兜底:preLockStatus 缺失(老 queue 残留 job)按 'draft' 处理,行为同旧版本
    const effectivePreLock = preLockStatus ?? 'draft'
    const restoreStatus = effectivePreLock === 'draft' ? 'generated' : effectivePreLock
    await prisma.chapter.update({
      where: { id: chapterId },
      data: { status: restoreStatus }
    })

    app.log.info(`[Generate] Done for chapter ${chapterId}: ${successCount} success, ${failCount} failed, restored to ${restoreStatus}`)

    return { successCount, failCount, total: draftIds.length }
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd apps/server && pnpm vitest run src/__tests__/generate-processor-preLockStatus.test.ts`

Expected: PASS — all 7 tests green.

- [ ] **Step 5: Verify the full server test suite still passes**

Run: `cd apps/server && pnpm vitest run`

Expected: all 87+ tests pass (7 new + 87 existing). No regression.

- [ ] **Step 6: Commit**

```bash
git status
git add apps/server/src/services/generate-processor.ts apps/server/src/__tests__/generate-processor-preLockStatus.test.ts
git commit -m "$(cat <<'EOF'
refactor(generate-processor): restore chapter status from preLockStatus

The worker used to hardcode `status: 'generated'` after generation
and only call chapter.update on partial-or-full success. With
Task #66 allowing generate from 'selected' state, the worker
needs to know what status to restore the chapter to.

`preLockStatus` (the status the chapter had before the atomic lock
flipped it to 'generating') is the correct signal:
- draft → restore 'generated' (first-time generation)
- generated → restore 'generated' (regenerate, same state)
- selected → restore 'selected' (regenerate, preserve selection,
  leave Chapter.content untouched)

Also fixes a latent bug: the old `if (successCount > 0)` gate meant
a full AI failure left the chapter stuck in 'generating' forever.
The new code always calls chapter.update so the user is never
stranded in an unrescuable state. preLockStatus=undefined (legacy
queue job) falls back to 'draft' for backwards compatibility.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: select 路由锁扩到 [generated, scored, selected]

**Files:**
- Modify: `apps/server/src/routes/chapters.ts:488-527` (status check + lock)
- Test: `apps/server/src/__tests__/routes/chapters-regenerate.test.ts` (add 3 tests)

- [ ] **Step 1: Append three failing tests**

In `apps/server/src/__tests__/routes/chapters-regenerate.test.ts`, add a new `describe` block at the end of the file:

```typescript
describe('select route — lock extended for selected state (Task #66)', () => {
  let mockPrisma: any
  let routes: Record<string, any>

  beforeEach(async () => {
    vi.clearAllMocks()
    mockPrisma = {
      chapter: {
        findUnique: vi.fn(),
        update: vi.fn(),
        updateMany: vi.fn()
      },
      draft: {
        findUnique: vi.fn(),
        update: vi.fn(),
        updateMany: vi.fn()
      },
      $transaction: vi.fn(async (fn: any) => fn(mockPrisma))
    }
    const { chapterRoutes } = await import('../../routes/chapters.js')
    const built = createMockApp(mockPrisma)
    await chapterRoutes(built.app)
    routes = built.routes
  })

  it('accepts selected status (Task #66 new capability)', async () => {
    // User in selected state wants to switch to a different candidate
    // (e.g. one from a fresh re-generation batch).
    mockPrisma.chapter.findUnique.mockResolvedValue({
      id: 'c1', status: 'selected', content: 'old selected content'
    })
    mockPrisma.draft.findUnique.mockResolvedValue({
      id: 'd_new', chapterId: 'c1', content: 'new content', chapter: { id: 'c1' }
    })
    mockPrisma.chapter.updateMany.mockResolvedValue({ count: 1 })
    mockPrisma.draft.updateMany.mockResolvedValue({ count: 1 })
    mockPrisma.draft.update.mockResolvedValue({ id: 'd_new', status: 'selected' })
    mockPrisma.chapter.update.mockResolvedValue({ id: 'c1', status: 'selected' })

    const result = await callHandler(
      routes, 'POST', '/api/chapters/:chapterId/select',
      { draftId: 'd_new' }, { chapterId: 'c1' }
    )

    expect(result.status).not.toBe(400)
    expect(result.status).not.toBe(409)
    expect(mockPrisma.$transaction).toHaveBeenCalled()
  })

  it('rejects archived status with 400', async () => {
    mockPrisma.chapter.findUnique.mockResolvedValue({
      id: 'c1', status: 'archived'
    })

    const result = await callHandler(
      routes, 'POST', '/api/chapters/:chapterId/select',
      { draftId: 'd1' }, { chapterId: 'c1' }
    )

    expect(result.status).toBe(400)
    expect(result.body.error).toMatch(/只允许 generated \/ scored \/ selected/)
  })

  it('rejects draft status with 400', async () => {
    mockPrisma.chapter.findUnique.mockResolvedValue({
      id: 'c1', status: 'draft'
    })

    const result = await callHandler(
      routes, 'POST', '/api/chapters/:chapterId/select',
      { draftId: 'd1' }, { chapterId: 'c1' }
    )

    expect(result.status).toBe(400)
  })
})
```

- [ ] **Step 2: Run the test to verify the new ones fail**

Run: `cd apps/server && pnpm vitest run src/__tests__/routes/chapters-regenerate.test.ts -t "select route"`

Expected: 3 new tests FAIL — current code only allows 'generated' for select.

- [ ] **Step 3: Modify the select route status check and lock**

In `apps/server/src/routes/chapters.ts`, replace the select route's status check (line 497-502) and atomic lock (line 512-515):

**Before** (line 496-502):
```typescript
    // 只允许 generated 状态选择候选
    if (chapter.status !== 'generated') {
      return reply.status(400).send({
        success: false,
        error: `章节当前状态为 ${chapter.status}，只允许 generated 状态选择候选`
      })
    }
```

**After**:
```typescript
    // 允许 generated / scored / selected 三态切换候选
    // - generated / scored: 首次/评分后选择
    // - selected: 已选了一个,看到新生成的更好的候选想切换
    // 切换路径下,UI 的 handleAdoptDraft 已有"确认覆盖"对话框兜底
    if (chapter.status !== 'generated' &&
        chapter.status !== 'scored' &&
        chapter.status !== 'selected') {
      return reply.status(400).send({
        success: false,
        error: `章节当前状态为 ${chapter.status}，只允许 generated / scored / selected 状态选择候选`
      })
    }
```

**Before** (line 512-515):
```typescript
    const lockResult = await app.prisma.chapter.updateMany({
      where: { id: chapterId, status: { in: ['generated', 'scored'] } },
      data: { status: 'selected' }
    })
```

**After**:
```typescript
    const lockResult = await app.prisma.chapter.updateMany({
      where: { id: chapterId, status: { in: ['generated', 'scored', 'selected'] } },
      data: { status: 'selected' }
    })
```

- [ ] **Step 4: Run the test to verify all pass**

Run: `cd apps/server && pnpm vitest run src/__tests__/routes/chapters-regenerate.test.ts`

Expected: PASS — all 12 tests green (9 from Tasks 1-2 + 3 new).

- [ ] **Step 5: Verify existing select tests still pass**

Run: `cd apps/server && pnpm vitest run src/__tests__/routes/chapters-select.test.ts src/__tests__/routes/chapters-concurrency.test.ts`

Expected: PASS — existing tests for `status: 'generated'` and 409 paths still work (the lock is wider, not narrower).

- [ ] **Step 6: Commit**

```bash
git status
git add apps/server/src/routes/chapters.ts apps/server/src/__tests__/routes/chapters-regenerate.test.ts
git commit -m "$(cat <<'EOF'
feat(select): allow switching to a better candidate from selected state

Previously, after selecting a candidate the user could not switch to
a different one — the select route's atomic lock only accepted
generated/scored. With Task #66 letting the user re-generate
candidates from selected state, they may find a better one in the
new batch and want to adopt it.

Extends the lock to include 'selected' so the user can re-select.
The UI's handleAdoptDraft already shows a "确认覆盖" confirmation
dialog when chapter.content is non-empty, which is the existing
safety net for any adopt-new-draft path.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Chapters.vue UI 改动（按钮 v-if / 文案 / 确认对话框 / Tab ✓ / 摘要）

**Files:**
- Modify: `apps/web/src/views/Chapters.vue` (template + script)

Note: Vue 单文件组件,无 vitest 单元测试基础设施（仓库 `apps/web` 没装 `@vue/test-utils` / `vitest-browser`）。UI 行为通过手动验证 + Tasks 1-4 的后端测试覆盖。

- [ ] **Step 1: Update the generate button to gate on status and show dynamic text**

In `apps/web/src/views/Chapters.vue`, replace the generate button (lines 351-359):

**Before**:
```vue
                            <n-button
                                type="primary"
                                size="small"
                                @click="handleGenerateDefault"
                                :loading="drafts.generating"
                                :disabled="drafts.generating"
                            >
                                {{ drafts.generating ? "生成中..." : "默认候选 ×3" }}
                            </n-button>
```

**After**:
```vue
                            <n-button
                                v-if="editor.currentChapter && ['draft', 'generated', 'selected'].includes(editor.currentChapter.status)"
                                type="primary"
                                size="small"
                                @click="handleGenerateDefault"
                                :loading="drafts.generating"
                                :disabled="drafts.generating"
                            >
                                <template v-if="drafts.generating">生成中...</template>
                                <template v-else-if="editor.currentChapter.status === 'draft'">默认候选 ×3</template>
                                <template v-else>再生成 ×3</template>
                            </n-button>
```

- [ ] **Step 2: Add a summary line above the candidate tabs**

In the same file, find the candidate tabs block (line 370-371) and add the summary right before it:

**Before** (line 370-371):
```vue
                        <!-- 候选 Tabs -->
                        <n-tabs
                            v-if="drafts.drafts.length > 0"
```

**After**:
```vue
                        <!-- 候选摘要（Task #66） -->
                        <n-space
                            v-if="drafts.drafts.length > 0"
                            align="center"
                            style="margin-bottom: 8px"
                        >
                            <n-text depth="3" style="font-size: 12px">
                                共 {{ drafts.drafts.length }} 个候选
                                <template v-if="editor.currentChapter?.status === 'selected'">
                                    ,已选 1 个(右上角带 ✓)
                                </template>
                            </n-text>
                        </n-space>

                        <!-- 候选 Tabs -->
                        <n-tabs
                            v-if="drafts.drafts.length > 0"
```

- [ ] **Step 3: Add the ✓ marker to the selected draft's tab**

In the same file, find the candidate tab pane (line 375-380) and update the `:tab` binding:

**Before** (line 375-380):
```vue
                            <n-tab-pane
                                v-for="draft in drafts.drafts"
                                :key="draft.id"
                                :name="draft.id"
                                :tab="draft.version"
                            >
```

**After**:
```vue
                            <n-tab-pane
                                v-for="draft in drafts.drafts"
                                :key="draft.id"
                                :name="draft.id"
                                :tab="draft.status === 'selected' ? `${draft.version} ✓` : draft.version"
                            >
```

- [ ] **Step 4: Update handleGenerateDefault to show the token-cost confirmation dialog**

In the same file, find the `handleGenerateDefault` function (lines 927-939) and replace it:

**Before**:
```typescript
async function handleGenerateDefault() {
    if (!editor.currentChapter || !storyId()) return;
    const result = await drafts.generate(
        editor.currentChapter.id,
        storyId()!,
        [0.6, 0.75, 0.9],
        editor.selectedProfileId,
    );
    if (result.success) {
        prompt.tokenStats = result.tokens;
        prompt.layerStats = result.layers;
    }
}
```

**After**:
```typescript
async function handleGenerateDefault() {
    if (!editor.currentChapter || !storyId()) return;

    // 仅在 generated/selected 状态弹 token 成本确认对话框
    // draft 状态是首次生成,直接放行(用户刚点进来,没有"追加"的成本顾虑)
    if (['generated', 'selected'].includes(editor.currentChapter.status)) {
        const existingCount = drafts.drafts.length
        const newCount = 3
        // 粗估:每候选 ~maxTokens × 1.3 (含 system prompt + 输出冗余)
        // drafts.customMaxTokens 来自自定义 modal,未设时 fallback 4096
        const estimatedTokens = newCount * (drafts.customMaxTokens || 4096) * 1.3
        const ok = await new Promise<boolean>(resolve => {
            dialog.warning({
                title: '生成新候选',
                content: `当前已有 ${existingCount} 个候选,本次再生成 ${newCount} 个会追加到列表(旧候选保留)。\n\n` +
                         `预估消耗约 ${Math.round(estimatedTokens / 1000)}K tokens(取决于模型 max_tokens)。\n\n` +
                         `确认开始生成?`,
                positiveText: '确认生成',
                negativeText: '取消',
                onPositiveClick: () => resolve(true),
                onNegativeClick: () => resolve(false),
                onClose: () => resolve(false)
            })
        })
        if (!ok) return
    }

    const result = await drafts.generate(
        editor.currentChapter.id,
        storyId()!,
        [0.6, 0.75, 0.9],
        editor.selectedProfileId,
    );
    if (result.success) {
        prompt.tokenStats = result.tokens;
        prompt.layerStats = result.layers;
    }
}
```

- [ ] **Step 5: Verify the file parses (TypeScript check)**

Run: `pnpm typecheck`

Expected: PASS — no new type errors. (The Vue template's `editor.currentChapter?.status === 'selected'` access is already used elsewhere in the file.)

- [ ] **Step 6: Manual smoke check (no test framework available)**

These are the four manual checks per spec §6.3 — they are documented here so the implementer / reviewer can run them in a browser after the change ships. Not automated; UI tests are out of scope for this plan.

- [ ] draft 状态: 按钮显示"默认候选 ×3",点不弹确认(首次生成)
- [ ] generated 状态: 按钮显示"再生成 ×3",点弹确认对话框,确认后 3 个新候选追加
- [ ] selected 状态: 按钮显示"再生成 ×3",点弹确认,确认后 3 个新候选追加,旧 selected draft 仍带 ✓,`Chapter.content` 不动
- [ ] 再生成后: 候选 Tab 数量 = 原有 + 3,新 Tab 在末尾(因 `createdAt desc`)

- [ ] **Step 7: Commit**

```bash
git status
git add apps/web/src/views/Chapters.vue
git commit -m "$(cat <<'EOF'
feat(ui): regenerate button for non-draft chapter states

Adds the front-end half of Task #66:
- Generate button is now gated on chapter.status being
  draft/generated/selected, with dynamic label
  ("默认候选 ×3" for draft, "再生成 ×3" for the rest).
- Tapping it from generated/selected now shows a token-cost
  confirmation dialog (skip for first-time generation in draft
  state) — explicit user consent for the additive re-generation.
- The candidate-tab header for the currently selected draft gets
  a ✓ marker, and a "共 N 个候选" summary line above the tab
  strip shows how many candidates the user is looking at.

The actual generate call is unchanged (useDraftManager.generate
already accepts any chapter status, the backend changes in
Tasks 1-4 made the API actually accept those states).

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: 端到端验证 + typecheck + lint

**Files:** none (verification only)

- [ ] **Step 1: Run the full server test suite**

Run: `cd apps/server && pnpm vitest run`

Expected: 94+ tests pass (87 existing + 7 new in chapters-regenerate + 7 new in generate-processor-preLockStatus). 0 failed.

- [ ] **Step 2: Type-check the monorepo**

Run: `pnpm typecheck`

Expected: 0 errors across 8 workspace projects. The Vue template change is type-checked through `vue-tsc`.

- [ ] **Step 3: Lint**

Run: `pnpm lint`

Expected: N/A — repository has no lint script in any package. Documented as a known repo state in CLAUDE.md.

- [ ] **Step 4: Verify git working tree is clean**

Run: `git status`

Expected: `nothing to commit, working tree clean`.

- [ ] **Step 5: Final summary report**

Report to the user with:
- 4 commit SHAs (Tasks 1-4) + 1 Vue commit SHA (Task 5)
- Total tests: 87 → 94+
- Typecheck: clean
- Manual UI checks deferred to user

---

## Self-Review

This is the inline self-review per writing-plans skill — not a subagent dispatch.

**1. Spec coverage** (walk spec sections, point to tasks):

| Spec section | Implementing task |
|--------------|-------------------|
| §2.1.1 多轮候选可叠加 | Task 1 (route allowed list) + Task 3 (worker restore) |
| §2.1.2 Chapter.content 不被覆盖 | Task 3 (worker invariant test) + Task 5 (UI 确认) |
| §2.1.3 已选状态保留 | Task 3 (preLockStatus='selected' → 'selected') + Task 4 (select 路由) |
| §2.1.4 零破坏性 | Task 1 (不删 draft) + Task 3 (worker invariant test) |
| §2.1.5 用户知情权 | Task 5 (token cost dialog) |
| §4.1 generate 路由改动 | Task 1 + Task 2 |
| §4.2 worker 改动 | Task 3 |
| §4.3 select 路由 | Task 4 |
| §4.4 UI 改动 | Task 5 |
| §4.5 handleGenerateCustom | Explicitly not handled (out of scope per spec) |
| §5.1 旧 job 兼容性 | Task 3 (preLockStatus ?? 'draft' fallback) + test |
| §6.1 单元测试 | Task 1 (route allowed list) + Task 3 (worker restore) + Task 4 (select lock) |
| §6.2 集成测试 | Task 2 (job payload 透传) + Task 4 (select 锁扩) |
| §6.3 UI 测试 | Task 5 (Step 6 manual checks, documented but not automated) |

Coverage: complete. No spec section without a task.

**2. Placeholder scan**:
- No "TBD" / "TODO" / "fill in" found
- Every step with code shows the actual code, not descriptions
- No "similar to Task N" — each step repeats the actual code

**3. Type consistency**:
- `GENERATE_ALLOWED_STATUSES` defined in Task 1, used in Task 1 (both the check and the lock) — consistent
- `preLockStatus` defined in Task 2 (route) and Task 3 (worker) — same field name on `job.data`, same string value space (`'draft' | 'generated' | 'selected'`)
- `restoreStatus` defined in Task 3 as a local const — not leaked elsewhere
- `draft.status` values used in Tasks 1, 3, 4, 5 all align with the schema (`'selected'` is the only new visibility, used in `Chapters.vue:380` for the ✓ marker)

**4. Test count delta**:
- Existing: 87
- New: 7 (chapters-regenerate Task 1) + 2 (chapters-regenerate Task 2) + 7 (generate-processor-preLockStatus Task 3) + 3 (chapters-regenerate Task 4) = 19 new tests
- Total: 106

**5. Front-end type-check coverage**:
- Task 5 Step 5 runs `pnpm typecheck` which includes `vue-tsc` for the web app
- This catches Vue template type errors that the manual smoke check might miss

**6. Cross-module impact (spec §3.3) verification**:
- chapters.ts (generate + select routes): Tasks 1, 2, 4 ✓
- generate-processor.ts: Task 3 ✓
- Chapters.vue: Task 5 ✓
- prisma/schema.prisma: NOT touched (no migration needed) ✓
- ai-call-logger.ts, runtime-loader.ts, useDraftManager.ts, ReviewingPanel.vue: NOT touched ✓
- Test files: 2 new files (chapters-regenerate.test.ts, generate-processor-preLockStatus.test.ts) ✓

**7. Plan self-correction**:
- Originally I had 7 sub-tasks in spec §8; the plan groups them into 6 tasks (merging "三组测试" into the implementation tasks where the tests live — Tasks 1-4 each have their own TDD tests, so there's no separate "all tests at end" task)
- Task 5 is the only one without automated tests (UI), but it has typecheck coverage and a manual smoke checklist
- The verification task (Task 6) is the typecheck + test suite + git status check

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-06-17-regenerate-from-non-draft-states.md`. Two execution options:

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints for review

**Which approach?**
