# v3 CharacterBranchState 写库接通 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 `chapters-archive.ts:archive` 端点的 `prisma.$transaction` 内调 `commitCharacterBranchStateWrites`,让 character-stage 输出真正落到 CharacterBranchState 表,修 v3 已知遗留 — `chapters-generate.ts:getCharactersWithLatestState` 永远拿 fallback `{}` 的问题。

**Architecture:** 新建 1 个 service `character-extractor.ts` 镜像 `plot-extractor.ts` 风格(单行职责:把 `CharacterStateRow[]` 落到 CharacterBranchState 表),`chapters-archive.ts` 端点加 1 import + 1 call,`isNew=true` / `characterId=null` 静默跳过 + 一行 info log(Character 是手动 CRUD 模型)。

**Tech Stack:** Fastify, Prisma, Vitest, Zod, TypeScript

---

## 文件结构

| 路径 | 改动 |
|------|------|
| `apps/server/src/services/character-extractor.ts` | **新建** — 导出 `commitCharacterBranchStateWrites` |
| `apps/server/src/__tests__/services/character-extractor.test.ts` | **新建** — 单元测试 (happy / all-isNew / mixed) |
| `apps/server/src/__tests__/routes/archive-character-branch-state-write.test.ts` | **新建** — 集成测试 (happy / isNew skip / rollback) |
| `apps/server/src/routes/chapters-archive.ts` | + 1 import, + 1 call, 注释 1 处改写 |
| `docs/LOGIC.md` | 阶段 3 表格 + 编号列表同步 |

**不改动**:
- `apps/server/src/services/stages/character-stage.ts` — 输出格式不动
- `apps/server/src/services/stages/plot-arc-stage.ts` / `graph-extract-stage.ts` — 它们声明 `latestBranchStates` 但不读,死代码是 follow-up(见 spec §0.4),本 plan 不修
- `prisma/schema.prisma` — `CharacterBranchState.fromChapterNumber Float?` 类型评估是 follow-up

**测试 setup 沿用 `__tests__/setup.ts`**: `createMockApp(mockPrisma)` + `callHandler(routes, ...)` + `chapterArchiveRoutes(app)` 注册路由。参考 `__tests__/routes/archive-plot-arc-write.test.ts` 已有写法。

---

## Task 1: 写失败单元测试 — `commitCharacterBranchStateWrites`

**Files:**
- Create: `apps/server/src/__tests__/services/character-extractor.test.ts`

**目标**: 1 个新测试文件,含 3 个 it (happy path / all-isNew / mixed)。先 commit 失败测试,验证它真的失败(因为 `commitCharacterBranchStateWrites` 还没实现)。

### Step 1.1: 写测试文件

完整代码:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { commitCharacterBranchStateWrites } from '../../services/character-extractor.js'
import type { CharacterStateRow } from '../../services/stages/character-stage.js'

