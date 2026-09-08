# v4 Memory Pipeline Split-Stages Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 memory 单 stage 拆为 `memoryExtract` + `memoryOptimize` 两个独立 stage,根除"抽取失败优化白跑"和"抽取成功优化失败整 stage 报废"两个脆弱点;UI 显示两步进度,per-stage 失败可独立重启,archive confirm 严格校验两 stage 都 success。

**Architecture:**
- **数据**: `PendingArchiveDataV3` (4 stages) → `V4` (5 stages)。`v3` 继续保留为 interface 兼容旧测试,但 archive confirm 仅接受 v4。
- **后端**: `prepare-archive` 把 `optimizeMemories` 调用从 `runMemoryStage` 后挪成分离的 `memoryOptimize` stage。`retry-stage` 端点 stageName 枚举扩展。
- **前端**: `ReviewingPanel` 记忆 tab 加两步进度条 + 失败步骤独立重启按钮;"重新解析此阶段" 改名为 "重新解析两步" (总入口)。
- **Archive 策略**: A 严格 (memoryExtract + memoryOptimize 都 success 才放行)。

**Tech Stack:** 已有 — Fastify + Prisma + Vitest + Vue 3 + Naive UI。

**前置说明:**
- 当前 `A2+B` 修复 (provider `reasoning_content` 兜底 + memory-optimizer 抛错替代静默 return) src + test 已合但未 commit。Task 0 把它独立 commit,作为 v4 的前置 baseline,**不应**混入 v4 commit。
- v4 commit 拆分: 共享类型 1 → 后端 1 → 前端 1 → 测试 1 → 文档 1。共 5 个 commit。

---

## File Structure

### 修改文件

| 文件 | 改动 |
|------|------|
| `packages/shared/src/archive.ts` | 加 `PendingArchiveDataV4` interface + `PendingArchiveDataV4Schema`;加 `RetryStageName` 类型 'memoryExtract'\|'memoryOptimize';保留 `V3` interface 用于旧测试 |
| `apps/server/src/routes/chapters-archive.ts` | 拆 `prepare-archive` L160-202 → 5 stage;扩 `retry-stage` L254-409 接受 `memoryExtract`/`memoryOptimize`;archive confirm L529-712 校验 v4 + 5 stage |
| `apps/web/src/views/ReviewingPanel.vue` | 记忆 tab 加两步进度条 + per-stage 重启按钮;`stageStatus`/`isRetrying`/`dotColor` 类型签名扩展 |
| `apps/web/src/views/ReviewingPanel.adapter.ts` | 加 `V4PendingArchiveData` interface + `fromV4`/`toV4`;`LocalData` 加 `memoryExtract` + `memoryOptimize` 字段 |
| `apps/web/src/composables/useChapterEditor.ts` | `retryChapterStage` stageName 类型扩展 (接受 `memoryExtract`\|`memoryOptimize`) |
| `docs/LOGIC.md` | §2 归档流水线 + §6 v3 Stage 边界 → v4 split stages |

### 新建文件

| 文件 | 用途 |
|------|------|
| `apps/server/src/__tests__/routes/prepare-archive-v4.test.ts` | v4 5-stage 并行 + 拆分语义 |
| `apps/server/src/__tests__/routes/retry-stage-v4.test.ts` | per-stage retry `memoryExtract` / `memoryOptimize` |
| `apps/server/src/__tests__/routes/archive-confirm-v4.test.ts` | archive confirm 严格校验 5 stage + reject v3 |

### 不动文件

- `apps/server/src/services/memory-optimizer.ts` — 函数签名/行为不变,只是调用方从 prepare-archive 抽到独立 stage
- `apps/server/src/services/stages/memory-stage.ts` — `runMemoryStage` 行为不变,只是 result.memories 字段不再由本函数填
- `apps/web/src/api/chapters.ts` — `retryStage` 已接受任意 string,天然兼容

---

## Task 0: 提交 A2+B 修复 (前置 baseline)

A2+B 是 v3 当时的 hotfix,目标是 provider 兜底 + 抛错替代静默 return。和 v4 拆分独立,先独立 commit 避免混在一起。

**Files:**
- 修改: `packages/ai-provider/src/index.ts` (添加 `extractContent` helper)
- 修改: `apps/server/src/services/memory-optimizer.ts` (throw 替代静默 return)
- 修改: `apps/server/src/__tests__/provider-non-json.test.ts` (+3 测试)
- 修改: `apps/server/src/__tests__/services/memory-optimizer.test.ts` (新建, 5 测试)

- [ ] **Step 1: 跑测试验证 A2+B 当前状态**

```bash
pnpm --filter server test memory-optimizer 2>&1 | tail -20
pnpm --filter server test provider-non-json 2>&1 | tail -20
```

Expected: 8 tests passed (3 + 5)。

- [ ] **Step 2: 跑 typecheck**

```bash
pnpm typecheck
```

Expected: exit 0。

- [ ] **Step 3: git diff 展示给用户**

```bash
git status --short
git diff --stat
git diff packages/ai-provider/src/index.ts apps/server/src/services/memory-optimizer.ts apps/server/src/__tests__/ | head -200
```

把 diff 截图/粘贴给用户确认 (反馈规则 `feedback_show_before_commit`)。

- [ ] **Step 4: 用户确认后 commit**

```bash
git add packages/ai-provider/src/index.ts \
        apps/server/src/services/memory-optimizer.ts \
        apps/server/src/__tests__/provider-non-json.test.ts \
        apps/server/src/__tests__/services/memory-optimizer.test.ts
git commit -m "fix(server): provider reasoning_content 兜底 + memory-optimizer 抛错替代静默 return

- OpenAICompatibleProvider.extractContent: content 为空时兜底 reasoning_content
  (DeepSeek V4-Flash 等 thinking mode 模型把 JSON 放进 reasoning_content)
- memory-optimizer: provider 返回空内容时 throw 替代 silent return []
  (守 feedback_no_silent_errors,prepare-archive catch 标 stage failed,UI 提示用户重试)
- + 7 测试覆盖 reasoning_content 兜底 + optimizer throw 路径

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 1: 共享类型 v3 → v4 bump

**Files:**
- 修改: `packages/shared/src/archive.ts`

- [ ] **Step 1: 写失败测试 - PendingArchiveDataV4 应满足新 schema**

在 `packages/shared/src/__tests__/archive.test.ts` (新建) 写:

```ts
import { describe, it, expect } from 'vitest'
import { PendingArchiveDataV4Schema, RetryStageNameSchema } from '@novel-runtime/shared'

describe('PendingArchiveDataV4', () => {
  it('accepts 5 stages with memoryExtract/memoryOptimize split', () => {
    const result = PendingArchiveDataV4Schema.safeParse({
      version: 4,
      stages: {
        character: { status: 'success', result: { characterStates: [] } },
        memoryExtract: { status: 'success', result: { mainEvents: [], sideEvents: [], emotions: [], foreshadowing: [], relationshipChanges: [], scenes: [], summary: '' } },
        memoryOptimize: { status: 'success', result: { memories: [] } },
        plotArc: { status: 'success', result: { plotArcs: [] } },
        graph: { status: 'success', result: { chapterGraph: { nodes: [], edges: [], timestamp: '' } } }
      },
      meta: { extractedAt: '2026-07-31T00:00:00Z', chapterNumber: 1 }
    })
    expect(result.success).toBe(true)
  })

  it('rejects v3 shape (missing memoryExtract/memoryOptimize)', () => {
    const result = PendingArchiveDataV4Schema.safeParse({
      version: 4,
      stages: {
        character: { status: 'success' },
        memory: { status: 'success' },
        plotArc: { status: 'success' },
        graph: { status: 'success' }
      },
      meta: { extractedAt: '', chapterNumber: 1 }
    })
    expect(result.success).toBe(false)
  })

  it('rejects version 3', () => {
    const result = PendingArchiveDataV4Schema.safeParse({
      version: 3,
      stages: { character: {}, memory: {}, plotArc: {}, graph: {} },
      meta: { extractedAt: '', chapterNumber: 1 }
    })
    expect(result.success).toBe(false)
  })
})

