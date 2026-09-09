# v3 PlotArc 写库接通 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 `chapters-archive.ts:archive` 端点的 `prisma.$transaction` 内调 `commitPlotArcWrites`,让 plot-consolidator 输出真正落到 PlotArc 表,修 v3 已知遗留。

**Architecture:** 单 line 改动 + 注释同步 + 文档同步 + 1 个新测试文件覆盖 happy path + rollback 路径。`commitPlotArcWrites` 内部不动 (13 个 unit test 覆盖)。

**Tech Stack:** Fastify, Prisma, Vitest, Zod, TypeScript

---

## 文件结构

| 路径 | 改动 |
|------|------|
| `apps/server/src/routes/chapters-archive.ts` | + 1 import, + 1 call, 注释 1 处改写 |
| `apps/server/src/__tests__/routes/archive-plot-arc-write.test.ts` | **新建** — happy path + rollback 2 个 describe |
| `docs/LOGIC.md` | 阶段 3 描述 + 备注同步 |

**不改动**:
- `apps/server/src/services/plot-extractor.ts` — `commitPlotArcWrites` 内部不动
- `apps/server/src/services/plot-consolidator.ts` — prompt 不动 (用户原话)
- `prisma/schema.prisma` — 字段不动 (跑通后调查再做决策)

**测试 setup 沿用 `__tests__/setup.ts`**: `createMockApp(mockPrisma)` + `callHandler(routes, ...)` + `chapterArchiveRoutes(app)` 注册路由。参考 `__tests__/routes/prepare-archive-v3.test.ts` 已有写法。

---

## Task 1: 写失败测试 — `archive-plot-arc-write.test.ts`

**Files:**
- Create: `apps/server/src/__tests__/routes/archive-plot-arc-write.test.ts`

**目标**: 1 个新测试文件, 含 2 个 it (happy path + rollback)。先 commit 失败测试, 验证它真的失败 (因为 archive 端点还没接通 commitPlotArcWrites)。

### Step 1.1: 写测试文件

完整代码:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createMockApp, callHandler } from '../setup.js'

const ts = '2026-07-25T00:00:00.000Z'

const plotArcWrite = {
  storyId: 'test-story',
  name: '不速之客',
  type: 'main',
  status: 'active',
  progress: 10,
  stages: '[{"stage":"初遇","completed":false,"description":"楼道偶遇"}]',
  currentStage: '初遇',
  nextGoal: '适应现代',
  unresolved: '["穿越原因"]',
  summary: '楼道偶遇采药少女',
  isNew: true
}

const basePending = {
  version: 3,
  stages: {
    character: { status: 'success', result: { characterStates: [] } },
    memory: {
      status: 'success',
      result: {
        mainEvents: [{ description: '主角觉醒', importance: 8 }],
        sideEvents: [],
        emotions: [],
        foreshadowing: [],
        relationshipChanges: [],
        scenes: [],
        summary: '主角觉醒',
        memories: []
      }
    },
    plotArc: {
      status: 'success',
      result: { plotArcs: [plotArcWrite] }
    },
    graph: {
      status: 'success',
      result: { chapterGraph: { nodes: [], edges: [] } },
      completedAt: ts
    }
  },
  cumulativeGraph: { nodes: [], edges: [] },
  cumulativeGraphGeneratedAt: ts,
  meta: { chapterNumber: 1 }
}

const baseChapter = {
  id: 'ch-1',
  storyId: 'test-story',
  number: 1,
  title: '第1章 测试',
  status: 'reviewing',
  content: 'a'.repeat(200),
  outline: 'short',
  pendingArchiveData: JSON.stringify(basePending),
  chapterGraph: null,
  cumulativeGraph: null
}