describe('commitCharacterBranchStateWrites', () => {
  let tx: any
  let log: { info: ReturnType<typeof vi.fn> }

  beforeEach(() => {
    log = { info: vi.fn() }
    tx = {
      characterBranchState: { create: vi.fn().mockResolvedValue({ id: 'cbs-1' }) }
    }
  })

  it('happy path: 只对 isNew=false + characterId 有效的条目 create', async () => {
    const writes: CharacterStateRow[] = [
      { characterId: 'char-1', name: '姜禾', key: 'jiang_he', status: '{"rank":"练气"}', relationships: '{}', isNew: false },
      { characterId: null, name: '神秘女子', key: 'unknown', status: '{}', relationships: '{}', isNew: true },
      { characterId: '', name: '路人甲', key: 'passerby', status: '{}', relationships: '{}', isNew: true }
    ]

    await commitCharacterBranchStateWrites(tx, 1, writes, log)

    expect(tx.characterBranchState.create).toHaveBeenCalledTimes(1)
    expect(tx.characterBranchState.create).toHaveBeenCalledWith({
      data: {
        characterId: 'char-1',
        fromChapterNumber: 1,
        status: '{"rank":"练气"}',
        relationships: '{}'
      }
    })
    // isNew 的两条都跳过 + log
    expect(log.info).toHaveBeenCalledTimes(2)
  })

  it('all isNew: create 不被调', async () => {
    const writes: CharacterStateRow[] = [
      { characterId: null, name: 'X', key: 'x', status: '{}', relationships: '{}', isNew: true },
      { characterId: null, name: 'Y', key: 'y', status: '{}', relationships: '{}', isNew: true }
    ]

    await commitCharacterBranchStateWrites(tx, 5, writes, log)

    expect(tx.characterBranchState.create).not.toHaveBeenCalled()
    expect(log.info).toHaveBeenCalledTimes(2)
  })

  it('mixed: 1 matched + 1 isNew → create 1 次', async () => {
    const writes: CharacterStateRow[] = [
      { characterId: 'char-2', name: '许青', key: 'xu_qing', status: '{"rank":"筑基"}', relationships: '{"姜禾":"朋友"}', isNew: false },
      { characterId: null, name: 'Z', key: 'z', status: '{}', relationships: '{}', isNew: true }
    ]

    await commitCharacterBranchStateWrites(tx, 2, writes, log)

    expect(tx.characterBranchState.create).toHaveBeenCalledTimes(1)
    expect(tx.characterBranchState.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        characterId: 'char-2',
        fromChapterNumber: 2
      })
    })
  })
})
```

### Step 1.2: 跑测试 — 验证失败

```bash
pnpm --filter server test character-extractor
```

**Expected**: 3 个 it 全部 FAIL,错误类似 `Cannot find module '../../services/character-extractor.js'` 或 `commitCharacterBranchStateWrites is not a function` — 因为 `character-extractor.ts` 还没建。

### Step 1.3: 提交失败测试

```bash
git add apps/server/src/__tests__/services/character-extractor.test.ts
git commit -m "test(server): 新增 character-extractor 单元测试 (验证函数未实现前 FAIL)"
```

---

## Task 2: 实现 `commitCharacterBranchStateWrites`

**Files:**
- Create: `apps/server/src/services/character-extractor.ts`

### Step 2.1: 创建文件

**`apps/server/src/services/character-extractor.ts`** 完整内容:

```ts
import type { CharacterStateRow } from './stages/character-stage.js'

/**
 * 在事务中提交角色分支状态写入 (P0 fix: 修 v3 archive 不写 CharacterBranchState 表)
 *
 * 数据来源: character-stage 输出 characterStates[], AI 给出本章结束时
 * 每个 matched character 的 status / relationships JSON 字符串。
 *
 * 这里只负责把 writes 落到 CharacterBranchState 表:
 * - isNew=false + characterId 有效 → create 新 branchState 行, fromChapterNumber=本章号
 * - isNew=true 或 characterId=null/空 → 跳过 (Character 是手动 CRUD 模型,
 *   AI 抽到新角色没有 Character 行可挂 branchState, 静默跳过 + 一行 log 让用户可见)
 *
 * 失败行为: 任一 create 抛错 → 异常向上冒泡, $transaction rollback,
 * 章节保持 reviewing, 用户可重试。
 */