describe('RetryStageName', () => {
  it('accepts v4 stage names', () => {
    expect(RetryStageNameSchema.safeParse('memoryExtract').success).toBe(true)
    expect(RetryStageNameSchema.safeParse('memoryOptimize').success).toBe(true)
    expect(RetryStageNameSchema.safeParse('character').success).toBe(true)
    expect(RetryStageNameSchema.safeParse('plotArc').success).toBe(true)
    expect(RetryStageNameSchema.safeParse('graph').success).toBe(true)
  })

  it('rejects legacy memory name', () => {
    expect(RetryStageNameSchema.safeParse('memory').success).toBe(false)
  })
})
```

- [ ] **Step 2: 跑测试验证失败**

```bash
pnpm --filter shared test archive 2>&1 | tail -20
```

Expected: FAIL (PendingArchiveDataV4Schema / RetryStageNameSchema not exported yet)。

- [ ] **Step 3: 在 `packages/shared/src/archive.ts` 加 PendingArchiveDataV4 + RetryStageName**

紧跟现有 `PendingArchiveDataV3Schema` 之后 (L325) 加:

```ts
// =================================================================
// v4 shape (2026-07-31 引入)
// 把 v3 的 memory stage 拆为 memoryExtract + memoryOptimize 两个独立 stage:
//   - memoryExtract: 仅做 raw 提取 (mainEvents/sideEvents/...)
//   - memoryOptimize: 仅做跨章融合 (memories[] layer='global')
// 两者解耦后,raw 抽取失败 optimizer 不白跑,optimizer 失败 raw 抽取不浪费。
// v3 数据直接拒绝 (archive confirm version !== 4 报 400)。
// =================================================================

export const RetryStageNameSchema = z.enum([
  'character',
  'memoryExtract',
  'memoryOptimize',
  'plotArc',
  'graph'
])
export type RetryStageName = z.infer<typeof RetryStageNameSchema>

export interface PendingArchiveDataV4 {
  version: 4
  stages: {
    character: PendingStageState
    memoryExtract: PendingStageState
    memoryOptimize: PendingStageState
    plotArc: PendingStageState
    graph: PendingStageState
  }
  cumulativeGraph?: PendingGraphSnapshot
  cumulativeGraphGeneratedAt?: string
  meta: {
    extractedAt: string
    chapterNumber: number
  }
}

export const PendingArchiveDataV4Schema = z.object({
  version: z.literal(4),
  stages: z.object({
    character: PendingStageStateSchema,
    memoryExtract: PendingStageStateSchema,
    memoryOptimize: PendingStageStateSchema,
    plotArc: PendingStageStateSchema,
    graph: PendingStageStateSchema
  }),
  cumulativeGraph: PendingGraphSnapshotSchema.optional(),
  cumulativeGraphGeneratedAt: z.string().optional(),
  meta: z.object({
    extractedAt: z.string(),
    chapterNumber: z.number()
  })
}).passthrough()

export type PendingArchiveDataV4Z = z.infer<typeof PendingArchiveDataV4Schema>
```

- [ ] **Step 4: 跑测试验证通过**

```bash
pnpm --filter shared test archive 2>&1 | tail -20
```

Expected: 5 tests passed。

- [ ] **Step 5: typecheck**

```bash
pnpm typecheck
```

Expected: exit 0 (旧 V3 引用仍可用,不破坏现有代码)。

- [ ] **Step 6: 单独 commit (类型基础设施)**

```bash
git add packages/shared/src/archive.ts packages/shared/src/__tests__/archive.test.ts
git commit -m "feat(shared): PendingArchiveDataV4 拆分 memoryExtract/memoryOptimize

把 v3 单一 memory stage 拆为 v4 两 stage:
\  - memoryExtract: raw 提取 (mainEvents/sideEvents/...)
\  - memoryOptimize: 跨章融合 (memories[] layer='global')

新增 RetryStageName 类型,枚举扩展为 5 个 stage 名 (含 'memoryExtract'/'memoryOptimize')。
v3 接口保留用于旧测试,archive confirm 仅接受 v4。

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 2: 后端 prepare-archive 拆分 5 stage

**Files:**
- 修改: `apps/server/src/routes/chapters-archive.ts` (L160-202)

- [ ] **Step 1: 写失败测试 - memoryExtract/memoryOptimize 拆 stage**

新建 `apps/server/src/__tests__/routes/prepare-archive-v4.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { buildTestApp } from '../helpers/testApp.js'
import { prismaMock } from '../helpers/prismaMock.js'
// mock stages + optimizer
vi.mock('../../services/stages/character-stage.js', () => ({
  runCharacterStage: vi.fn(async () => ({
    status: 'success', result: { characterStates: [] }, completedAt: '2026-07-31T00:00:00Z'
  }))
}))
vi.mock('../../services/stages/memory-stage.js', () => ({
  runMemoryStage: vi.fn(async () => ({
    status: 'success',
    result: { mainEvents: [{ description: '主要事件', importance: 7 }], sideEvents: [], emotions: [], foreshadowing: [], relationshipChanges: [], scenes: [], summary: '摘要' },
    completedAt: '2026-07-31T00:00:00Z'
  }))
}))
vi.mock('../../services/stages/plot-arc-stage.js', () => ({
  runPlotArcStage: vi.fn(async () => ({
    status: 'success', result: { plotArcs: [] }, completedAt: '2026-07-31T00:00:00Z'
  }))
}))
vi.mock('../../services/stages/graph-extract-stage.js', () => ({
  runGraphExtractStage: vi.fn(async () => ({
    status: 'success', result: { chapterGraph: { nodes: [], edges: [], timestamp: '' } }, completedAt: '2026-07-31T00:00:00Z'
  }))
}))
vi.mock('../../services/memory-optimizer.js', () => ({
  optimizeMemories: vi.fn(async () => [
    { content: '全局记忆', originUid: 'NEW', importance: 6, type: 'event' }
  ])
}))
// ...其他 mock 一应设置

describe('POST /api/chapters/:id/prepare-archive (v4 split)', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('writes 5 stages separately (memoryExtract + memoryOptimize)', async () => {
    const app = await buildTestApp()
    const res = await app.inject({
      method: 'POST',
      url: '/api/chapters/abc/prepare-archive',
      payload: {}
    })
    expect(res.statusCode).toBe(200)
    const data = JSON.parse(res.body).data
    expect(data.version).toBe(4)
    expect(data.stages.memoryExtract.status).toBe('success')
    expect(data.stages.memoryOptimize.status).toBe('success')
    // memory 字段不应再存在
    expect(data.stages.memory).toBeUndefined()
  })

  it('memoryOptimize fails independently when provider throws', async () => {
    const { optimizeMemories } = await import('../../services/memory-optimizer.js')
    vi.mocked(optimizeMemories).mockRejectedValueOnce(new Error('optimizer boom'))
    const app = await buildTestApp()
    const res = await app.inject({
      method: 'POST',
      url: '/api/chapters/abc/prepare-archive',
      payload: {}
    })
    expect(res.statusCode).toBe(200)
    const data = JSON.parse(res.body).data
    expect(data.stages.memoryExtract.status).toBe('success')  // raw 仍成功
    expect(data.stages.memoryOptimize.status).toBe('failed')  // optimizer 失败
    expect(data.stages.memoryOptimize.errorMessage).toContain('optimizer boom')
  })

  it('memoryExtract failed → optimizer not called (no wasted work)', async () => {
    const { runMemoryStage } = await import('../../services/stages/memory-stage.js')
    const { optimizeMemories } = await import('../../services/memory-optimizer.js')
    vi.mocked(runMemoryStage).mockResolvedValueOnce({
      status: 'failed', errorMessage: 'extract boom', completedAt: '2026-07-31T00:00:00Z'
    })
    const app = await buildTestApp()
    await app.inject({ method: 'POST', url: '/api/chapters/abc/prepare-archive', payload: {} })
    expect(optimizeMemories).not.toHaveBeenCalled()
  })
})
```