describe('archive v3 — PlotArc 写库 (P0 修复)', () => {
  let mockPrisma: any
  let routes: Record<string, any>

  beforeEach(async () => {
    vi.clearAllMocks()
    mockPrisma = {
      chapter: {
        findUnique: vi.fn(),
        findFirst: vi.fn().mockResolvedValue(null),
        update: vi.fn(),
        updateMany: vi.fn()
      },
      character: { findMany: vi.fn().mockResolvedValue([]) },
      characterBranchState: { findMany: vi.fn().mockResolvedValue([]) },
      plotArc: {
        findMany: vi.fn().mockResolvedValue([]),
        create: vi.fn().mockResolvedValue({ id: 'new-arc-1' }),
        update: vi.fn().mockResolvedValue({ id: 'updated-arc-1' })
      },
      memory: { create: vi.fn().mockResolvedValue({ id: 'mem-1' }) },
      $transaction: vi.fn(async (fn: any) => fn(mockPrisma))
    }
    const { chapterArchiveRoutes } = await import('../../routes/chapters-archive.js')
    const built = createMockApp(mockPrisma)
    await chapterArchiveRoutes(built.app)
    routes = built.routes
  })

  it('happy path: archive confirm 触发 commitPlotArcWrites → PlotArc 表新增/更新', async () => {
    mockPrisma.chapter.findUnique.mockResolvedValue({ ...baseChapter })

    const result = await callHandler(
      routes, 'POST', '/api/chapters/:chapterId/archive',
      undefined, { chapterId: 'ch-1' }
    )

    expect(result.body).toMatchObject({ success: true })
    // 关键断言: tx.plotArc.create 被调 1 次 (承接 consolidator 输出的 isNew arc)
    expect(mockPrisma.plotArc.create).toHaveBeenCalledTimes(1)
    expect(mockPrisma.plotArc.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          storyId: 'test-story',
          name: '不速之客',
          type: 'main',
          progress: 10,
          lastTouchedChapter: 1
        })
      })
    )
    // 章节翻 archived
    expect(mockPrisma.chapter.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'archived' })
      })
    )
  })

  it('rollback: commitPlotArcWrites 抛错 → 整个 transaction rollback, chapter 保持 reviewing', async () => {
    mockPrisma.chapter.findUnique.mockResolvedValue({ ...baseChapter })
    // 让 plotArc.create 抛错 (模拟 AI 字段异常等极端情况)
    mockPrisma.plotArc.create.mockRejectedValue(new Error('plotArc.create failed'))

    const result = await callHandler(
      routes, 'POST', '/api/chapters/:chapterId/archive',
      undefined, { chapterId: 'ch-1' }
    )

    expect(result.status).toBe(500)
    expect(result.body).toMatchObject({ success: false })
    // 章节 status 没翻 archived (rollback 生效)
    const updateCalls = mockPrisma.chapter.update.mock.calls
    const archivedUpdate = updateCalls.find((c: any[]) => c[0]?.data?.status === 'archived')
    expect(archivedUpdate).toBeUndefined()
  })
})
```

### Step 1.2: 跑测试 — 验证失败

```bash
pnpm --filter server test archive-plot-arc-write
```

**Expected**: 第一个 it FAIL with `expect(mockPrisma.plotArc.create).toHaveBeenCalledTimes(1)` — 因为 archive 端点还没调 `commitPlotArcWrites`。

第二个 it 在没接通前 status 可能是 200 (因为 happy path body absent → 章节 update 没翻 archived, 因为 `commitPlotArcWrites` 还没接通, transaction 内部不抛错, chapter.update 翻 archived 成功)。所以第二个测试也会失败 (status 200 不等于 500)。这没关系,后续 task 2 会让两个测试都 PASS。

### Step 1.3: 提交失败测试

```bash
git add apps/server/src/__tests__/routes/archive-plot-arc-write.test.ts
git commit -m "test(server): 新增 archive-plot-arc-write 测试 (验证接通前 FAIL)"
```

---

## Task 2: 接通 archive confirm 写库

**Files:**
- Modify: `apps/server/src/routes/chapters-archive.ts:1-12` (import), `:667-686` ($transaction)

### Step 2.1: 添加 import

定位 `apps/server/src/routes/chapters-archive.ts` 顶部 import 段 (line 1-12), 在 `runGraphExtractStage` import 之后加 `commitPlotArcWrites` import。完整顶部 import 改为:

```ts
import type { FastifyInstance } from 'fastify'
import { randomBytes } from 'crypto'
import { PrepareArchiveRequestSchema, safeJsonParse } from '@novel-runtime/shared'
import type { PendingArchiveDataV3 } from '@novel-runtime/shared'
import { parseBody, getOrThrowChapter } from './_helpers.js'
import { runCharacterStage } from '../services/stages/character-stage.js'
import { runMemoryStage } from '../services/stages/memory-stage.js'
import { runPlotArcStage } from '../services/stages/plot-arc-stage.js'
import { runGraphExtractStage } from '../services/stages/graph-extract-stage.js'
import { commitPlotArcWrites } from '../services/plot-extractor.js'
import { optimizeMemories, type OptimizedMemory } from '../services/memory-optimizer.js'
import type { GraphSnapshot } from '../services/graph-snapshot.js'
import { buildCumulativeGraph } from '../services/cumulative-graph.js'
```

### Step 2.2: 在 $transaction 内调 commitPlotArcWrites

定位 `apps/server/src/routes/chapters-archive.ts:667-686` (注释 + $transaction 块)。

**修改** (精确 2 处):

**A. 改 L667 注释** (注释从"...+ 翻 status" → "...+ PlotArc + ...")

```ts
    // commit-only: prisma.$transaction 内一次写完三层 + PlotArc + Chapter.summary + Chapter 三列 + 翻 status