export async function commitCharacterBranchStateWrites(
  tx: any,
  chapterNumber: number,
  writes: CharacterStateRow[],
  log?: { info: (msg: string) => void }
): Promise<void> {
  const safeLog = log ?? { info: (msg: string) => console.log(msg) }
  for (const w of writes) {
    if (w.isNew || !w.characterId) {
      // Character 表里没有这个角色 (isNew=true 或 characterId=null/空),
      // 没法挂 branchState。静默跳过 + 一行 info log。
      // 不抛错: 用户可能在 reviewing 阶段手动删过 Character, 不该阻塞归档。
      safeLog.info(
        `[CharacterBranchState] skip isNew character: ${w.name} (no Character row to attach)`
      )
      continue
    }
    await tx.characterBranchState.create({
      data: {
        characterId: w.characterId,
        fromChapterNumber: chapterNumber,
        status: w.status,
        relationships: w.relationships
      }
    })
  }
}
```

### Step 2.2: 跑单元测试 — 验证通过

```bash
pnpm --filter server test character-extractor
```

**Expected**: 3 个 it 全部 PASS。

如果 fail:
- TS 编译错 `Cannot find module './stages/character-stage.js'` → 检查 import 路径(相对 `character-extractor.ts` 在 `services/` 目录下,`./stages/character-stage.js` 应解析到 `services/stages/character-stage.ts`)
- `tx.characterBranchState.create` 调用次数不对 → 检查 `isNew` / `characterId` 守卫分支

### Step 2.3: 跑全部 server 测试防止回归

```bash
pnpm --filter server test
```

**Expected**: 全部测试 PASS(原 13 个 `plot-extractor` + 3 个新增 `character-extractor` + 其他既有测试)。

### Step 2.4: 提交实现

```bash
git add apps/server/src/services/character-extractor.ts
git commit -m "feat(server): 新增 commitCharacterBranchStateWrites (P0 修 v3 archive 不写表)"
```

---

## Task 3: 写失败集成测试 — `archive-character-branch-state-write`

**Files:**
- Create: `apps/server/src/__tests__/routes/archive-character-branch-state-write.test.ts`

**目标**: 1 个新测试文件,含 3 个 it (happy path / isNew skip / rollback)。先 commit 失败测试,验证它真的失败(因为 archive 端点还没接通 `commitCharacterBranchStateWrites`)。

### Step 3.1: 写测试文件

完整代码:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createMockApp, callHandler } from '../setup.js'

const ts = '2026-07-25T00:00:00.000Z'

const matchedState = {
  characterId: 'char-1',
  name: '姜禾',
  key: 'jiang_he',
  status: '{"rank":"练气","location":"楼道"}',
  relationships: '{"许青":"朋友"}',
  isNew: false
}

const newCharacterState = {
  characterId: null,
  name: '神秘女子',
  key: 'unknown_woman',
  status: '{"rank":"未知"}',
  relationships: '{}',
  isNew: true
}

const basePending = {
  version: 3,
  stages: {
    character: {
      status: 'success',
      result: { characterStates: [matchedState, newCharacterState] }
    },
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
    plotArc: { status: 'success', result: { plotArcs: [] } },
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
  isSideStory: false,
  content: 'a'.repeat(200),
  outline: 'short',
  pendingArchiveData: JSON.stringify(basePending),
  chapterGraph: null,
  cumulativeGraph: null
}

describe('archive v3 — CharacterBranchState 写库 (P0 修复)', () => {
  let mockPrisma: any
  let routes: Record<string, any>
  let log: any

  beforeEach(async () => {
    vi.clearAllMocks()
    log = { info: vi.fn(), error: vi.fn(), warn: vi.fn() }
    mockPrisma = {
      chapter: {
        findUnique: vi.fn(),
        update: vi.fn()
      },
      character: { findMany: vi.fn().mockResolvedValue([]) },
      characterBranchState: { create: vi.fn().mockResolvedValue({ id: 'cbs-1' }) },
      plotArc: {
        findMany: vi.fn().mockResolvedValue([]),
        create: vi.fn().mockResolvedValue({ id: 'arc-1' })
      },
      memory: { create: vi.fn().mockResolvedValue({ id: 'mem-1' }) },
      $transaction: vi.fn(async (fn: any) => fn(mockPrisma))
    }
    const { chapterArchiveRoutes } = await import('../../routes/chapters-archive.js')
    const built = createMockApp(mockPrisma, log)
    await chapterArchiveRoutes(built.app)
    routes = built.routes
  })

  it('happy path: archive confirm 触发 commitCharacterBranchStateWrites → CharacterBranchState 表新增 (matched)', async () => {
    mockPrisma.chapter.findUnique.mockResolvedValue({ ...baseChapter })

    const result = await callHandler(
      routes, 'POST', '/api/chapters/:chapterId/archive',
      undefined, { chapterId: 'ch-1' }
    )

    expect(result.body).toMatchObject({ success: true })
    // 关键断言: tx.characterBranchState.create 被调 1 次 (只 matched 那条, isNew 跳过)
    expect(mockPrisma.characterBranchState.create).toHaveBeenCalledTimes(1)
    expect(mockPrisma.characterBranchState.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        characterId: 'char-1',
        fromChapterNumber: baseChapter.number,
        status: matchedState.status,
        relationships: matchedState.relationships
      })
    })
    // 章节翻 archived
    expect(mockPrisma.chapter.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'archived' })
      })
    )
    // isNew 跳过 log
    expect(log.info).toHaveBeenCalledWith(
      expect.stringContaining('神秘女子')
    )
  })

  it('isNew skip: characterStates 全是 isNew → create 不被调, 章节仍翻 archived', async () => {
    mockPrisma.chapter.findUnique.mockResolvedValue({
      ...baseChapter,
      pendingArchiveData: JSON.stringify({
        ...basePending,
        stages: {
          ...basePending.stages,
          character: {
            status: 'success',
            result: { characterStates: [newCharacterState] }
          }
        }
      })
    })

    const result = await callHandler(
      routes, 'POST', '/api/chapters/:chapterId/archive',
      undefined, { chapterId: 'ch-1' }
    )

    expect(result.body).toMatchObject({ success: true })
    expect(mockPrisma.characterBranchState.create).not.toHaveBeenCalled()
    // 章节仍翻 archived (isNew skip 不阻塞归档)
    expect(mockPrisma.chapter.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'archived' })
      })
    )
  })

  it('rollback: characterBranchState.create 抛错 → 整 transaction rollback, chapter 保持 reviewing', async () => {
    mockPrisma.chapter.findUnique.mockResolvedValue({ ...baseChapter })
    // 让 characterBranchState.create 抛错 (模拟 FK 约束 / 字段异常)
    mockPrisma.characterBranchState.create.mockRejectedValue(new Error('cbs.create failed'))

    await expect(
      callHandler(routes, 'POST', '/api/chapters/:chapterId/archive', undefined, { chapterId: 'ch-1' })
    ).rejects.toThrow(/cbs.create failed/)
    // 章节 status 没翻 archived (rollback 生效) — tx.chapter.update 在 commitCharacterBranchStateWrites 之后调用
    const updateCalls = mockPrisma.chapter.update.mock.calls
    const archivedUpdate = updateCalls.find((c: any[]) => c[0]?.data?.status === 'archived')
    expect(archivedUpdate).toBeUndefined()
  })
})
```