> 完整 mock 构造细节参考 `prepare-archive-v3.test.ts` 现有模式。`buildTestApp` / `prismaMock` helper 已在 `__tests__/helpers/` 下。

- [ ] **Step 2: 跑测试验证失败**

```bash
pnpm --filter server test prepare-archive-v4 2>&1 | tail -30
```

Expected: FAIL (当前实现仍合并为 single memory stage,version: 3)。

- [ ] **Step 3: 修改 `apps/server/src/routes/chapters-archive.ts` 的 prepare-archive**

把 L160-202 (4 stage 并行 + optimizer 串行) 改为:

```ts
    // 5 stage 并行: 4 个独立 stage + memoryExtract(原 memory stage 去 optimizer)
    // memoryOptimize 串行跑 (依赖 memoryExtract success)
    const [characterState, memoryExtractState, plotArcState, graphState] = await Promise.all([
      runCharacterStage(app, {
        storyId: chapter.storyId, chapterId, content: contentText, outline: outlineText,
        chapterNumber: chapter.number, matchedCharacters
      }),
      runMemoryStage(app, {
        storyId: chapter.storyId, chapterId, content: contentText, outline: outlineText,
        chapterNumber: chapter.number,
        protagonistNames, characterNames,
        existingNodeKeys, previousSnapshotNodes
      }),
      runPlotArcStage(app, {
        storyId: chapter.storyId, chapterId, content: contentText, outline: outlineText,
        chapterNumber: chapter.number, existingArcs: allExistingArcs as any,
        characterNames, latestBranchStates: dedupedBranchStates
      }),
      runGraphExtractStage(app, {
        storyId: chapter.storyId, chapterId, content: contentText, outline: outlineText,
        chapterNumber: chapter.number, characterNames, prevCumulativeGraphNodes,
        latestBranchStates: dedupedBranchStates
      })
    ])

    // 1.5. memoryOptimize (v4 拆分): 仅当 memoryExtract success 时跑 optimizer 融合
    // 失败时该 stage 独立标记 failed,不影响其他 4 stage,也不会浪费 raw 抽取结果。
    let memoryOptimizeState: any = { status: 'pending', completedAt: new Date().toISOString() }
    if (memoryExtractState.status === 'success' && memoryExtractState.result) {
      try {
        const optimized = await optimizeMemories(
          app, chapter.storyId, chapterId,
          memoryExtractState.result as any
        )
        memoryOptimizeState = {
          status: 'success',
          result: { memories: optimized },
          completedAt: new Date().toISOString()
        }
        app.log.info(
          `[PrepareArchive] optimizer: ${optimized.length} global memories for chapter ${chapter.number}`
        )
      } catch (err: any) {
        app.log.error(`[PrepareArchive] memory-optimizer failed: ${err.message}`)
        memoryOptimizeState = {
          status: 'failed',
          errorMessage: err.message,
          completedAt: new Date().toISOString()
        }
      }
    } else {
      // memoryExtract failed → optimizer 不跑,result 留空
      memoryOptimizeState = {
        status: 'failed',
        errorMessage: 'memoryExtract 未成功,跳过 optimizer',
        completedAt: new Date().toISOString()
      }
    }

    const pendingData: PendingArchiveDataV4 = {
      version: 4,
      stages: {
        character: characterState,
        memoryExtract: memoryExtractState,
        memoryOptimize: memoryOptimizeState,
        plotArc: plotArcState,
        graph: graphState
      },
      meta: {
        extractedAt: new Date().toISOString(),
        chapterNumber: chapter.number
      }
    }
```

顶部 import 同步改:
```ts
import { PendingArchiveDataV4 } from '@novel-runtime/shared'
// 删除 PendingArchiveDataV3 import (本章不再生成 v3)
```

`optimizeMemories` import 不变。

- [ ] **Step 4: 跑测试验证通过**

```bash
pnpm --filter server test prepare-archive-v4 2>&1 | tail -30
```

Expected: 3 tests passed。

- [ ] **Step 5: 跑现有 v3 测试,确认行为兼容**

```bash
pnpm --filter server test prepare-archive 2>&1 | tail -30
```

Expected: 旧 v3 测试可能因为 pendingData.version 变成 4 而 fail。这是预期 — Task 4 archive confirm 会拒 v3,Task 7 测试更新会处理。

如果旧测试单纯因为 version 数字失败,先不改它们,记录到 Task 7。

- [ ] **Step 6: 不立即 commit,继续 Task 3**

---

## Task 3: 后端 retry-stage 扩展 stageName

**Files:**
- 修改: `apps/server/src/routes/chapters-archive.ts` (L254-409)

- [ ] **Step 1: 写失败测试 - retry-stage 接受 memoryExtract/memoryOptimize**

新建 `apps/server/src/__tests__/routes/retry-stage-v4.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { buildTestApp } from '../helpers/testApp.js'
// mock 同 Task 2

describe('POST /api/chapters/:id/prepare-archive/retry-stage (v4)', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('rejects legacy stage name "memory" with 400', async () => {
    const app = await buildTestApp()
    const res = await app.inject({
      method: 'POST',
      url: '/api/chapters/abc/prepare-archive/retry-stage/memory',
      payload: {}
    })
    expect(res.statusCode).toBe(400)
    expect(JSON.parse(res.body).error).toMatch(/memoryExtract|memoryOptimize/)
  })

  it('retry-stage:memoryExtract reruns extract + optimizer (if success)', async () => {
    const { runMemoryStage } = await import('../../services/stages/memory-stage.js')
    const { optimizeMemories } = await import('../../services/memory-optimizer.js')
    const app = await buildTestApp()
    const res = await app.inject({
      method: 'POST',
      url: '/api/chapters/abc/prepare-archive/retry-stage/memoryExtract',
      payload: {}
    })
    expect(res.statusCode).toBe(200)
    expect(runMemoryStage).toHaveBeenCalled()
    expect(optimizeMemories).toHaveBeenCalled()  // extract success → optimizer 自动跑
  })

  it('retry-stage:memoryOptimize only runs optimizer, requires extract success', async () => {
    const { runMemoryStage } = await import('../../services/stages/memory-stage.js')
    const { optimizeMemories } = await import('../../services/memory-optimizer.js')
    const app = await buildTestApp()
    const res = await app.inject({
      method: 'POST',
      url: '/api/chapters/abc/prepare-archive/retry-stage/memoryOptimize',
      payload: {}
    })
    expect(res.statusCode).toBe(200)
    expect(runMemoryStage).not.toHaveBeenCalled()
    expect(optimizeMemories).toHaveBeenCalled()
  })

  it('retry-stage:memoryOptimize returns 400 if memoryExtract failed', async () => {
    // mock chapter.pendingArchiveData with memoryExtract.status='failed'
    // ... (override prisma mock)
    const app = await buildTestApp()
    const res = await app.inject({
      method: 'POST',
      url: '/api/chapters/abc/prepare-archive/retry-stage/memoryOptimize',
      payload: {}
    })
    expect(res.statusCode).toBe(400)
  })
})
```

- [ ] **Step 2: 跑测试验证失败**

```bash
pnpm --filter server test retry-stage-v4 2>&1 | tail -30
```

Expected: FAIL (当前 stageName 枚举只接受 'memory')。

- [ ] **Step 3: 修改 retry-stage 路由**

在 `chapters-archive.ts` L254-409 修改:

```ts
  app.post('/api/chapters/:chapterId/prepare-archive/retry-stage/:stageName', async (request, reply) => {
    const { chapterId, stageName } = request.params as any
    const prisma = app.prisma
    const chapter = await getOrThrowChapter(prisma, chapterId, reply)
    if (chapter === null) return

    if (chapter.status !== 'reviewing') {
      return reply.status(400).send({
        success: false,
        error: `章节当前状态为 ${chapter.status}，只允许 reviewing 状态重跑 stage`
      })
    }
    // v4 stageName: 5 个 (含 memoryExtract/memoryOptimize)
    const validStages = ['character', 'memoryExtract', 'memoryOptimize', 'plotArc', 'graph']
    if (!validStages.includes(stageName)) {
      return reply.status(400).send({
        success: false,
        error: `未知 stage: ${stageName}。v4 支持: ${validStages.join(', ')}`
      })
    }
    if (!chapter.content) {
      return reply.status(400).send({ success: false, error: '正文为空,无法重跑 stage' })
    }

    // 读已有 pendingArchiveData (v4)
    const existing = safeJsonParse<PendingArchiveDataV4 | null>(chapter.pendingArchiveData, null)
    if (!existing || existing.version !== 4) {
      return reply.status(400).send({
        success: false,
        error: '当前章节 pendingArchiveData 缺失或不是 v4,无法单 stage 重跑(请用重新准备归档)'
      })
    }

    // ... pre-stage 数据加载 (matchedCharacters / latestBranchStates / ...) 复用原逻辑

    // 单 stage 执行
    let newStage: any
    try {
      if (stageName === 'character') {
        newStage = await runCharacterStage(app, { ... })
      } else if (stageName === 'memoryExtract') {
        // v4 单独重跑 raw 抽取;extract success 自动续跑 optimizer
        newStage = await runMemoryStage(app, { ... })

        // 同步触发 memoryOptimize stage (依赖关系)
        let optimizeStage: any
        if (newStage.status === 'success' && newStage.result) {
          try {
            const optimized = await optimizeMemories(app, chapter.storyId, chapterId, newStage.result as any)
            optimizeStage = {
              status: 'success',
              result: { memories: optimized },
              completedAt: new Date().toISOString()
            }
          } catch (err: any) {
            optimizeStage = {
              status: 'failed',
              errorMessage: err.message,
              completedAt: new Date().toISOString()
            }
          }
        } else {
          optimizeStage = {
            status: 'failed',
            errorMessage: 'memoryExtract 重跑后未 success,跳过 optimizer',
            completedAt: new Date().toISOString()
          }
        }

        // 合并回 pendingArchiveData (覆盖 memoryExtract + memoryOptimize 两 stage)
        const updated: PendingArchiveDataV4 = {
          ...existing,
          stages: {
            ...existing.stages,
            memoryExtract: newStage,
            memoryOptimize: optimizeStage
          }
        }
        await prisma.chapter.update({
          where: { id: chapterId },
          data: { pendingArchiveData: JSON.stringify(updated) }
        })
        return { success: true, data: updated }
      } else if (stageName === 'memoryOptimize') {
        // 仅重跑 optimizer;要求 memoryExtract 已 success
        const extractState = existing.stages.memoryExtract
        if (extractState.status !== 'success' || !extractState.result) {
          return reply.status(400).send({
            success: false,
            error: 'memoryExtract 未成功,无法单独重跑 memoryOptimize'
          })
        }
        try {
          const optimized = await optimizeMemories(
            app, chapter.storyId, chapterId,
            extractState.result as any
          )
          newStage = {
            status: 'success',
            result: { memories: optimized },
            completedAt: new Date().toISOString()
          }
        } catch (err: any) {
          newStage = {
            status: 'failed',
            errorMessage: err.message,
            completedAt: new Date().toISOString()
          }
        }
      } else if (stageName === 'plotArc') {
        newStage = await runPlotArcStage(app, { ... })
      } else {
        newStage = await runGraphExtractStage(app, { ... })
      }
    } catch (err: any) {
      app.log.error(`[RetryStage:${stageName}] ${err.message}`)
      return reply.status(500).send({ success: false, error: `重跑 ${stageName} 失败: ${err.message}` })
    }

    // 合并回 pendingArchiveData (单 stage 路径)
    const updatedPending: PendingArchiveDataV4 = {
      ...existing,
      stages: {
        ...existing.stages,
        [stageName]: newStage
      }
    }

    await prisma.chapter.update({
      where: { id: chapterId },
      data: { pendingArchiveData: JSON.stringify(updatedPending) }
    })

    return { success: true, data: updatedPending }
  })
```

- [ ] **Step 4: 跑测试验证通过**

```bash
pnpm --filter server test retry-stage-v4 2>&1 | tail -30
```

Expected: 4 tests passed。

- [ ] **Step 5: 不立即 commit,继续 Task 4**

---

## Task 4: 后端 archive confirm 校验 v4 + 5 stage

**Files:**
- 修改: `apps/server/src/routes/chapters-archive.ts` (L529-712)

- [ ] **Step 1: 写失败测试 - archive confirm v4 严格校验**

新建 `apps/server/src/__tests__/routes/archive-confirm-v4.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest'
import { buildTestApp } from '../helpers/testApp.js'

describe('POST /api/chapters/:id/archive (v4 validation)', () => {
  it('rejects v3 payload with 400 version-mismatch', async () => {
    // mock chapter.pendingArchiveData = v3 shape
    const app = await buildTestApp()
    const res = await app.inject({
      method: 'POST', url: '/api/chapters/abc/archive', payload: {}
    })
    expect(res.statusCode).toBe(400)
    expect(JSON.parse(res.body).error).toMatch(/版本不匹配|重新准备/)
  })

  it('rejects when memoryOptimize.status=failed', async () => {
    // mock pendingArchiveData.v4 with memoryOptimize.status='failed'
    const app = await buildTestApp()
    const res = await app.inject({
      method: 'POST', url: '/api/chapters/abc/archive', payload: {}
    })
    expect(res.statusCode).toBe(400)
    expect(JSON.parse(res.body).error).toContain('memoryOptimize')
  })

  it('rejects when memoryExtract.status=failed', async () => {
    // mock memoryExtract.status='failed'
    const app = await buildTestApp()
    const res = await app.inject({
      method: 'POST', url: '/api/chapters/abc/archive', payload: {}
    })
    expect(res.statusCode).toBe(400)
    expect(JSON.parse(res.body).error).toContain('memoryExtract')
  })

  it('writes memory from memoryExtract (raw) + memoryOptimize (global)', async () => {
    // mock pendingArchiveData.v4 with all 5 stages success
    // mock prisma.memory.create to track writes
    // verify: chapter layer writes from memoryExtract.result
    //         global layer writes from memoryOptimize.result.memories
  })
})
```

- [ ] **Step 2: 跑测试验证失败**

```bash
pnpm --filter server test archive-confirm-v4 2>&1 | tail -30
```

Expected: FAIL (当前 archive confirm 仍接受 v3,内存字段未拆分)。

- [ ] **Step 3: 修改 archive confirm 路由**

在 `chapters-archive.ts` L529-712 修改:

```ts
  app.post('/api/chapters/:chapterId/archive', async (request, reply) => {
    // ... (前段 status / content / pendingRaw 校验不变)

    const pending = safeJsonParse<PendingArchiveDataV4 | null>(pendingRaw, null)
    if (!pending || pending.version !== 4) {
      return reply.status(400).send({
        success: false,
        error: '归档失败：pendingArchiveData 版本不匹配，请重新准备归档'
      })
    }
    // 严格校验 5 stage 都 success
    const failedStages = Object.entries(pending.stages)
      .filter(([_, s]) => (s as any).status !== 'success')
      .map(([name]) => name)
    if (failedStages.length > 0) {
      return reply.status(400).send({
        success: false,
        error: `归档失败：以下 stage 未通过：${failedStages.join(', ')}`
      })
    }

    // 累计图谱校验不变
    if (!pending.cumulativeGraph || !pending.cumulativeGraphGeneratedAt) { ... }

    // v4 数据来源: raw 从 memoryExtract, 优化融合从 memoryOptimize
    const extractResult: any = (pending.stages.memoryExtract as any)?.result ?? {}
    const optimizeResult: any = (pending.stages.memoryOptimize as any)?.result ?? {}

    const mainEvents: any[] = Array.isArray(extractResult.mainEvents) ? extractResult.mainEvents : []
    const sideEvents: any[] = Array.isArray(extractResult.sideEvents) ? extractResult.sideEvents : []
    const emotions: string[] = Array.isArray(extractResult.emotions) ? extractResult.emotions : []
    const foreshadowing: string[] = Array.isArray(extractResult.foreshadowing) ? extractResult.foreshadowing : []
    const relationshipChanges: string[] = Array.isArray(extractResult.relationshipChanges) ? extractResult.relationshipChanges : []
    const scenes: any[] = Array.isArray(extractResult.scenes) ? extractResult.scenes : []
    const summary: string = typeof extractResult.summary === 'string' ? extractResult.summary : ''
    const optimized: OptimizedMemory[] = Array.isArray(optimizeResult.memories) ? optimizeResult.memories : []

    // ... (后续 chapterRows / sceneRows / globalRows 构造不变,使用上面变量)
```