```

**B. 改 L668 注释** (移除 "PlotArc 写入另文档讨论,本端点不写" 这部分)

```ts
    // 备注: CharacterBranchState 写入另文档讨论,本端点不写
```

**C. $transaction 块内,在 `tx.memory.create` 循环之后, `tx.chapter.update` 之前**, 插入 `commitPlotArcWrites` 调用:

```ts
    await prisma.$transaction(async (tx) => {
      for (const data of [...chapterRows, ...sceneRows, ...globalRows]) {
        await tx.memory.create({ data })
      }
      // 接通 v3 PlotArc 写库 (修 P0 遗留): consolidator 输出 → PlotArc 表
      await commitPlotArcWrites(tx, chapter.number, pending.plotArcs)
      await tx.chapter.update({
        where: { id: chapterId },
        data: {
          summary,
          status: 'archived',
          pendingArchiveData: null,
          chapterGraph,
          cumulativeGraph: JSON.stringify(pending.cumulativeGraph),
          cumulativeGraphGeneratedAt: pending.cumulativeGraphGeneratedAt
            ? new Date(pending.cumulativeGraphGeneratedAt)
            : null
        }
      })
    })
```

### Step 2.3: 跑测试 — 验证通过

```bash
pnpm --filter server test archive-plot-arc-write
```

**Expected**: 两个 it PASS。

如果 fail:
- `mockPrisma.plotArc.create` 没被调 → 检查 `$transaction` 是否真的传 tx 进 `commitPlotArcWrites`
- `expect(... lastTouchedChapter: 1)` 失败 → 检查 `pending.plotArcs` 是否能正确从 `pendingArchiveData.stages.plotArc.result.plotArcs` 解出
- rollback 测试 fail → 查 `$transaction` 实现是否真的抛错 (Prisma 真的 rollback 行为依赖实数据库, mock 模式下手动 throw)

### Step 2.4: 跑全部 server 测试防止回归

```bash
pnpm --filter server test
```

**Expected**: 全部测试 PASS。`plot-extractor.test.ts` 13 个 + `plot-consolidator.test.ts` 全部 + `prepare-archive-v3.test.ts` 全部 + 新增 2 个 — 全绿。

### Step 2.5: 提交接通

```bash
git add apps/server/src/routes/chapters-archive.ts
git commit -m "fix(server): 接通 v3 archive confirm 写 PlotArc 表"
```

---

## Task 3: 同步 LOGIC.md

**Files:**
- Modify: `docs/LOGIC.md:193` (阶段 3 描述) + `:198-203` (阶段 3 当前实现)

### Step 3.1: 改 LOGIC.md L193

定位 `docs/LOGIC.md:193` (在最终确认前用 grep 找位置):

```markdown
| 3 落列 | `routes/chapters-archive.ts:archive` | `archive` | 0 次 | 校验失败返回 400，章节维持 `reviewing`；`prisma.$transaction` 内写 Memory 三层 + Chapter.summary + Chapter 三列 + 翻 status（CharacterBranchState / PlotArc 写入另文档） |
```

替换为:

```markdown
| 3 落列 | `routes/chapters-archive.ts:archive` | `archive` | 0 次 | 校验失败返回 400，章节维持 `reviewing`；`prisma.$transaction` 内写 Memory 三层 + PlotArc (`commitPlotArcWrites`) + Chapter.summary + Chapter 三列 + 翻 status（CharacterBranchState 写入另文档） |
```

### Step 3.2: 改 LOGIC.md L198-203

定位 `docs/LOGIC.md:198-203`:

```markdown
**阶段 3 当前实现**：`prisma.$transaction` 内依次写：
1. `tx.memory.create` 每条 mainEvent / sideEvent / emotion / foreshadowing / relationshipChange 写入 `layer='chapter'`（mainEvent 多带 `'main-plot'` tag）；每条 scene 写 `layer='scene'`；每条 optimizer 融合记忆写 `layer='global'`（tag 加 `event` / `state`）。
2. `tx.chapter.update({ summary })` 写 Chapter 摘要（不进 Memory 表）。
3. `tx.chapter.update({ chapterGraph, cumulativeGraph, cumulativeGraphGeneratedAt, status: 'archived', pendingArchiveData: null })`。