### Step 3.2: 跑测试 — 验证失败

```bash
pnpm --filter server test archive-character-branch-state-write
```

**Expected**:
- 第 1 个 it (`happy path`): FAIL with `expect(mockPrisma.characterBranchState.create).toHaveBeenCalledTimes(1)` — 因为 archive 端点还没调 `commitCharacterBranchStateWrites`。
- 第 2 个 it (`isNew skip`): 当前可能 PASS(因为 archive 端点本来就完全不调 create,被测项 0 满足预期 0),也会 FAIL on `log.info` 断言(因为还没接通 skip log)。
- 第 3 个 it (`rollback`): 当前会 FAIL(因为 `characterBranchState.create` 还没被调过,`mockRejectedValue` 不触发,handler 走完正常路径,`chapter.update` 翻 archived,断言失败)。

不重要具体哪个先 fail — 关键目标是验证接通前这些测试不能全部 PASS。Task 4 接通后所有 it 应 PASS。

### Step 3.3: 提交失败测试

```bash
git add apps/server/src/__tests__/routes/archive-character-branch-state-write.test.ts
git commit -m "test(server): 新增 archive-character-branch-state-write 测试 (验证接通前 FAIL)"
```

---

## Task 4: 接通 archive confirm 写库

**Files:**
- Modify: `apps/server/src/routes/chapters-archive.ts:1-13` (import), `:602-603` (extraction), `:671-678` (transaction)

### Step 4.1: 添加 import