顶部 import 同步改:
```ts
import { PendingArchiveDataV4 } from '@novel-runtime/shared'
```

- [ ] **Step 4: 跑测试验证通过**

```bash
pnpm --filter server test archive-confirm-v4 2>&1 | tail -30
```

Expected: 4 tests passed。

- [ ] **Step 5: 跑全 server 测试,记录失败**

```bash
pnpm --filter server test 2>&1 | tail -50
```

Expected: 旧 v3 prepare-archive / retry-stage 测试因 schema 变化而 fail。**不要**在这一步动它们,标记留给 Task 7。

- [ ] **Step 6: typecheck**

```bash
pnpm typecheck
```

Expected: exit 0。

- [ ] **Step 7: commit 后端三件套 (含 Task 2 + 3 + 4)**

```bash
git add apps/server/src/routes/chapters-archive.ts \
        apps/server/src/__tests__/routes/prepare-archive-v4.test.ts \
        apps/server/src/__tests__/routes/retry-stage-v4.test.ts \
        apps/server/src/__tests__/routes/archive-confirm-v4.test.ts
git commit -m "feat(server): v4 archive 拆分 memoryExtract + memoryOptimize

把 v3 single memory stage 拆为 v4 两独立 stage:
\  - memoryExtract: raw 提取 (mainEvents/sideEvents/...)
\  - memoryOptimize: 跨章融合 (memories[])

prepare-archive: 4 并行 → 5 stage (memoryExtract 在并行,memoryOptimize 串行依赖)
retry-stage: 枚举扩展为 5 个,re-memoryExtract 自动续跑 optimizer,
re-memoryOptimize 独立重跑 (校验 extract 已 success)
archive confirm: version 校验 v4,5 stage 严格校验全 success

archive 策略: A 严格 (memoryExtract + memoryOptimize 都 success 才放行)

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 5: 前端 LocalData adapter v4

**Files:**
- 修改: `apps/web/src/views/ReviewingPanel.adapter.ts`

- [ ] **Step 1: 写失败测试 - fromV4/toV4 拆分映射**

在 `apps/web/src/views/__tests__/ReviewingPanel.adapter.test.ts` (新建) 写:

```ts
import { describe, it, expect } from 'vitest'
import { fromV4, toV4 } from '../ReviewingPanel.adapter'

describe('fromV4', () => {
  it('reads mainEvents from memoryExtract (not memoryOptimize)', () => {
    const local = fromV4({
      version: 4,
      stages: {
        memoryExtract: {
          status: 'success',
          result: { mainEvents: [{ description: 'A', importance: 7 }], sideEvents: [], emotions: [], foreshadowing: [], relationshipChanges: [], summary: '' }
        },
        memoryOptimize: { status: 'success', result: { memories: [{ content: 'B', originUid: 'NEW', importance: 5, type: 'event' }] } }
      },
      meta: { chapterNumber: 1 }
    } as any)
    expect(local.memories.memories[0].content).toBe('A')
    expect(local.memories.memories[0].tags).toContain('main-plot')
  })
})

describe('toV4', () => {
  it('writes mainEvents→memoryExtract.result and skips memoryOptimize.result.memories', () => {
    const result = toV4({
      summary: 'x',
      memories: {
        memories: [
          { content: 'A', tags: ['main-plot'], importance: 7, fromChapterNumber: 1 },
          { content: 'B', tags: ['side-plot'], importance: 4, fromChapterNumber: 1 }
        ],
        characterStates: [], emotions: [], foreshadowing: [], relationshipChanges: []
      },
      plotArcs: [],
      graph: { chapterGraph: { nodes: [], edges: [] } }
    }, { version: 4, stages: {}, meta: {} } as any)
    expect(result.stages.memoryExtract.result.mainEvents).toHaveLength(1)
    expect(result.stages.memoryExtract.result.mainEvents[0].description).toBe('A')
    expect(result.stages.memoryExtract.result.sideEvents).toHaveLength(1)
    expect(result.stages.memoryOptimize).toBeUndefined()  // 不重写 optimizer 输出
  })
})
```

- [ ] **Step 2: 跑测试验证失败**

```bash
pnpm --filter web test ReviewingPanel.adapter 2>&1 | tail -20
```

Expected: FAIL (fromV4 / toV4 not exported yet)。

- [ ] **Step 3: 修改 `ReviewingPanel.adapter.ts`**

加 v4 接口 + 转换函数,保留 v3 作为 deprecated:

```ts
// v4 shape: 5 stages
export interface V4PendingArchiveData {
  version: 4
  stages: {
    character?: { status: string; result?: any; errorMessage?: string; completedAt?: string }
    memoryExtract?: { status: string; result?: any; errorMessage?: string; completedAt?: string }
    memoryOptimize?: { status: string; result?: any; errorMessage?: string; completedAt?: string }
    plotArc?: { status: string; result?: any; errorMessage?: string; completedAt?: string }
    graph?: { status: string; result?: any; errorMessage?: string; completedAt?: string }
  }
  cumulativeGraph?: { nodes: any[]; edges: any[]; timestamp?: string }
  cumulativeGraphGeneratedAt?: string
  meta: { extractedAt?: string; chapterNumber?: number | string }
}

// LocalData 不变结构,只是 source map 改
// (existing LocalData interface 行 38-54 不变)

export function fromV4(pending: V4PendingArchiveData | null | undefined): LocalData {
  const stages = pending?.stages ?? {}
  const extract = stages.memoryExtract?.result ?? {}
  const chr = stages.character?.result ?? {}
  const plot = stages.plotArc?.result ?? {}
  const graph = stages.graph?.result ?? {}

  const chNum = Number(pending?.meta?.chapterNumber ?? 0)

  const toMemory = (ev: any, tags: string[]): LocalMemoryRow => ({
    content: ev?.description ?? '',
    tags,
    importance: typeof ev?.importance === 'number' ? ev.importance : 5,
    fromChapterNumber: chNum
  })

  const stringifyJson = (v: unknown): string => {
    if (typeof v === 'string') return v
    if (v === null || v === undefined) return ''
    try { return JSON.stringify(v, null, 2) } catch { return '' }
  }

  const characterStates: LocalCharacterState[] = (Array.isArray(chr.characterStates) ? chr.characterStates : []).map((s: any) => ({
    characterId: s?.characterId ?? null,
    name: s?.name ?? '',
    key: s?.key ?? '',
    status: stringifyJson(s?.status),
    relationships: stringifyJson(s?.relationships),
    isNew: !!s?.isNew
  }))

  return {
    summary: typeof extract.summary === 'string' ? extract.summary : '',
    memories: {
      memories: [
        ...(Array.isArray(extract.mainEvents) ? extract.mainEvents : []).map((e: any) => toMemory(e, ['main-plot'])),
        ...(Array.isArray(extract.sideEvents) ? extract.sideEvents : []).map((e: any) => toMemory(e, ['side-plot']))
      ],
      characterStates,
      emotions: Array.isArray(extract.emotions) ? extract.emotions : [],
      foreshadowing: Array.isArray(extract.foreshadowing) ? extract.foreshadowing : [],
      relationshipChanges: Array.isArray(extract.relationshipChanges) ? extract.relationshipChanges : []
    },
    plotArcs: Array.isArray(plot.plotArcs) ? plot.plotArcs : [],
    graph: {
      chapterGraph: graph.chapterGraph ?? { nodes: [], edges: [] }
    },
    cumulativeGraph: pending?.cumulativeGraph ?? { nodes: [], edges: [] },
    cumulativeGraphGeneratedAt: pending?.cumulativeGraphGeneratedAt
  }
}