CharacterBranchState / PlotArc 写入不在本端点（用户单独做）。`TimelineEvent` 在 v3 删除，不再写。
```

替换为:

```markdown
**阶段 3 当前实现**：`prisma.$transaction` 内依次写：
1. `tx.memory.create` 每条 mainEvent / sideEvent / emotion / foreshadowing / relationshipChange 写入 `layer='chapter'`（mainEvent 多带 `'main-plot'` tag）；每条 scene 写 `layer='scene'`；每条 optimizer 融合记忆写 `layer='global'`（tag 加 `event` / `state`）。
2. `tx.commitPlotArcWrites(chapter.number, pending.plotArcs)` 写 PlotArc 表（接 v3, 2026-07-30）：包含 consolidator 输出的 isNew / update / closed 写库、lastTouchedChapter 刷新、stale 自动检测、Jaccard 兜底（详见 `services/plot-extractor.ts` 与 `docs/superpowers/specs/2026-07-30-v3-plot-arc-write-design.md`）。
3. `tx.chapter.update({ summary })` 写 Chapter 摘要（不进 Memory 表）。
4. `tx.chapter.update({ chapterGraph, cumulativeGraph, cumulativeGraphGeneratedAt, status: 'archived', pendingArchiveData: null })`。

CharacterBranchState 写入不在本端点（用户单独做）。`TimelineEvent` 在 v3 删除，不再写。
```

### Step 3.3: 提交文档同步

```bash
git add docs/LOGIC.md
git commit -m "docs(LOGIC): 同步 v3 archive confirm PlotArc 写库已接通"
```

---

## Task 4: typecheck + 手动验证

### Step 4.1: typecheck

```bash
pnpm typecheck
```

**Expected**: 全绿。

### Step 4.2: 跑全部测试

```bash
pnpm test
```

**Expected**: 全部 PASS (server + web)。

### Step 4.3: 手动验证 (用户操作)

启动 dev server:

```bash
pnpm dev
```

在 web 端:
1. 打开 87be28a9 ch1 `第1章 雨中来客` reviewing 页面
2. 确认累计图谱已生成 (如未生成, 先点"生成累计图谱")
3. 点 "确认归档"
4. 成功后查 DB:

```bash
pnpm --filter server exec node -e "
  const { PrismaClient } = require('@prisma/client');
  const p = new PrismaClient();
  (async () => {
    const arcs = await p.plotArc.findMany({ where: { storyId: '87be28a9-4446-4aa7-84e1-1b09629cb1f1' } });
    console.log('PlotArc rows:', arcs.length);
    for (const a of arcs) console.log('  '+a.name+' ['+a.type+'|'+a.status+'|prog='+a.progress+'%] lastTouchedCh='+a.lastTouchedChapter);
    await p.\$disconnect();
  })();
"
```

**Expected**: 1 行 `不速之客 main active prog=10% lastTouchedCh=1`。

如果失败:
- `pending.plotArcs` 为空 → 检查 `pendingArchiveData.stages.plotArc.result.plotArcs` 是否能解析
- 404 / 500 → 检查 dev server 日志

### Step 4.4: 跨章验证 (可选)

如果时间允许, 准备第 2 章归档 (process-chapter 走一遍), 验证 ch2 consolidator 收到的 `existing` 包含 ch1 那条 main arc:

```bash
pnpm --filter server exec node -e "
  const { PrismaClient } = require('@prisma/client');
  const p = new PrismaClient();
  (async () => {
    const arcs = await p.plotArc.findMany({ where: { storyId: '87be28a9-4446-4aa7-84e1-1b09629cb1f1' } });
    console.log('Cross-chapter existing:', arcs.length);
    await p.\$disconnect();
  })();
"
```

**Expected**: 1 行 (ch1 创建的)。

---

## 风险与回滚

### 风险

1. **production data shock**: 接通后, 87be28a9 ch1 archive confirm 时, 会触发 `commitPlotArcWrites` 末尾的 stale 扫描。可能把现有 arc (从 v2 残留导入的) 转 stale。
   - 缓解: 87be28a9 PlotArc 表目前 0 行, 无影响。其他故事可能有 v2 残留, 不在本 spec 范围。

2. **mock 不完全**: 测试用 `mockPrisma` 顶层 mock, `commitPlotArcWrites` 内部 `findMany` 也有调用 — 测试通过依赖 mock 的所有 prisma 调用都被覆盖。
   - 调试: 如果测试 fail, 看 `[MockPrisma]` 输出来定位哪个调用没 mock。

### 回滚

`commitPlotArcWrites` 调用是单 line 改动, 回滚 = 删这一行 + 注释回退。`plot-extractor.ts` 内部不动, 可逆。

---

## 验证清单

- [ ] `pnpm --filter server typecheck` 全绿
- [ ] `pnpm --filter server test` 全绿 (含 `archive-plot-arc-write.test.ts`)
- [ ] `pnpm test` (server + web) 全绿
- [ ] 87be28a9 ch1 archive confirm 后, PlotArc 表查 = 1 行 (`不速之客`)
- [ ] `docs/LOGIC.md` 阶段 3 描述同步更新
- [ ] 3 个 commit: test (新增) + fix (接通) + docs (LOGIC) + 可选 fix (调试补充)