定位 `apps/server/src/routes/chapters-archive.ts` 顶部 import 段 (line 1-13), 在 `commitPlotArcWrites` import 之后加 `commitCharacterBranchStateWrites` import:

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
import { commitCharacterBranchStateWrites } from '../services/character-extractor.js'
import { optimizeMemories, type OptimizedMemory } from '../services/memory-optimizer.js'
import type { GraphSnapshot } from '../services/graph-snapshot.js'
import { buildCumulativeGraph } from '../services/cumulative-graph.js'
```

### Step 4.2: 提取 characterStates

定位 `apps/server/src/routes/chapters-archive.ts:602-603` (在 `plotArcs` 提取后), 加 `characterStates` 提取行:

```ts
    // plot-consolidator 输出 (PendingPlotArcWrite[]) — archive confirm 时落 PlotArc 表
    const plotArcs: any[] = (pending.stages.plotArc as any)?.result?.plotArcs ?? []

    // character-stage 输出 (CharacterStateRow[]) — archive confirm 时落 CharacterBranchState 表
    const characterStates: any[] = (pending.stages.character as any)?.result?.characterStates ?? []
```

### Step 4.3: 在 $transaction 内调 commitCharacterBranchStateWrites

定位 `apps/server/src/routes/chapters-archive.ts:671-692`, 改 2 处:

**A. 改 L671 注释** (从"...+ PlotArc + ..." → "...+ PlotArc + CharacterBranchState + ...")

```ts
    // commit-only: prisma.$transaction 内一次写完三层 + PlotArc + CharacterBranchState + Chapter.summary + Chapter 三列 + 翻 status
```

**B. 改 L672 注释** (移除 "CharacterBranchState 写入另文档讨论,本端点不写" 这句)

整行删除(因为现在已接通,不再有 "另文档" 备注):

```ts
    // 备注: CharacterBranchState 已接通 (commitCharacterBranchStateWrites)