export function toV4(local: LocalData, original: V4PendingArchiveData): V4PendingArchiveData {
  const stages: V4PendingArchiveData['stages'] = JSON.parse(
    JSON.stringify(original?.stages ?? {})
  )

  const memories = local.memories
  const mainEvents = memories.memories
    .filter((m) => m.tags?.includes('main-plot'))
    .map((m) => ({ description: m.content, importance: m.importance }))
  const sideEvents = memories.memories
    .filter((m) => !m.tags?.includes('main-plot'))
    .map((m) => ({ description: m.content, importance: m.importance }))

  // memoryExtract: 写回 raw 抽取字段(用户编辑后的)
  if (!stages.memoryExtract) stages.memoryExtract = { status: 'success' }
  stages.memoryExtract.result = {
    ...(stages.memoryExtract.result ?? {}),
    summary: local.summary,
    mainEvents,
    sideEvents,
    emotions: memories.emotions,
    foreshadowing: memories.foreshadowing,
    relationshipChanges: memories.relationshipChanges
  }

  // memoryOptimize: 用户不编辑这层,保留后端返回
  // (not user-editable,保留原值)

  if (!stages.character) stages.character = { status: 'success' }
  const parseJson = (v: string): any => {
    if (typeof v !== 'string') return v
    const trimmed = v.trim()
    if (!trimmed) return {}
    try { return JSON.parse(trimmed) } catch { return {} }
  }
  stages.character.result = {
    characterStates: memories.characterStates.map((s) => ({
      characterId: s.characterId,
      name: s.name,
      key: s.key,
      status: parseJson(s.status),
      relationships: parseJson(s.relationships),
      isNew: s.isNew
    }))
  }

  if (!stages.plotArc) stages.plotArc = { status: 'success' }
  stages.plotArc.result = { plotArcs: local.plotArcs }

  if (!stages.graph) stages.graph = { status: 'success' }
  stages.graph.result = { chapterGraph: local.graph.chapterGraph }

  return {
    version: 4,
    stages,
    cumulativeGraph: local.cumulativeGraph,
    cumulativeGraphGeneratedAt: local.cumulativeGraphGeneratedAt,
    meta: original?.meta ?? {}
  }
}

// === v3 deprecated (保留兼容,旧测试可继续引用) ===
// fromV3 / toV3 / V3PendingArchiveData 保留原样不动
```

- [ ] **Step 4: 跑测试验证通过**

```bash
pnpm --filter web test ReviewingPanel.adapter 2>&1 | tail -20
```

Expected: 2 tests passed。

- [ ] **Step 5: typecheck**

```bash
pnpm typecheck
```

Expected: exit 0 (旧 V3 引用仍可用)。

- [ ] **Step 6: 不立即 commit,继续 Task 6**

---

## Task 6: 前端 ReviewingPanel 两步进度 UI

**Files:**
- 修改: `apps/web/src/views/ReviewingPanel.vue`
- 修改: `apps/web/src/composables/useChapterEditor.ts`

- [ ] **Step 1: 写失败测试 - StageName 扩展接受 memoryExtract/memoryOptimize**

新建 `apps/web/src/views/__tests__/ReviewingPanel.split-stage.test.ts` 或扩展现有测试:

```ts
import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import ReviewingPanel from '../ReviewingPanel.vue'

describe('ReviewingPanel v4 split', () => {
  it('renders two-step progress bar in 记忆 tab', async () => {
    const wrapper = mount(ReviewingPanel, {
      props: {
        pending: {
          version: 4,
          stages: {
            memoryExtract: { status: 'success', result: { mainEvents: [], sideEvents: [], emotions: [], foreshadowing: [], relationshipChanges: [], summary: '' } },
            memoryOptimize: { status: 'failed', errorMessage: 'optimizer boom' }
          },
          meta: { chapterNumber: 1 }
        },
        chapterId: 'abc'
      }
    })
    expect(wrapper.text()).toContain('抽取')
    expect(wrapper.text()).toContain('优化')
    expect(wrapper.text()).toContain('optimizer boom')
  })

  it('hides restart button for memoryExtract when status=success', async () => {
    const wrapper = mount(ReviewingPanel, {
      props: {
        pending: {
          version: 4,
          stages: {
            memoryExtract: { status: 'success', result: {} },
            memoryOptimize: { status: 'success', result: { memories: [] } }
          },
          meta: { chapterNumber: 1 }
        },
        chapterId: 'abc'
      }
    })
    // memoryExtract 是 success → "重启抽取" 按钮不应渲染
    expect(wrapper.find('[data-test="restart-memoryExtract"]').exists()).toBe(false)
  })

  it('shows restart button for memoryOptimize when status=failed', async () => {
    const wrapper = mount(ReviewingPanel, {
      props: {
        pending: {
          version: 4,
          stages: {
            memoryExtract: { status: 'success', result: {} },
            memoryOptimize: { status: 'failed', errorMessage: 'boom' }
          },
          meta: { chapterNumber: 1 }
        },
        chapterId: 'abc'
      }
    })
    const btn = wrapper.find('[data-test="restart-memoryOptimize"]')
    expect(btn.exists()).toBe(true)
    btn.trigger('click')
    expect(wrapper.emitted('retry-stage')?.[0]).toEqual(['memoryOptimize'])
  })

  it('shows "重新解析两步" total entry regardless of stage status', async () => {
    const wrapper = mount(ReviewingPanel, {
      props: {
        pending: {
          version: 4,
          stages: {
            memoryExtract: { status: 'success', result: {} },
            memoryOptimize: { status: 'success', result: { memories: [] } }
          },
          meta: { chapterNumber: 1 }
        },
        chapterId: 'abc'
      }
    })
    const btn = wrapper.find('[data-test="restart-all-memory"]')
    expect(btn.exists()).toBe(true)
  })
})
```

- [ ] **Step 2: 跑测试验证失败**

```bash
pnpm --filter web test ReviewingPanel 2>&1 | tail -30
```

Expected: FAIL (无 data-test 属性,无两步进度条)。

- [ ] **Step 3: 修改 `ReviewingPanel.vue` 的 script setup + template**

**script 部分** (line 437-451):

```ts
const props = defineProps<{
  pending: V4PendingArchiveData
  retryingStages?: Partial<Record<StageName, boolean>>
  chapterId: string
  archiveRunning?: boolean
}>()

type StageName = 'character' | 'memoryExtract' | 'memoryOptimize' | 'plotArc' | 'graph'
```

import 改:
```ts
import {
  fromV4, toV4,
  type V4PendingArchiveData, type LocalData
} from './ReviewingPanel.adapter'
```

`localData` 初始化 (line 461):
```ts
const localData = ref<LocalData>(fromV4(props.pending))
watch(() => props.pending, (next) => {
  localData.value = fromV4(next)
})
```

`stageStatus` / `isRetrying` / `dotColor` 函数 (line 472-494) 不变,只是 StageName 扩展。

`handleSave` / `handleConfirm` (line 655-672) 改 emit:
```ts
function handleSave() {
  pullGraphDraftIntoLocalData()
  pullCumulativeDraftIntoLocalData()
  saving.value = true
  try { emit('save', toV4(localData.value, props.pending)) }
  finally { saving.value = false }
}
function handleConfirm() {
  if (!localData.value.cumulativeGraphGeneratedAt) {
    message.error('请先生成累计图谱再归档')
    return
  }
  pullGraphDraftIntoLocalData()
  pullCumulativeDraftIntoLocalData()
  emit('confirm', toV4(localData.value, props.pending))
}
```

**template 记忆 tab** (line 112-170) 替换为:

```vue
<n-tab-pane name="memories">
  <template #tab>
    <span class="rp-tab-label">
      <span class="rp-tab-dot" :style="{ background: dotColor('memoryExtract') }" aria-hidden="true" />
      记忆
    </span>
  </template>

  <!-- 两步进度条(v4 split) -->
  <n-card size="small" style="margin-bottom: 16px">
    <n-space vertical size="small">
      <!-- 步骤 1: 抽取 -->
      <n-space align="center" :wrap="false">
        <span class="rp-step-dot" :class="stepDotClass('memoryExtract')" aria-hidden="true">
          {{ stepDotMark('memoryExtract') }}
        </span>
        <span class="rp-step-label">抽取</span>
        <n-button
          v-if="stageStatus('memoryExtract') === 'failed'"
          size="tiny"
          type="warning"
          :disabled="isRetrying('memoryExtract')"
          data-test="restart-memoryExtract"
          @click="emit('retry-stage', 'memoryExtract')"
        >
          重启抽取
        </n-button>
      </n-space>
      <div v-if="stageStatus('memoryExtract') === 'failed'" class="rp-stage-error">
        <strong>抽取失败:</strong> {{ props.pending?.stages?.memoryExtract?.errorMessage || '未知错误' }}
      </div>

      <!-- 步骤 2: 优化 -->
      <n-space align="center" :wrap="false">
        <span class="rp-step-dot" :class="stepDotClass('memoryOptimize')" aria-hidden="true">
          {{ stepDotMark('memoryOptimize') }}
        </span>
        <span class="rp-step-label">优化</span>
        <n-button
          v-if="stageStatus('memoryOptimize') === 'failed'"
          size="tiny"
          type="warning"
          :disabled="isRetrying('memoryOptimize')"
          data-test="restart-memoryOptimize"
          @click="emit('retry-stage', 'memoryOptimize')"
        >
          重启优化
        </n-button>
      </n-space>
      <div v-if="stageStatus('memoryOptimize') === 'failed'" class="rp-stage-error">
        <strong>优化失败:</strong> {{ props.pending?.stages?.memoryOptimize?.errorMessage || '未知错误' }}
      </div>

      <!-- 总入口: 始终保留 -->
      <n-button
        size="small"
        :disabled="isRetrying('memoryExtract') || isRetrying('memoryOptimize')"
        data-test="restart-all-memory"
        @click="handleRestartAllMemory"
      >
        重新解析两步
      </n-button>
    </n-space>
  </n-card>

  <!-- 原有记忆编辑器(mainEvents/sideEvents/emotions/...) -->
  <n-space vertical size="large" style="width: 100%">
    <n-card title="提取的记忆" size="small">
      <n-space vertical style="width: 100%">
        <n-collapse :default-expanded-names="['mainEvents']">
          <!-- 原有 mainEvents / sideEvents / emotions collapse-item 保留 -->
          ... (复制原 L131-165)
        </n-collapse>
      </n-space>
    </n-card>
  </n-space>
</n-tab-pane>
```

加 helper:
```ts
function stepDotMark(name: StageName): string {
  const s = stageStatus(name)
  if (s === 'success') return '✓'
  if (s === 'failed') return '✗'
  return '○'
}
function stepDotClass(name: StageName): string {
  const s = stageStatus(name)
  if (s === 'success') return 'is-positive'
  if (s === 'failed') return 'is-error'
  return 'is-muted'
}
function handleRestartAllMemory() {
  // 重跑两步: 先 extract (会自动续跑 optimizer)
  emit('retry-stage', 'memoryExtract')
}
```

加 scoped style:
```vue
<style scoped>
.rp-step-dot {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  font-size: 12px;
  font-weight: 600;
  color: white;
}
.rp-step-dot.is-positive { background: var(--color-positive); }
.rp-step-dot.is-error { background: var(--color-error); }
.rp-step-dot.is-muted { background: var(--color-muted-ash); }
.rp-step-label {
  font-size: 14px;
  font-weight: 500;
}
</style>
```

`defineEmits` 同步 (line 445-451):
```ts
const emit = defineEmits<{
  (e: 'save', data: V4PendingArchiveData): void
  (e: 'confirm', data: V4PendingArchiveData): void
  (e: 'cancel'): void
  (e: 'reprepare'): void
  (e: 'retry-stage', stageName: StageName): void
}>()
```

- [ ] **Step 4: 修改 `useChapterEditor.ts`**

`retryChapterStage` 函数 (line 240-261) 改 stageName 类型:

```ts
async function retryChapterStage(
  stageName: 'character' | 'memoryExtract' | 'memoryOptimize' | 'plotArc' | 'graph'
) {
  // ... (内部逻辑不变,只是 type 扩展)
}
```

- [ ] **Step 5: 跑测试验证通过**

```bash
pnpm --filter web test ReviewingPanel 2>&1 | tail -30
```

Expected: 4 tests passed。

- [ ] **Step 6: typecheck**

```bash
pnpm typecheck
```

Expected: exit 0。

- [ ] **Step 7: 跑全 web 测试**

```bash
pnpm --filter web test 2>&1 | tail -30
```

Expected: 全部通过 (旧 V3 测试可能因 V3PendingArchiveData 仍可用而不报)。

- [ ] **Step 8: commit 前端**

```bash
git add apps/web/src/views/ReviewingPanel.vue \
        apps/web/src/views/ReviewingPanel.adapter.ts \
        apps/web/src/composables/useChapterEditor.ts \
        apps/web/src/views/__tests__/ReviewingPanel.split-stage.test.ts
git commit -m "feat(web): v4 ReviewingPanel 两步进度条 + per-stage 重启按钮

记忆 tab 新增两步骤进度卡:
\  - 步骤 1 抽取: 状态点 + 失败时显「重启抽取」
\  - 步骤 2 优化: 状态点 + 失败时显「重启优化」
\  - 总入口「重新解析两步」: 始终保留,重跑两步

LocalData adapter 加 fromV4/toV4,V3 保留为 deprecated 兼容旧测试。
useChapterEditor.retryChapterStage 类型扩展接受 memoryExtract/memoryOptimize。

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 7: 文档更新 LOGIC.md

**Files:**
- 修改: `docs/LOGIC.md`

- [ ] **Step 1: 修改 §2 归档流水线图表**

把保留 v3 描述的部分 (line 188-204) 更新为 v4:

```markdown
**归档流水线** (v4 — 5 stage 拆分 memory)：

```
[prepare-archive]                       [archive 确认]
4 stage 并行 (Promise.all):  ─┐
  character / memoryExtract /  │ ← 纯 AI 调用, 结果各自落
  plot-arc / graph-extract    │   pendingArchiveData.stages[name]
  + 串行 memoryOptimize:      │
    (仅 memoryExtract success │   pendingArchiveData version: 4
     时跑 optimizer)          ┘
                                ↓
[cumulative-graph/build]  用户主动点「生成累计图谱」→
  services/cumulative-graph.ts 合并 → 写 pendingArchiveData.cumulativeGraph
                            ┌─ 校验: 5 stage 全 success + 累计图谱已生成
                            │   pendingArchiveData.version === 4
                            │   (v3 数据直接 400 拒,提示用户重新准备归档)
                            └─  prisma.$transaction 内依次写
                                Memory 三层 (chapter / scene / global,
                                data 源: memoryExtract.result + memoryOptimize.result.memories)
                                + Chapter.summary + Chapter 三列
                                + 翻 status='archived'
```

**v4 拆分动机**: v3 单 `memory` stage 串行 extractor+optimizer 有 2 类脆弱:
1. extractor 失败 → optimizer 白跑 (AI 调用成本)
2. extractor 成功 + optimizer 失败 → 整 stage 标 failed, extractor work 浪费

v4 拆 `memoryExtract` + `memoryOptimize` 为 2 独立 stage, 任一失败可独立重启。

- [ ] **Step 2: 修改 §6 v3 Stage 边界 → v4**

把 line 348-396 整段 (v3 stage 边界) 更新为 v4:

```markdown
## §6 · v4 Stage 边界 (2026-07-31, branch `v4/memory-split-stages`)