```

**C. $transaction 块内,在 `commitPlotArcWrites` 之后, `tx.chapter.update` 之前**, 插入 `commitCharacterBranchStateWrites` 调用:

```ts
    await prisma.$transaction(async (tx) => {
      for (const data of [...chapterRows, ...sceneRows, ...globalRows]) {
        await tx.memory.create({ data })
      }
      // 接通 v3 PlotArc 写库 (修 P0 遗留): consolidator 输出 → PlotArc 表
      await commitPlotArcWrites(tx, chapter.number, plotArcs)
      // 接通 v3 CharacterBranchState 写库 (修 P0 遗留): character-stage 输出 → CharacterBranchState 表
      // isNew=true / characterId=null 时 commitCharacterBranchStateWrites 内部静默跳过 + log
      await commitCharacterBranchStateWrites(tx, chapter.number, characterStates, app.log)
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

### Step 4.4: 跑测试 — 验证通过

```bash
pnpm --filter server test archive-character-branch-state-write
```

**Expected**: 3 个 it 全部 PASS。

如果 fail:
- `mockPrisma.characterBranchState.create` 没被调 → 检查 `characterStates` 是否能从 `pendingArchiveData.stages.character.result.characterStates` 解出
- `log.info` 没被调 → 检查 `app.log` 是否正确传入 `commitCharacterBranchStateWrites` 第 4 参数
- rollback 测试 fail → 检查 `commitCharacterBranchStateWrites` 内部 create 失败是否真的会冒泡(没 try/catch)

### Step 4.5: 跑全部 server 测试防止回归

```bash
pnpm --filter server test
```

**Expected**: 全部 PASS。`character-extractor` 3 个 + `archive-character-branch-state-write` 3 个 + `archive-plot-arc-write` 2 个 + `prepare-archive-v3` 全部 + 其他既有测试 — 全绿。

### Step 4.6: 提交接通

```bash
git add apps/server/src/routes/chapters-archive.ts
git commit -m "fix(server): 接通 v3 archive confirm 写 CharacterBranchState 表"
```

---

## Task 5: 同步 LOGIC.md

**Files:**
- Modify: `docs/LOGIC.md:193` (阶段 3 表格) + `:198-204` (阶段 3 当前实现)

### Step 5.1: 改 LOGIC.md L193 表格

定位 `docs/LOGIC.md:193`:

```markdown
| 3 落列 | `routes/chapters-archive.ts:archive` | `archive` | 0 次 | 校验失败返回 400，章节维持 `reviewing`；`prisma.$transaction` 内写 Memory 三层 + PlotArc (`commitPlotArcWrites`) + Chapter.summary + Chapter 三列 + 翻 status（CharacterBranchState 写入另文档） |
```

替换为:

```markdown
| 3 落列 | `routes/chapters-archive.ts:archive` | `archive` | 0 次 | 校验失败返回 400，章节维持 `reviewing`；`prisma.$transaction` 内写 Memory 三层 + PlotArc (`commitPlotArcWrites`) + CharacterBranchState (`commitCharacterBranchStateWrites`) + Chapter.summary + Chapter 三列 + 翻 status |
```

### Step 5.2: 改 LOGIC.md L198-204 编号列表

定位 `docs/LOGIC.md:198-204`:

```markdown
**阶段 3 当前实现**：`prisma.$transaction` 内依次写：
1. `tx.memory.create` 每条 mainEvent / sideEvent / emotion / foreshadowing / relationshipChange 写入 `layer='chapter'`（mainEvent 多带 `'main-plot'` tag）；每条 scene 写 `layer='scene'`；每条 optimizer 融合记忆写 `layer='global'`（tag 加 `event` / `state`）。
2. `tx.commitPlotArcWrites(chapter.number, pending.plotArcs)` 写 PlotArc 表（接 v3, 2026-07-30）：包含 consolidator 输出的 isNew / update / closed 写库、lastTouchedChapter 刷新、stale 自动检测、Jaccard 兜底（详见 `services/plot-extractor.ts` 与 `docs/superpowers/specs/2026-07-30-v3-plot-arc-write-design.md`）。
3. `tx.chapter.update({ summary })` 写 Chapter 摘要（不进 Memory 表）。
4. `tx.chapter.update({ chapterGraph, cumulativeGraph, cumulativeGraphGeneratedAt, status: 'archived', pendingArchiveData: null })`。

CharacterBranchState 写入不在本端点（用户单独做）。`TimelineEvent` 在 v3 删除，不再写。
```

替换为(在 step 2 后插入新 step 3,原 step 3 / 4 顺延):

```markdown
**阶段 3 当前实现**：`prisma.$transaction` 内依次写：
1. `tx.memory.create` 每条 mainEvent / sideEvent / emotion / foreshadowing / relationshipChange 写入 `layer='chapter'`（mainEvent 多带 `'main-plot'` tag）；每条 scene 写 `layer='scene'`；每条 optimizer 融合记忆写 `layer='global'`（tag 加 `event` / `state`）。
2. `tx.commitPlotArcWrites(chapter.number, pending.plotArcs)` 写 PlotArc 表（接 v3, 2026-07-30）：包含 consolidator 输出的 isNew / update / closed 写库、lastTouchedChapter 刷新、stale 自动检测、Jaccard 兜底（详见 `services/plot-extractor.ts` 与 `docs/superpowers/specs/2026-07-30-v3-plot-arc-write-design.md`）。
3. `tx.commitCharacterBranchStateWrites(chapter.number, pending.characterStates)` 写 CharacterBranchState 表（接 v3, 2026-07-31）：包含 character-stage 输出的 matched character 状态/关系, isNew=true / characterId=null 跳过 + log（详见 `services/character-extractor.ts` 与 `docs/superpowers/specs/2026-07-31-v3-character-branch-state-write-design.md`）。
4. `tx.chapter.update({ summary })` 写 Chapter 摘要（不进 Memory 表）。
5. `tx.chapter.update({ chapterGraph, cumulativeGraph, cumulativeGraphGeneratedAt, status: 'archived', pendingArchiveData: null })`。

`TimelineEvent` 在 v3 删除，不再写。
```

### Step 5.3: 提交文档同步

```bash
git add docs/LOGIC.md
git commit -m "docs(LOGIC): 同步 v3 archive confirm CharacterBranchState 写库已接通"
```

---

## Task 6: typecheck + 手动验证

### Step 6.1: typecheck

```bash
pnpm typecheck
```

**Expected**: 全绿。

### Step 6.2: 跑全部测试

```bash
pnpm test
```

**Expected**: 全部 PASS (server + web)。

### Step 6.3: 手动验证 (用户操作)

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
    const rows = await p.characterBranchState.findMany({
      where: { fromChapterNumber: 1 },
      include: { character: { select: { name: true } } }
    });
    console.log('CharacterBranchState rows:', rows.length);
    for (const r of rows) {
      console.log('  ' + r.character.name + ' fromCh=' + r.fromChapterNumber + ' status=' + r.status.slice(0, 50));
    }
    await p.\$disconnect();
  })();