v4 把 v3 单 `memory` stage 拆为 `memoryExtract` + `memoryOptimize`:

```
stages: {
  character:     PendingStageState<CharacterStageResult>
  memoryExtract: PendingStageState<MemoryStageResult>   // raw 提取
  memoryOptimize: PendingStageState<{ memories: OptimizedMemory[] }>  // 跨章融合
  plotArc:       PendingStageState<PlotArcStageResult>
  graph:         PendingStageState<GraphExtractStageResult>
}
```

**依赖关系**: memoryOptimize 仅在 memoryExtract success 时跑。retry-stage:memoryExtract 也会自动续跑 optimizer (避免用户手动重跑两步)。retry-stage:memoryOptimize 独立重跑,要求 memoryExtract 已 success。

**Archive 策略**: A 严格 (memoryExtract + memoryOptimize 都 success 才放行)。任一失败 archive confirm 直接 400。

**Retry-stage 枚举**: `['character', 'memoryExtract', 'memoryOptimize', 'plotArc', 'graph']` (5 个,v3 'memory' 弃用)。

**UI 反馈**: ReviewingPanel 记忆 tab 顶部两步进度条 (步骤 1 / 步骤 2),per-stage 失败时显独立重启按钮,通过后按钮消失。总入口「重新解析两步」始终保留。

**v3 → v4 兼容**: archive confirm 校验 version === 4,v3 数据报 400「版本不匹配,请重新准备归档」。
```

- [ ] **Step 3: 修改 §3 调用图 (line 250-274)**

把 `POST /api/chapters/:id/prepare-archive` 块中 `stages.memory` 提及改为 `stages.memoryExtract/memoryOptimize`:

```markdown
POST /api/chapters/:id/prepare-archive
  └─ prepare-archive route (chapters-archive.ts)
       ├─ runCharacterStage (stages/character-stage.ts)
       ├─ runMemoryStage (stages/memory-stage.ts)        → memoryExtract
       ├─ runPlotArcStage (stages/plot-arc-stage.ts)
       └─ runGraphExtractStage (stages/graph-extract-stage.ts)
       ↑ 4 个 stage 并行,结果落 pendingArchiveData.stages[name]
       串行: optimizeMemories → memoryOptimize (memoryExtract success 时)
```

`POST /api/chapters/:id/prepare-archive/retry-stage/:name` 块:

```markdown
POST /api/chapters/:id/prepare-archive/retry-stage/:stageName
  └─ v4 stageName: 'character' | 'memoryExtract' | 'memoryOptimize' | 'plotArc' | 'graph'
       └─ memoryExtract 重跑后自动续跑 optimizer
       └─ memoryOptimize 独立重跑,要求 memoryExtract 已 success
```

`POST /api/chapters/:id/archive` 块:

```markdown
POST /api/chapters/:id/archive
  └─ safeJsonParse (chapter.pendingArchiveData)        [version === 4]
  └─ 校验 5 stage 全 success
  └─ memoryExtract.result → chapter / scene / summary  Memory 写入
  └─ memoryOptimize.result.memories → global           Memory 写入
  └─ prisma.$transaction 内:
       ├─ tx.memory.create (chapter / scene / global 三层)
       ├─ tx.chapter.update({ summary })
       └─ tx.chapter.update({ chapterGraph / cumulativeGraph / cumulativeGraphGeneratedAt,
                              pendingArchiveData: null, status: 'archived' })
```

- [ ] **Step 4: 修改 pendingArchiveData v3 → v4**

把 lines 397-422 整段 (PendingArchiveDataV3 type) 更新为 v4:

```typescript
interface PendingArchiveDataV4 {
  version: 4
  stages: {
    character: PendingStageState
    memoryExtract: PendingStageState
    memoryOptimize: PendingStageState
    plotArc: PendingStageState
    graph: PendingStageState
  }
  meta: {
    extractedAt: string
    chapterNumber: number
  }
}
```

- [ ] **Step 5: 校验文档一致性**

```bash
grep -n "stages.memory" docs/LOGIC.md
```

Expected: 0 hits (v3 字段不应残留;若有,改为 stages.memoryExtract)。

- [ ] **Step 6: 跑全测试 + typecheck**

```bash
pnpm typecheck
pnpm test 2>&1 | tail -20
```

Expected: 全绿。

- [ ] **Step 7: commit 文档**

```bash
git add docs/LOGIC.md
git commit -m "docs(LOGIC): v4 memory pipeline split stages 同步

\  - §2 归档流水线流程图: 5 stage + A 严格 strategy
\  - §3 调用图: prepare-archive / retry-stage / archive 三端点更新
\  - §6 v4 stage 边界: memoryExtract + memoryOptimize 拆分动机 + 失败语义
\  - pendingArchiveDataV4 schema (v3 字段全替换)

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 8: 最终验证

- [ ] **Step 1: 跑全测试**

```bash
pnpm test 2>&1 | tail -30
```

Expected: 全绿 (439 + 新增测试)。

- [ ] **Step 2: typecheck**

```bash
pnpm typecheck
```

Expected: exit 0。

- [ ] **Step 3: lint (如有)**

```bash
pnpm lint 2>&1 | tail -20
```

Expected: exit 0。

- [ ] **Step 4: git diff 展示给用户**

```bash
git log --oneline -10
git diff main..v2/state-machine --stat
```

把 commit 列表 + 改动文件清单给用户确认 (守 feedback_show_before_commit 反馈规则)。

- [ ] **Step 5: 用户确认后,执行 finishing-a-development-branch**

调 `superpowers:finishing-a-development-branch` skill,验证测试 + 4 选项菜单。

---

## Self-Review (写完计划自检)

**1. Spec 覆盖**: 
- 数据结构 v4 ✓ (Task 1)
- 后端 5 stage 拆分 ✓ (Task 2)
- 后端 retry-stage 5 stageName ✓ (Task 3)
- 后端 archive confirm 严格校验 ✓ (Task 4)
- 前端 LocalData adapter v4 ✓ (Task 5)
- 前端两步进度 UI ✓ (Task 6)
- A 严格 archive 策略 ✓ (Task 4 archive confirm)
- 文档更新 ✓ (Task 7)
- 前置 A2+B commit ✓ (Task 0)

**2. Placeholder 扫描**: 无 TBD / TODO / "类似 Task N"。

**3. 类型一致性**: 
- `PendingArchiveDataV4.stages` 字段名 (memoryExtract / memoryOptimize) 在 Task 1 类型定义、Task 2 prepare-archive、Task 3 retry-stage、Task 4 archive confirm、Task 5 adapter、Task 6 UI 六处一致。
- `RetryStageName` 枚举 ['character','memoryExtract','memoryOptimize','plotArc','graph'] 在 Task 1 类型定义、Task 3 retry-stage 校验、Task 6 UI StageName type 三处一致。

**4. 边界场景**:
- memoryExtract 失败 → optimizer 不跑 (Task 2 测试覆盖)
- memoryOptimize 失败 → memoryExtract 仍 success (Task 2 测试覆盖)
- v3 数据 → archive confirm 400 (Task 4 测试覆盖)
- retry-stage:memoryOptimize 在 memoryExtract 失败时 400 (Task 3 测试覆盖)

**5. 不变量**:
- 旧 V3 interface / 函数保留,旧测试可继续运行 (Task 5 注释,L268 LOC 不变)
- Chapter 三列全程不被读写 (v4 沿用 v3 不变量)
- 新 UID 在 archive confirm 生成 (Task 4 L667-673 沿用)

---

## 计划落档完毕

接下来按 subagent-driven-development 走完 Task 0-8,共 6 个 commit (A2+B 1 + v4 5)。