"
```

**Expected**: 2 行 (姜禾 + 许青),`fromChapterNumber=1`,`status` / `relationships` 含 character-stage 输出的 JSON 字符串 (不再是空 `{}`)。

如果失败:
- 0 行 → 检查 dev server 日志,看 `[CharacterBranchState] skip isNew character: X` 是否出现(说明 AI 抽到的 characterId 都没匹配上 Character 表)
- 报错 → 检查 `commitCharacterBranchStateWrites` 是否有异常

### Step 6.4: 跨章验证 (可选)

如果时间允许, 准备第 2 章归档 (走 prepare-archive + confirm 全流程), 验证 ch2 generate 时 `getCharactersWithLatestState` 注入 prompt 的 `character.status` / `character.relationships` 不再是 `{}` fallback:

```bash
pnpm --filter server exec node -e "
  const { PrismaClient } = require('@prisma/client');
  const p = new PrismaClient();
  (async () => {
    const rows = await p.characterBranchState.findMany({
      where: { fromChapterNumber: { in: [1, 2] } },
      include: { character: { select: { name: true } } }
    });
    console.log('跨章 characterBranchState rows:', rows.length);
    for (const r of rows) {
      console.log('  ' + r.character.name + ' ch=' + r.fromChapterNumber);
    }
    await p.\$disconnect();
  })();
"
```

**Expected**: ch1 + ch2 各有 2 行 (姜禾 + 许青 的最新状态)。

---

## 风险与回滚

### 风险

1. **FK 约束边界 case**(spec §1.6):用户在 prepare-archive 后、confirm 前删除某 Character → archive 失败 → 章节保持 reviewing → 用户必须重跑 character-stage 或编辑 pendingArchiveData。**预期行为,不修**。

2. **`status` / `relationships` 字符串形状**:character-stage prompt 强制要求 JSON object 字符串,但实际 AI 可能输出不合法 JSON。**当前不验证** — 若 create 抛错,事务回滚,章节保持 reviewing,用户可在 ReviewingPanel 编辑。这是「user-editable」原则的体现。

3. **死代码 `latestBranchStates` 链路**(spec §0.4):本 plan 接通后,即使 CharacterBranchState 有数据,plot-arc-stage / graph-extract-stage 也不会读。**这是预期** — 它们的下游消费没接通。后续单独任务清理。

### 回滚

`commitCharacterBranchStateWrites` 调用是单 line 改动, 回滚 = 删这一行 + 注释回退。`character-extractor.ts` 内部不动, 完全可逆。

---

## 验证清单

- [ ] `pnpm typecheck` 全绿
- [ ] `pnpm --filter server test character-extractor` 全绿 (3 个新单元测试)
- [ ] `pnpm --filter server test archive-character-branch-state-write` 全绿 (3 个新集成测试)
- [ ] `pnpm --filter server test` 全绿,无回归
- [ ] `pnpm test` (server + web) 全绿
- [ ] 87be28a9 ch1 archive confirm 后, `CharacterBranchState` 表查 ≥ 2 行(姜禾 + 许青), `fromChapterNumber=1`, `status` / `relationships` 非空
- [ ] `docs/LOGIC.md` 阶段 3 描述同步更新
- [ ] 5 个 commit: 1 spec(已完成 f968ac2) + 2 test (unit + integration) + 1 fix (接通) + 1 docs (LOGIC)
