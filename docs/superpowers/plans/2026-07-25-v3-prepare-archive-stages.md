# v3 Prepare-Archive Stages 解耦 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 prepare-archive 拆成 4 个并行 stage（character / memory / plot-arc / graph-extract），各自独立 status + 错误展示；图谱生成拆成本章图谱（gacha）+ 全局图谱（AI 去重）两阶段；删除 archive 流程所有 `updateMany` 锁；新增 prepare-archive/cancel 端点回退到 draft 而不删章节。

**Architecture:** 在 `apps/server/src/services/stages/` 下新建 4 个 stage 服务 + 1 个 `cumulative-graph.ts`。`chapters-archive.ts` 拆为 prepare / cancel / archive 三段 handler（删除所有锁，仅依赖状态机自身 + UI 按钮 disabled）。`pendingArchiveData` 升级到 v3 shape (`{version: 3, stages: {character, memory, plotArc, graph}, meta}`)。前端 `ReviewingPanel.vue` 重切为 4 StageCard + 3 footer 按钮。

**Tech Stack:** 不引入新库。沿用 Fastify + Prisma + Vue 3 + Naive UI + Vitest。

**基线分支:** `v3/prepare-archive-stages`（基于 `v2/state-machine` 切出）

---

## 文件结构总览

```
prisma/
├── schema.prisma                                              # 重命名 graphDelta/graphSnapshot
└── migrations/
    └── 20260725000000_rename_graph_fields/                    # 新迁移
        └── migration.sql

packages/shared/src/
├── archive.ts                                                  # 新增 PendingArchiveDataV3 类型 + Schema
└── chapter.ts                                                  # graphDelta/graphSnapshot → chapterGraph/cumulativeGraph

apps/server/src/services/
├── stages/                                                     # 新目录
│   ├── types.ts                                                # StageState<T> 公共类型
│   ├── character-stage.ts
│   ├── memory-stage.ts
│   ├── plot-arc-stage.ts
│   └── graph-extract-stage.ts
├── cumulative-graph.ts                                         # 新服务
├── combined-extractor.ts                                       # 保留旧符号导出（兼容测试）
├── graph-organizer.ts                                          # 保留旧导出（兼容测试）
├── memory-extractor.ts                                         # 不变
├── graph-extractor.ts                                          # 不变
└── plot-consolidator.ts                                        # 不变

apps/server/src/routes/
└── chapters-archive.ts                                         # 拆 3 个端点，删锁

apps/server/src/__tests__/
├── services/
│   ├── stages-character.test.ts                                # 新
│   ├── stages-memory.test.ts                                   # 新
│   ├── stages-plot-arc.test.ts                                 # 新
│   ├── stages-graph-extract.test.ts                            # 新
│   └── cumulative-graph.test.ts                                # 新
└── routes/
    ├── prepare-archive-v3.test.ts                              # 新（v3 行为测试）
    ├── prepare-archive-cancel.test.ts                          # 新
    └── prepare-archive.test.ts                                 # 调整（删锁后断言变化）

apps/web/src/
├── api/chapters.ts                                             # 新增 prepareArchiveCancel
├── composables/useChapterEditor.ts                             # 新增 prepareArchiveCancel; graphDelta → chapterGraph
└── views/
    ├── ReviewingPanel.vue                                      # 重切分为 4 StageCard
    ├── chapters/ChapterEditor.vue                              # graphDelta → chapterGraph
    └── Graph.vue                                               # 不变（仍读 GraphNode/GraphEdge 工作表）

docs/
├── DESIGN.md                                                   # 更新 archive 章节
├── LOGIC.md                                                    # 更新 stage 边界
├── ISSUES.md                                                   # 标记 GraphView 重写为 follow-up
└── CLAUDE.md                                                   # 不动（已说 GraphView 延后）
```

---

## Commit 1: `chore(v3): rename graphDelta/graphSnapshot to chapterGraph/cumulativeGraph`

> 重命名字段。Prisma 列 rename 保留数据。GraphView.vue 不动（仍读 GraphNode/GraphEdge 工作表到下个 commit 重写）。

### Task 1.1: Prisma schema + migration

**Files:**
- Modify: `prisma/schema.prisma:108-112`
- Modify: `prisma/schema.prisma:230-260` (GraphNode / GraphEdge model)
- Create: `prisma/migrations/20260725000000_rename_graph_fields/migration.sql`

- [ ] **Step 1: 改 Chapter 字段**

打开 `prisma/schema.prisma`,找到 Chapter model 内 `graphDelta` 和 `graphSnapshot` 两行,替换为:

```prisma
  // 图谱相关
  chapterGraph     String?  // JSON: 本章图谱（gacha 抽取，与累计全局图谱分离）
  cumulativeGraph  String?  // JSON: 累计到本章的全局图谱（经 N-1 去重）
```

- [ ] **Step 2: 给 GraphNode / GraphEdge model 加 @deprecated 注释**

打开 `prisma/schema.prisma`,找到 `model GraphNode` 和 `model GraphEdge`,在每个 model 的第一行加 `@deprecated` 注释:

```prisma
/// @deprecated v3 不再写入新数据;数据落 Chapter.chapterGraph/cumulativeGraph。
/// 保留仅供 GraphView.vue 旧实现暂用。重写完成后删除本 model。
/// 见 docs/ISSUES.md [P2 follow-up]。
model GraphNode {
  ...
}

/// @deprecated 同 GraphNode。
model GraphEdge {
  ...
}
```

- [ ] **Step 3: 写 migration SQL**

在 `prisma/migrations/20260725000000_rename_graph_fields/migration.sql` 写:

```sql
-- AlterTable
ALTER TABLE "Chapter" RENAME COLUMN "graphDelta" TO "chapterGraph";
ALTER TABLE "Chapter" RENAME COLUMN "graphSnapshot" TO "cumulativeGraph";
```

- [ ] **Step 4: 应用 migration**

Run:
```bash
pnpm db:migrate
```
Expected: 提示创建新 migration 或检测到 SQL 文件已存在;数据库成功 rename。

- [ ] **Step 5: 重新生成 Prisma client**

Run:
```bash
pnpm db:generate
```
Expected: `node_modules/.prisma/client` 重新生成,无错。

- [ ] **Step 6: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/20260725000000_rename_graph_fields/
git commit -m "chore(v3): rename Chapter.graphDelta/graphSnapshot to chapterGraph/cumulativeGraph + deprecate GraphNode/Edge"
```

---

### Task 1.2: 后端重命名代码引用

**Files:**
- Modify: `apps/server/src/services/graph-snapshot.ts:82-84`
- Modify: `apps/server/src/routes/chapters-archive.ts:201-209` (事务内 chapter.update 引用)
- Modify: 任何其他后端引用(用 grep 确认)

- [ ] **Step 1: 找全部后端引用**

Run:
```bash
grep -rn "graphDelta\|graphSnapshot" apps/server/src packages/shared/src packages/shared/dist 2>&1
```
Expected: 列出所有引用点。本任务修改这些。

- [ ] **Step 2: 改 `apps/server/src/services/graph-snapshot.ts`**

打开 `apps/server/src/services/graph-snapshot.ts:79-85`,把:

```typescript
    await prisma.chapter.update({
      where: { id: chapterId },
      data: {
        graphSnapshot: JSON.stringify(graphResult.mergedGraph),
        graphDelta: JSON.stringify(graphResult.chapterGraph)
      }
    })
```

改为:

```typescript
    await prisma.chapter.update({
      where: { id: chapterId },
      data: {
        cumulativeGraph: JSON.stringify(graphResult.mergedGraph),
        chapterGraph: JSON.stringify(graphResult.chapterGraph)
      }
    })
```

- [ ] **Step 3: 改 `apps/server/src/routes/chapters-archive.ts`**

打开 `apps/server/src/routes/chapters-archive.ts`,全文搜索 `graphDelta\|graphSnapshot`,把每个引用改成 `chapterGraph\|cumulativeGraph`。

注意:`chapters-archive.ts:201` 处的 `saveGraphSnapshotAndDelta` 调用,该函数接受的是参数(mergedGraph / chapterGraph 对象),不是字段名,无需改。仅在直接操作 Chapter 字段时改。

- [ ] **Step 4: 改 `packages/shared/src/chapter.ts`**

打开 `packages/shared/src/chapter.ts`,找到 `ChapterResponseSchema`,把:

```typescript
  graphSnapshot: z.string().nullable().optional(),
  graphDelta: z.string().nullable().optional(),
```

改为:

```typescript
  cumulativeGraph: z.string().nullable().optional(),
  chapterGraph: z.string().nullable().optional(),
```

- [ ] **Step 5: 类型检查**

Run:
```bash
pnpm typecheck
```
Expected: 无错。

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/services/graph-snapshot.ts apps/server/src/routes/chapters-archive.ts packages/shared/src/chapter.ts
git commit -m "chore(v3): rename backend references for graph fields"
```

---

### Task 1.3: 前端重命名代码引用

**Files:**
- Modify: `apps/web/src/composables/useChapterEditor.ts:20-67`
- Modify: `apps/web/src/views/chapters/ChapterEditor.vue:307-405`

- [ ] **Step 1: 找前端引用**

Run:
```bash
grep -rn "graphDelta\|graphSnapshot" apps/web/src 2>&1
```
Expected: 主要在 `useChapterEditor.ts` 和 `ChapterEditor.vue`。

- [ ] **Step 2: 改 `apps/web/src/composables/useChapterEditor.ts`**

打开该文件,改以下三处:
- 行 20:`const graphDelta = ref<any>(null)` → `const chapterGraph = ref<any>(null)`
- 行 65:`graphDelta.value = null` → `chapterGraph.value = null`
- 行 66-67:`if (row.status === 'archived' && row.graphDelta) { try { graphDelta.value = JSON.parse(row.graphDelta) ...` → `if (row.status === 'archived' && row.chapterGraph) { try { chapterGraph.value = JSON.parse(row.chapterGraph) ...`
- 行 86:`graphDelta.value = null` → `chapterGraph.value = null`
- 行 221 (return 块):`graphDelta,` → `chapterGraph,`

- [ ] **Step 3: 改 `apps/web/src/views/chapters/ChapterEditor.vue`**

打开该文件,全文搜索 `graphDelta`,把所有 `graphDelta` 替换为 `chapterGraph`(变量名 + 解构字段)。同时检查模板里引用是否需要更新。

- [ ] **Step 4: 类型检查 + 构建**

Run:
```bash
pnpm --filter web typecheck
```
Expected: 无错。

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/composables/useChapterEditor.ts apps/web/src/views/chapters/ChapterEditor.vue
git commit -m "chore(v3): rename frontend references for graph fields"
```

---

### Task 1.4: 验证 + 测试基线

- [ ] **Step 1: 跑测试**

Run:
```bash
pnpm test --run
```
Expected: 所有现有测试通过(字段重命名不应破坏逻辑)。如有失败,检查 schema.ts 类型 + 后端字段引用。

- [ ] **Step 2: 跑 typecheck**

Run:
```bash
pnpm typecheck
```
Expected: 无错。

- [ ] **Step 3: 手动 smoke**

Run `pnpm dev`,打开浏览器,进入一个已 archived 的章节,确认图谱变化区域仍能正确显示节点和边。

- [ ] **Step 4: 推 commit 验证**

Run:
```bash
git log --oneline -5
```
Expected: 显示 3 个新 commit(1.1 schema + migration, 1.2 backend, 1.3 frontend)。

---

## Commit 2: `feat(v3): add 4 stage services with shared types`

> 新建 `apps/server/src/services/stages/` 目录,加 4 个 stage 服务 + 共享 types。每个 stage 服务签名一致:接收 inputs → 调 AI → 返回 `StageState<T>`。内部 retry 1 次(温度 0.3 → 0.1)。

### Task 2.1: StageState 公共类型

**Files:**
- Create: `apps/server/src/services/stages/types.ts`

- [ ] **Step 1: 写类型文件**

创建 `apps/server/src/services/stages/types.ts`:

```typescript
import type { FastifyInstance } from 'fastify'

/**
 * 单个 stage 的执行状态。所有 stage 服务都用同一形状返回,
 * 路由层统一写入 pendingArchiveData.stages[name]。
 */
export interface StageState<T = unknown> {
  status: 'pending' | 'running' | 'success' | 'failed'
  result?: T
  errorMessage?: string
  completedAt?: string  // ISO timestamp
}

export type StageName = 'character' | 'memory' | 'plotArc' | 'graph'

/**
 * 每个 stage 服务共用的元数据:story/chapter + 内容。
 * 路由层构造一次,各 stage 自行消费。
 */
export interface StageContext {
  storyId: string
  chapterId: string
  content: string
  outline: string
  chapterNumber: number
}

/**
 * AI 调用 + 重试的共用工具。stage 内部用,
 * 把 callAIWithLog 一次 + 失败后 temperature=0.1 重试一次封装好。
 * 重试仍失败时抛错,stage 兜底成 StageState.failed。
 */
export async function callAIWithStageRetry(
  app: FastifyInstance,
  opts: {
    storyId: string
    chapterId: string
    callType: string
    compiled: any
    maxTokens?: number
  }
): Promise<string> {
  const { callAIWithLog } = await import('../ai-call-logger.js')
  const first = await callAIWithLog(app, {
    ...opts,
    temperature: 0.3
  })
  if (!first) throw new Error('AI 返回为空')

  try {
    const { cleanJsonBlock } = await import('@novel-runtime/shared')
    JSON.parse(cleanJsonBlock(first))
    return first
  } catch (firstErr: any) {
    // 第一次 parse 失败,重试
    const retry = await callAIWithLog(app, {
      ...opts,
      callType: opts.callType + '_retry',
      temperature: 0.1
    })
    if (!retry) {
      throw new Error(
        `AI 返回格式错误（第一次: ${firstErr.message.slice(0, 200)}），重试返回为空`
      )
    }
    try {
      const { cleanJsonBlock } = await import('@novel-runtime/shared')
      JSON.parse(cleanJsonBlock(retry))
      return retry
    } catch (retryErr: any) {
      throw new Error(
        `AI 返回格式错误，已重试一次仍失败。` +
        `第一次错误: ${firstErr.message.slice(0, 200)}；` +
        `重试错误: ${retryErr.message.slice(0, 200)}`
      )
    }
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/server/src/services/stages/types.ts
git commit -m "feat(v3): add stages/types.ts with StageState + retry helper"
```

---

### Task 2.2: character-stage

**Files:**
- Create: `apps/server/src/services/stages/character-stage.ts`
- Create: `apps/server/src/__tests__/services/stages-character.test.ts`

- [ ] **Step 1: 写失败测试**

创建 `apps/server/src/__tests__/services/stages-character.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest'
import { runCharacterStage } from '../../services/stages/character-stage.js'

vi.mock('../../services/ai-call-logger.js', () => ({
  callAIWithLog: vi.fn()
}))

import { callAIWithLog } from '../../services/ai-call-logger.js'

const mockApp: any = { prisma: {}, log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }

describe('character-stage', () => {
  it('returns success with parsed result on valid AI response', async () => {
    const result = {
      characterStates: [
        { characterId: 'c1', name: '张三', key: 'zhangsan', status: '{}', relationships: '{}', isNew: false }
      ]
    }
    ;(callAIWithLog as any).mockResolvedValueOnce(JSON.stringify(result))

    const state = await runCharacterStage(mockApp, {
      storyId: 's1',
      chapterId: 'c1',
      content: '张三...',
      outline: 'outline',
      chapterNumber: 1,
      matchedCharacters: [{ id: 'c1', name: '张三', key: 'zhangsan', label: '张三', importance: 8 }]
    })

    expect(state.status).toBe('success')
    expect(state.result?.characterStates).toHaveLength(1)
    expect(state.errorMessage).toBeUndefined()
  })

  it('returns success with empty result when AI returns empty object', async () => {
    ;(callAIWithLog as any).mockResolvedValueOnce('{}')

    const state = await runCharacterStage(mockApp, {
      storyId: 's1', chapterId: 'c1', content: 'x', outline: '', chapterNumber: 1,
      matchedCharacters: []
    })

    expect(state.status).toBe('success')
    expect(state.result?.characterStates ?? []).toEqual([])
  })

  it('returns failed status when AI parse fails twice', async () => {
    ;(callAIWithLog as any).mockResolvedValueOnce('not-json')
    ;(callAIWithLog as any).mockResolvedValueOnce('still-not-json')

    const state = await runCharacterStage(mockApp, {
      storyId: 's1', chapterId: 'c1', content: 'x', outline: '', chapterNumber: 1,
      matchedCharacters: []
    })

    expect(state.status).toBe('failed')
    expect(state.errorMessage).toContain('重试')
  })

  it('retries once and returns success on second valid response', async () => {
    ;(callAIWithLog as any).mockResolvedValueOnce('not-json')
    ;(callAIWithLog as any).mockResolvedValueOnce(JSON.stringify({ characterStates: [] }))

    const state = await runCharacterStage(mockApp, {
      storyId: 's1', chapterId: 'c1', content: 'x', outline: '', chapterNumber: 1,
      matchedCharacters: []
    })

    expect(state.status).toBe('success')
    expect(callAIWithLog).toHaveBeenCalledTimes(2)
  })

  it('returns failed when AI returns null', async () => {
    ;(callAIWithLog as any).mockResolvedValueOnce(null)

    const state = await runCharacterStage(mockApp, {
      storyId: 's1', chapterId: 'c1', content: 'x', outline: '', chapterNumber: 1,
      matchedCharacters: []
    })

    expect(state.status).toBe('failed')
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run:
```bash
pnpm test --run apps/server/src/__tests__/services/stages-character.test.ts
```
Expected: FAIL with "Cannot find module '../../services/stages/character-stage.js'"。

- [ ] **Step 3: 实现 character-stage**

创建 `apps/server/src/services/stages/character-stage.ts`:

```typescript
import type { FastifyInstance } from 'fastify'
import { RuntimePromptCompiler } from '@novel-runtime/ai-provider'
import { cleanJsonBlock, safeJsonParse } from '@novel-runtime/shared'
import { loadRuntimeBase, loadWorkerTask } from '../runtime-loader.js'
import { callAIWithStageRetry, type StageContext, type StageState } from './types.js'

export interface MatchedCharacter {
  id: string
  name: string
  key: string
  label: string
  importance: number
}

export interface CharacterStageInput extends StageContext {
  matchedCharacters: MatchedCharacter[]
}

export interface CharacterStateRow {
  characterId: string | null  // 命中老 Character → id; 新角色 → null
  name: string
  key: string
  status: string  // JSON
  relationships: string  // JSON
  isNew: boolean
}

export interface CharacterStageResult {
  characterStates: CharacterStateRow[]
}

export async function runCharacterStage(
  app: FastifyInstance,
  input: CharacterStageInput
): Promise<StageState<CharacterStageResult>> {
  const completedAt = new Date().toISOString()
  const matched = input.matchedCharacters
  const matchedList = matched.map(c => `- id=${c.id} name=${c.name} key=${c.key} label=${c.label}`).join('\n')

  const prompt = `你是小说角色状态助手。

【任务】基于章节内容,生成"角色状态快照":每个角色一条记录,描述本章结束时的状态 + 与其他角色的关系。

【已有角色(从正文预匹配)】必须从以下角色中选取,新角色只允许当本章出现但未在列表中时:
${matchedList || '(空)'}

【输出 JSON】
{
  "characterStates": [
    {
      "characterId": "<已有角色 id; 新角色 → null>",
      "name": "<角色名>",
      "key": "<graph key, 已有角色复用已有 key, 新角色用拼音小写下划线>",
      "status": "<JSON 对象: rank/location/realm 等本章结束时的状态>",
      "relationships": "<JSON 对象: {\"其他角色名\": \"关系\"}>",
      "isNew": <true / false>
    }
  ]
}

【章节大纲】${input.outline}
【章节内容】${input.content}`

  try {
    const prisma = app.prisma
    const base = await loadRuntimeBase(input.storyId, prisma)
    const task = await loadWorkerTask(input.storyId, 'memory', prisma)
    const compiler = new RuntimePromptCompiler()
    const compiled = compiler.compile(base, task, prompt)

    const raw = await callAIWithStageRetry(app, {
      storyId: input.storyId,
      chapterId: input.chapterId,
      callType: 'character_stage',
      compiled
    })

    const parsed = JSON.parse(cleanJsonBlock(raw))
    const result: CharacterStageResult = {
      characterStates: Array.isArray(parsed.characterStates) ? parsed.characterStates : []
    }

    return { status: 'success', result, completedAt }
  } catch (err: any) {
    app.log.error(`[CharacterStage] ${err.message}`)
    return { status: 'failed', errorMessage: err.message, completedAt }
  }
}
```

- [ ] **Step 4: 跑测试确认通过**

Run:
```bash
pnpm test --run apps/server/src/__tests__/services/stages-character.test.ts
```
Expected: 5 个 test 全部 PASS。

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/services/stages/character-stage.ts apps/server/src/__tests__/services/stages-character.test.ts
git commit -m "feat(v3): add character-stage service"
```

---

### Task 2.3: memory-stage

**Files:**
- Create: `apps/server/src/services/stages/memory-stage.ts`
- Create: `apps/server/src/__tests__/services/stages-memory.test.ts`

- [ ] **Step 1: 写失败测试**

创建 `apps/server/src/__tests__/services/stages-memory.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest'
import { runMemoryStage } from '../../services/stages/memory-stage.js'

vi.mock('../../services/ai-call-logger.js', () => ({
  callAIWithLog: vi.fn()
}))

import { callAIWithLog } from '../../services/ai-call-logger.js'

const mockApp: any = { prisma: {}, log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }

describe('memory-stage', () => {
  it('returns success with parsed memory result', async () => {
    const ai = {
      mainEvents: [{ description: 'd', participants: ['p'], importance: 7 }],
      sideEvents: [],
      emotions: ['紧张'],
      foreshadowing: ['伏笔1'],
      relationshipChanges: ['关系变化1'],
      scenes: [{ location: 'l', event: 'e', importance: 6 }],
      timelinePosition: 1.00106,
      summary: '本章摘要',
      timelineEvents: []
    }
    ;(callAIWithLog as any).mockResolvedValueOnce(JSON.stringify(ai))

    const state = await runMemoryStage(mockApp, {
      storyId: 's1', chapterId: 'c1', content: 'x', outline: '', chapterNumber: 1,
      characterNames: ['张三'],
      characterKeys: ['zhangsan']
    })

    expect(state.status).toBe('success')
    expect(state.result?.mainEvents).toHaveLength(1)
    expect(state.result?.scenes).toHaveLength(1)
    expect(state.result?.timelinePosition).toBe(1.00106)
  })

  it('returns success with empty result', async () => {
    ;(callAIWithLog as any).mockResolvedValueOnce('{}')

    const state = await runMemoryStage(mockApp, {
      storyId: 's1', chapterId: 'c1', content: 'x', outline: '', chapterNumber: 1,
      characterNames: [], characterKeys: []
    })

    expect(state.status).toBe('success')
    expect(state.result?.mainEvents ?? []).toEqual([])
  })

  it('returns failed on persistent parse error', async () => {
    ;(callAIWithLog as any).mockResolvedValueOnce('bad')
    ;(callAIWithLog as any).mockResolvedValueOnce('bad2')

    const state = await runMemoryStage(mockApp, {
      storyId: 's1', chapterId: 'c1', content: 'x', outline: '', chapterNumber: 1,
      characterNames: [], characterKeys: []
    })

    expect(state.status).toBe('failed')
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run:
```bash
pnpm test --run apps/server/src/__tests__/services/stages-memory.test.ts
```
Expected: FAIL with module not found。

- [ ] **Step 3: 实现 memory-stage**

创建 `apps/server/src/services/stages/memory-stage.ts`:

```typescript
import type { FastifyInstance } from 'fastify'
import { RuntimePromptCompiler } from '@novel-runtime/ai-provider'
import { cleanJsonBlock } from '@novel-runtime/shared'
import { loadRuntimeBase, loadWorkerTask } from '../runtime-loader.js'
import { callAIWithStageRetry, type StageContext, type StageState } from './types.js'

/**
 * memory-stage 输出形状对齐 MemoryExtractionResult,但**移除**
 * characterStatusChanges(归属 character-stage)。
 */
export interface MemoryStageInput extends StageContext {
  characterNames: string[]
  characterKeys: string[]
}

export interface MemoryStageResult {
  mainEvents: Array<{ description: string; participants: string[]; importance: number }>
  sideEvents: Array<{ description: string; participants: string[]; importance: number }>
  emotions: string[]
  foreshadowing: string[]
  relationshipChanges: string[]
  scenes: Array<{ location: string; event: string; importance: number }>
  timelinePosition: number | null
  summary: string
  timelineEvents?: Array<{ position: number | null; description: string }>
}

export async function runMemoryStage(
  app: FastifyInstance,
  input: MemoryStageInput
): Promise<StageState<MemoryStageResult>> {
  const completedAt = new Date().toISOString()
  const charList = input.characterNames.length ? input.characterNames.join('、') : '无明确角色'
  const charKeyList = input.characterKeys.length ? input.characterKeys.join(', ') : '(空)'

  const prompt = `请分析以下小说章节,提取关键信息并以严格 JSON 格式返回。不要返回 markdown 代码块,只返回纯 JSON。

本故事角色: ${charList}
graph key 列表(已存在,可复用): ${charKeyList}

提取字段:
- mainEvents: 主要事件(对象数组, description / participants / importance 5-8)
- sideEvents: 次要事件(对象数组, 同上)
- emotions: 主要角色的情绪变化(字符串数组)
- foreshadowing: 新埋下的伏笔(字符串数组)
- relationshipChanges: 角色关系变化(字符串数组)
- timelinePosition: 本章开篇时间锚点(Y.DDDHH 编码, 不能确定则 null)
- summary: 本章一句话摘要(50字以内)
- scenes: 场景记忆数组({location, event, importance 1-10})
- timelineEvents: 章内不同时间点的事件(可选, [{position, description}])

注意: 不要返回 characterStatusChanges(归属 character-stage)。

章节内容:
${input.content.slice(0, 8000)}`

  try {
    const prisma = app.prisma
    const base = await loadRuntimeBase(input.storyId, prisma)
    const task = await loadWorkerTask(input.storyId, 'memory', prisma)
    const compiler = new RuntimePromptCompiler()
    const compiled = compiler.compile(base, task, prompt)

    const raw = await callAIWithStageRetry(app, {
      storyId: input.storyId,
      chapterId: input.chapterId,
      callType: 'memory_stage',
      compiled,
      maxTokens: 2048
    })

    const parsed = JSON.parse(cleanJsonBlock(raw))
    const result: MemoryStageResult = {
      mainEvents: parsed.mainEvents ?? [],
      sideEvents: parsed.sideEvents ?? [],
      emotions: parsed.emotions ?? [],
      foreshadowing: parsed.foreshadowing ?? [],
      relationshipChanges: parsed.relationshipChanges ?? [],
      scenes: parsed.scenes ?? [],
      timelinePosition: parsed.timelinePosition ?? null,
      summary: parsed.summary ?? '',
      timelineEvents: parsed.timelineEvents
    }

    return { status: 'success', result, completedAt }
  } catch (err: any) {
    app.log.error(`[MemoryStage] ${err.message}`)
    return { status: 'failed', errorMessage: err.message, completedAt }
  }
}
```

- [ ] **Step 4: 跑测试确认通过**

Run:
```bash
pnpm test --run apps/server/src/__tests__/services/stages-memory.test.ts
```
Expected: 3 个 test 全部 PASS。

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/services/stages/memory-stage.ts apps/server/src/__tests__/services/stages-memory.test.ts
git commit -m "feat(v3): add memory-stage service"
```

---

### Task 2.4: plot-arc-stage

**Files:**
- Create: `apps/server/src/services/stages/plot-arc-stage.ts`
- Create: `apps/server/src/__tests__/services/stages-plot-arc.test.ts`

- [ ] **Step 1: 写失败测试**

创建 `apps/server/src/__tests__/services/stages-plot-arc.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest'
import { runPlotArcStage } from '../../services/stages/plot-arc-stage.js'

vi.mock('../../services/ai-call-logger.js', () => ({
  callAIWithLog: vi.fn()
}))

import { callAIWithLog } from '../../services/ai-call-logger.js'

const mockApp: any = { prisma: {}, log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }

describe('plot-arc-stage', () => {
  it('returns success with consolidated plot arcs', async () => {
    const ai = {
      updates: [
        { existingId: 'arc1', progress: 60, currentStage: 's', nextGoal: 'g', unresolved: ['u'], summary: 'sum' }
      ],
      newArcs: []
    }
    ;(callAIWithLog as any).mockResolvedValueOnce(JSON.stringify(ai))

    const state = await runPlotArcStage(mockApp, {
      storyId: 's1', chapterId: 'c1', content: 'x', outline: '', chapterNumber: 1,
      existingArcs: [{ id: 'arc1', name: '主线', type: 'main', status: 'active', progress: 40, currentStage: 'old', nextGoal: 'og', unresolved: '[]', summary: 'old sum', stages: '[]', createdAt: new Date(), updatedAt: new Date(), closedReason: null, closedTargetArcId: null }],
      characterNames: ['张三'],
      latestBranchStates: []
    })

    expect(state.status).toBe('success')
    expect(state.result?.plotArcs).toBeDefined()
    expect(state.result!.plotArcs.length).toBeGreaterThan(0)
  })

  it('returns failed when AI fails both attempts', async () => {
    ;(callAIWithLog as any).mockResolvedValueOnce(null)

    const state = await runPlotArcStage(mockApp, {
      storyId: 's1', chapterId: 'c1', content: 'x', outline: '', chapterNumber: 1,
      existingArcs: [], characterNames: [], latestBranchStates: []
    })

    expect(state.status).toBe('failed')
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run:
```bash
pnpm test --run apps/server/src/__tests__/services/stages-plot-arc.test.ts
```
Expected: FAIL。

- [ ] **Step 3: 实现 plot-arc-stage**

创建 `apps/server/src/services/stages/plot-arc-stage.ts`:

```typescript
import type { FastifyInstance } from 'fastify'
import type { PendingPlotArcWrite } from '@novel-runtime/shared'
import { consolidatePlotArcs, type ExistingArcView } from '../plot-consolidator.js'
import type { StageContext, StageState } from './types.js'

export interface PlotArcStageInput extends StageContext {
  existingArcs: ExistingArcView[]
  characterNames: string[]
  latestBranchStates: Array<{
    characterId: string
    status: string
    relationships: string
  }>
}

export interface PlotArcStageResult {
  plotArcs: PendingPlotArcWrite[]
}

export async function runPlotArcStage(
  app: FastifyInstance,
  input: PlotArcStageInput
): Promise<StageState<PlotArcStageResult>> {
  const completedAt = new Date().toISOString()
  try {
    const plotArcs = await consolidatePlotArcs(
      app,
      input.storyId,
      input.chapterId,
      input.existingArcs,
      input.content,
      input.outline
    )
    return { status: 'success', result: { plotArcs }, completedAt }
  } catch (err: any) {
    app.log.error(`[PlotArcStage] ${err.message}`)
    return { status: 'failed', errorMessage: err.message, completedAt }
  }
}
```

- [ ] **Step 4: 跑测试确认通过**

Run:
```bash
pnpm test --run apps/server/src/__tests__/services/stages-plot-arc.test.ts
```
Expected: 2 个 test 全部 PASS。

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/services/stages/plot-arc-stage.ts apps/server/src/__tests__/services/stages-plot-arc.test.ts
git commit -m "feat(v3): add plot-arc-stage service"
```

---

### Task 2.5: graph-extract-stage

**Files:**
- Create: `apps/server/src/services/stages/graph-extract-stage.ts`
- Create: `apps/server/src/__tests__/services/stages-graph-extract.test.ts`

- [ ] **Step 1: 写失败测试**

创建 `apps/server/src/__tests__/services/stages-graph-extract.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest'
import { runGraphExtractStage } from '../../services/stages/graph-extract-stage.js'

vi.mock('../../services/ai-call-logger.js', () => ({
  callAIWithLog: vi.fn()
}))

import { callAIWithLog } from '../../services/ai-call-logger.js'

const mockApp: any = { prisma: {}, log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }

describe('graph-extract-stage', () => {
  it('returns success with parsed chapterGraph', async () => {
    const ai = {
      nodes: [{ type: 'character', key: 'zhangsan', label: '张三', importance: 8 }],
      edges: []
    }
    ;(callAIWithLog as any).mockResolvedValueOnce(JSON.stringify(ai))

    const state = await runGraphExtractStage(mockApp, {
      storyId: 's1', chapterId: 'c1', content: 'x', outline: '', chapterNumber: 1,
      characterNames: ['张三'],
      prevCumulativeGraphKeys: [],
      latestBranchStates: []
    })

    expect(state.status).toBe('success')
    expect(state.result?.chapterGraph.nodes).toHaveLength(1)
  })

  it('returns failed on persistent parse error', async () => {
    ;(callAIWithLog as any).mockResolvedValueOnce('not-json')
    ;(callAIWithLog as any).mockResolvedValueOnce('still-bad')

    const state = await runGraphExtractStage(mockApp, {
      storyId: 's1', chapterId: 'c1', content: 'x', outline: '', chapterNumber: 1,
      characterNames: [], prevCumulativeGraphKeys: [], latestBranchStates: []
    })

    expect(state.status).toBe('failed')
  })

  it('returns empty chapterGraph on empty AI response', async () => {
    ;(callAIWithLog as any).mockResolvedValueOnce('{}')

    const state = await runGraphExtractStage(mockApp, {
      storyId: 's1', chapterId: 'c1', content: 'x', outline: '', chapterNumber: 1,
      characterNames: [], prevCumulativeGraphKeys: [], latestBranchStates: []
    })

    expect(state.status).toBe('success')
    expect(state.result?.chapterGraph.nodes).toEqual([])
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run:
```bash
pnpm test --run apps/server/src/__tests__/services/stages-graph-extract.test.ts
```
Expected: FAIL。

- [ ] **Step 3: 实现 graph-extract-stage**

创建 `apps/server/src/services/stages/graph-extract-stage.ts`:

```typescript
import type { FastifyInstance } from 'fastify'
import { RuntimePromptCompiler } from '@novel-runtime/ai-provider'
import { cleanJsonBlock } from '@novel-runtime/shared'
import { loadRuntimeBase, loadWorkerTask } from '../runtime-loader.js'
import { callAIWithStageRetry, type StageContext, type StageState } from './types.js'
import type { GraphSnapshot } from '../graph-snapshot.js'

export interface GraphExtractStageInput extends StageContext {
  characterNames: string[]
  prevCumulativeGraphKeys: string[]
  latestBranchStates: Array<{ characterId: string; name: string; status: string }>
}

export interface GraphExtractStageResult {
  chapterGraph: GraphSnapshot
}

/**
 * 本章图谱 stage: AI 单次抽取本章实体和关系,**不与历史合并**(gacha 语义)。
 * AI 必须复用 prevCumulativeGraphKeys 列表里的 type:key(锚定历史),
 * 否则不能引入新 key;character/faction/item 类型节点复用 characterNames。
 */
export async function runGraphExtractStage(
  app: FastifyInstance,
  input: GraphExtractStageInput
): Promise<StageState<GraphExtractStageResult>> {
  const completedAt = new Date().toISOString()
  const charList = input.characterNames.join('、') || '(无)'
  const keyList = input.prevCumulativeGraphKeys.length ? input.prevCumulativeGraphKeys.join(', ') : '(空, 本章可自由起 key)'

  const prompt = `你是小说知识图谱抽取助手。

【任务】基于章节内容,抽取本章涉及的实体节点和关系边。只看本章正文,不要混入历史上下文。

【约束】
1. type 必须是 character / faction / event / item 之一,其他值(如 weapon/prop/realm/object)一律收敛为 item
2. character/faction/item 类型节点:
   - 若在【已有 graph key 列表】中,复用对应 type:key
   - 若对应【已有角色名】,type=character,key 用角色英文拼音小写下划线
   - 否则 key 用拼音小写下划线
3. event 类型节点 key 用英文小写下划线
4. importance >= 6 才提取(过滤路人/环境)
5. relation 简洁(2-6字),如 隶属 / 对抗 / 师徒 / 配偶 / 兄弟

【已有 graph key 列表(必须复用)】
${keyList}

【已有角色名(锚定命名)】
${charList}

【输出严格 JSON】
{
  "nodes": [{ "type": "character", "key": "zhangsan", "label": "张三", "importance": 8, "data": {} }],
  "edges": [{ "fromType": "character", "fromKey": "zhangsan", "toType": "faction", "toKey": "mingjiao", "relation": "隶属" }]
}

【章节大纲】${input.outline}
【章节内容】${input.content.slice(0, 8000)}`

  try {
    const prisma = app.prisma
    const base = await loadRuntimeBase(input.storyId, prisma)
    const task = await loadWorkerTask(input.storyId, 'graph', prisma)
    const compiler = new RuntimePromptCompiler()
    const compiled = compiler.compile(base, task, prompt)

    const raw = await callAIWithStageRetry(app, {
      storyId: input.storyId,
      chapterId: input.chapterId,
      callType: 'graph_extract_stage',
      compiled,
      maxTokens: 2048
    })

    const parsed = JSON.parse(cleanJsonBlock(raw))
    const nodes = Array.isArray(parsed.nodes) ? parsed.nodes : []
    const edges = Array.isArray(parsed.edges) ? parsed.edges : []

    // 过滤低 importance 节点(与 graph-extractor 行为一致)
    const filtered = nodes.filter((n: any) => (n.importance ?? 0) >= 6)

    const chapterGraph: GraphSnapshot = {
      nodes: filtered.map((n: any) => ({
        type: n.type,
        key: n.key,
        label: n.label,
        data: n.data || {}
      })),
      edges: edges.map((e: any) => ({
        fromType: e.fromType,
        fromKey: e.fromKey,
        toType: e.toType,
        toKey: e.toKey,
        relation: e.relation,
        weight: e.weight ?? 1
      })),
      timestamp: new Date().toISOString()
    }

    return { status: 'success', result: { chapterGraph }, completedAt }
  } catch (err: any) {
    app.log.error(`[GraphExtractStage] ${err.message}`)
    return { status: 'failed', errorMessage: err.message, completedAt }
  }
}
```

- [ ] **Step 4: 跑测试确认通过**

Run:
```bash
pnpm test --run apps/server/src/__tests__/services/stages-graph-extract.test.ts
```
Expected: 3 个 test 全部 PASS。

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/services/stages/graph-extract-stage.ts apps/server/src/__tests__/services/stages-graph-extract.test.ts
git commit -m "feat(v3): add graph-extract-stage service"
```

---

### Task 2.6: 验证 Commit 2 全绿

- [ ] **Step 1: 跑全部测试**

Run:
```bash
pnpm test --run
```
Expected: 所有测试通过(原有 + 4 个新 stage 测试)。

- [ ] **Step 2: 跑 typecheck**

Run:
```bash
pnpm typecheck
```
Expected: 无错。

---

## Commit 3: `refactor(v3): split chapters-archive handler into prepare/cancel/archive endpoints`

> 把 `chapters-archive.ts` 拆为 prepare / cancel / archive 三段。删除所有 `updateMany({where: {status: ...}})` 锁,仅依赖状态机自身 + UI 按钮 disabled。Prepare 端点用 Promise.all 并行触发 4 stage,各自独立写入 pendingArchiveData.stages[name]。Archive 端点验证 v3 shape + ∀ stage.status === 'success' 才提交。

### Task 3.1: 扩展 shared archive.ts 加 v3 shape

**Files:**
- Modify: `packages/shared/src/archive.ts`

- [ ] **Step 1: 在文件末尾追加 v3 类型 + schema**

打开 `packages/shared/src/archive.ts`,在文件末尾追加:

```typescript
/**
 * v3 shape (2026-07-25 引入)。
 * 把单一 PendingArchiveData 拆为 4 个独立 stage 状态。
 * 老 v1/v2 blob 无 `version` 字段 → 前端检测为老 shape,提示用户重新 prepare-archive。
 */
export interface PendingArchiveDataV3 {
  version: 3
  stages: {
    character: PendingStageState
    memory: PendingStageState
    plotArc: PendingStageState
    graph: PendingStageState
  }
  meta: {
    extractedAt: string
    chapterNumber: number
  }
}

export interface PendingStageState {
  status: 'pending' | 'running' | 'success' | 'failed'
  result?: unknown  // 路由不解析 result 内部;前端按 stage 名字解析
  errorMessage?: string
  completedAt?: string
}

export const PendingStageStateSchema = z.object({
  status: z.enum(['pending', 'running', 'success', 'failed']),
  result: z.unknown().optional(),
  errorMessage: z.string().optional(),
  completedAt: z.string().optional()
}).passthrough()

export const PendingArchiveDataV3Schema = z.object({
  version: z.literal(3),
  stages: z.object({
    character: PendingStageStateSchema,
    memory: PendingStageStateSchema,
    plotArc: PendingStageStateSchema,
    graph: PendingStageStateSchema
  }),
  meta: z.object({
    extractedAt: z.string(),
    chapterNumber: z.number()
  })
}).passthrough()

export type PendingArchiveDataV3Z = z.infer<typeof PendingArchiveDataV3Schema>
```

- [ ] **Step 2: 类型检查**

Run:
```bash
pnpm typecheck
```
Expected: 无错。

- [ ] **Step 3: Commit**

```bash
git add packages/shared/src/archive.ts
git commit -m "feat(v3): add PendingArchiveDataV3 type + schema in shared"
```

---

### Task 3.2: 重写 chapters-archive.ts 为三端点(无锁)

**Files:**
- Modify: `apps/server/src/routes/chapters-archive.ts` (整文件重写)

- [ ] **Step 1: 写失败测试(集成)**

创建 `apps/server/src/__tests__/routes/prepare-archive-v3.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createMockApp, callHandler } from '../setup.js'

// Mock all 4 stages so route does not hit real AI
vi.mock('../../services/stages/character-stage.js', () => ({
  runCharacterStage: vi.fn()
}))
vi.mock('../../services/stages/memory-stage.js', () => ({
  runMemoryStage: vi.fn()
}))
vi.mock('../../services/stages/plot-arc-stage.js', () => ({
  runPlotArcStage: vi.fn()
}))
vi.mock('../../services/stages/graph-extract-stage.js', () => ({
  runGraphExtractStage: vi.fn()
}))

import { runCharacterStage } from '../../services/stages/character-stage.js'
import { runMemoryStage } from '../../services/stages/memory-stage.js'
import { runPlotArcStage } from '../../services/stages/plot-arc-stage.js'
import { runGraphExtractStage } from '../../services/stages/graph-extract-stage.js'

const ts = '2026-07-25T00:00:00.000Z'

const baseChapter = {
  id: 'c1',
  storyId: 's1',
  status: 'draft',
  isSideStory: false,
  content: 'a'.repeat(200),
  outline: 'short',
  number: 1,
  parentChapterId: null,
  pendingArchiveData: null,
  chapterGraph: null,
  cumulativeGraph: null
}

describe('prepare-archive v3 — 4 stage parallel + status field', () => {
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
      character: { findMany: vi.fn().mockResolvedValue([]) },
      characterBranchState: { findMany: vi.fn().mockResolvedValue([]) },
      plotArc: { findMany: vi.fn().mockResolvedValue([]) }
    }
    const { chapterArchiveRoutes } = await import('../../routes/chapters-archive.js')
    const built = createMockApp(mockPrisma)
    await chapterArchiveRoutes(built.app)
    routes = built.routes
  })

  it('runs all 4 stages in parallel and persists v3 pendingArchiveData', async () => {
    mockPrisma.chapter.findUnique.mockResolvedValue({ ...baseChapter })

    ;(runCharacterStage as any).mockResolvedValue({
      status: 'success', result: { characterStates: [] }, completedAt: ts
    })
    ;(runMemoryStage as any).mockResolvedValue({
      status: 'success', result: { mainEvents: [], sideEvents: [], emotions: [], foreshadowing: [], relationshipChanges: [], scenes: [], timelinePosition: null, summary: '' }, completedAt: ts
    })
    ;(runPlotArcStage as any).mockResolvedValue({
      status: 'success', result: { plotArcs: [] }, completedAt: ts
    })
    ;(runGraphExtractStage as any).mockResolvedValue({
      status: 'success', result: { chapterGraph: { nodes: [], edges: [], timestamp: ts } }, completedAt: ts
    })

    const result = await callHandler(
      routes, 'POST', '/api/chapters/:chapterId/prepare-archive',
      undefined, { chapterId: 'c1' }
    )

    expect(runCharacterStage).toHaveBeenCalled()
    expect(runMemoryStage).toHaveBeenCalled()
    expect(runPlotArcStage).toHaveBeenCalled()
    expect(runGraphExtractStage).toHaveBeenCalled()
    expect(result.status).toBe(200)
    // v3 shape: pendingArchiveData 写入是带 version=3 的对象
    const updateCall = mockPrisma.chapter.update.mock.calls.find(
      (c: any[]) => c[0]?.data?.pendingArchiveData !== undefined
    )
    expect(updateCall).toBeDefined()
    const parsed = JSON.parse(updateCall[0].data.pendingArchiveData)
    expect(parsed.version).toBe(3)
    expect(parsed.stages.character.status).toBe('success')
    expect(parsed.stages.memory.status).toBe('success')
    expect(parsed.stages.plotArc.status).toBe('success')
    expect(parsed.stages.graph.status).toBe('success')
  })

  it('does NOT use updateMany as lock — no race-condition barrier', async () => {
    mockPrisma.chapter.findUnique.mockResolvedValue({ ...baseChapter })
    ;(runCharacterStage as any).mockResolvedValue({ status: 'success', result: { characterStates: [] }, completedAt: ts })
    ;(runMemoryStage as any).mockResolvedValue({ status: 'success', result: {}, completedAt: ts })
    ;(runPlotArcStage as any).mockResolvedValue({ status: 'success', result: { plotArcs: [] }, completedAt: ts })
    ;(runGraphExtractStage as any).mockResolvedValue({ status: 'success', result: { chapterGraph: { nodes: [], edges: [], timestamp: ts } }, completedAt: ts })

    await callHandler(routes, 'POST', '/api/chapters/:chapterId/prepare-archive', undefined, { chapterId: 'c1' })

    // v3 删除了 updateMany 锁
    const lockCalls = mockPrisma.chapter.updateMany.mock.calls
    expect(lockCalls).toHaveLength(0)
  })

  it('isolates failure: one stage failed → others still success in payload', async () => {
    mockPrisma.chapter.findUnique.mockResolvedValue({ ...baseChapter })
    ;(runCharacterStage as any).mockResolvedValue({
      status: 'failed', errorMessage: 'AI 返回格式错误', completedAt: ts
    })
    ;(runMemoryStage as any).mockResolvedValue({ status: 'success', result: {}, completedAt: ts })
    ;(runPlotArcStage as any).mockResolvedValue({ status: 'success', result: { plotArcs: [] }, completedAt: ts })
    ;(runGraphExtractStage as any).mockResolvedValue({ status: 'success', result: { chapterGraph: { nodes: [], edges: [], timestamp: ts } }, completedAt: ts })

    await callHandler(routes, 'POST', '/api/chapters/:chapterId/prepare-archive', undefined, { chapterId: 'c1' })

    const updateCall = mockPrisma.chapter.update.mock.calls.find(
      (c: any[]) => c[0]?.data?.pendingArchiveData !== undefined
    )
    const parsed = JSON.parse(updateCall[0].data.pendingArchiveData)
    expect(parsed.stages.character.status).toBe('failed')
    expect(parsed.stages.character.errorMessage).toBe('AI 返回格式错误')
    expect(parsed.stages.memory.status).toBe('success')
    expect(parsed.stages.plotArc.status).toBe('success')
    expect(parsed.stages.graph.status).toBe('success')
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run:
```bash
pnpm test --run apps/server/src/__tests__/routes/prepare-archive-v3.test.ts
```
Expected: FAIL(所有 test,因为还没有 4 stage mock 实现就位,会运行时错误或未注册新路由)。

- [ ] **Step 3: 重写 chapters-archive.ts**

整文件覆盖 `apps/server/src/routes/chapters-archive.ts`:

```typescript
import type { FastifyInstance } from 'fastify'
import { PrepareArchiveRequestSchema, safeJsonParse } from '@novel-runtime/shared'
import type { PendingArchiveDataV3 } from '@novel-runtime/shared'
import { parseBody, getOrThrowChapter } from './_helpers.js'
import { runCharacterStage } from '../services/stages/character-stage.js'
import { runMemoryStage } from '../services/stages/memory-stage.js'
import { runPlotArcStage } from '../services/stages/plot-arc-stage.js'
import { runGraphExtractStage } from '../services/stages/graph-extract-stage.js'

/**
 * v3 archive 端点 — 4 端点:
 *   POST /api/chapters/:chapterId/prepare-archive              (启动)
 *   POST /api/chapters/:chapterId/prepare-archive/cancel       (撤销审查)
 *   POST /api/chapters/:chapterId/archive                      (确认归档)
 *
 * v3 关键变化:
 *   - 删除所有 updateMany 锁。仅依赖状态机自身(draft/reviewing/archived) +
 *     UI 按钮 disabled 防双击。
 *   - prepare-archive 调 4 stage 并行(Promise.all),各自结果写入
 *     pendingArchiveData.stages[name]。单 stage 失败不影响其他 stage。
 *   - archive 验证 pendingArchiveData.version === 3 + ∀ stage.status === 'success',
 *     事务内 commit(本 commit 不含 cumulativeGraph build,在 Commit 4 加)。
 */
export async function chapterArchiveRoutes(app: FastifyInstance) {
  app.post('/api/chapters/:chapterId/prepare-archive', async (request, reply) => {
    const { chapterId } = request.params as any
    const body = parseBody(PrepareArchiveRequestSchema, request, reply)
    if (body === null) return

    const prisma = app.prisma
    const chapter = await getOrThrowChapter(prisma, chapterId, reply)
    if (chapter === null) return

    if (chapter.status !== 'draft' && chapter.status !== 'reviewing') {
      return reply.status(400).send({
        success: false,
        error: `章节当前状态为 ${chapter.status}，只允许 draft 或 reviewing 状态准备归档`
      })
    }

    if (chapter.isSideStory) {
      await prisma.chapter.update({ where: { id: chapterId }, data: { status: 'archived' } })
      return { success: true, data: { sideStory: true, status: 'archived' } }
    }

    if (!chapter.content) {
      await prisma.chapter.update({ where: { id: chapterId }, data: { status: 'archived' } })
      return { success: true, data: { noContent: true, status: 'archived' } }
    }

    const outlineText = chapter.outline || ''
    const contentText = chapter.content || ''
    if (!outlineText.trim()) return reply.status(400).send({ success: false, error: '归档失败：大纲不能为空' })
    if (!contentText.trim()) return reply.status(400).send({ success: false, error: '归档失败：正文不能为空' })
    if (contentText.length < outlineText.length) {
      return reply.status(400).send({
        success: false,
        error: `归档失败：正文长度（${contentText.length}）不能小于大纲长度（${outlineText.length}）`
      })
    }

    // 直接翻 status(无锁;UI 按钮 + 状态机双层防双击)
    await prisma.chapter.update({
      where: { id: chapterId },
      data: { status: 'reviewing', pendingArchiveData: null, chapterGraph: null }
    })

    // Pre-stage: 文本匹配正文 + 现有 Character → matchedCharacters
    const allCharacters = await prisma.character.findMany({
      where: { storyId: chapter.storyId },
      select: { id: true, name: true, key: true, label: true, importance: true }
    })
    const matchedCharacters = allCharacters.filter((c: any) => contentText.includes(c.name))
    const characterNames = matchedCharacters.map((c: any) => c.name)
    const characterKeys = matchedCharacters.map((c: any) => c.key)

    // 查 latestBranchStates(每个 matched character 的最新一条)
    const latestBranchStates = matchedCharacters.length > 0
      ? await prisma.characterBranchState.findMany({
          where: { characterId: { in: matchedCharacters.map((c: any) => c.id) } },
          orderBy: { fromChapterNumber: 'desc' }
        })
      : []
    // 去重每个 character 保留最新
    const latestPerChar = new Map<string, any>()
    for (const s of latestBranchStates) {
      if (!latestPerChar.has(s.characterId)) latestPerChar.set(s.characterId, s)
    }
    const dedupedBranchStates = Array.from(latestPerChar.values())

    // 查 existing arcs(全部状态,consolidator 内部按 status 分流)
    const allExistingArcs = await prisma.plotArc.findMany({ where: { storyId: chapter.storyId } })

    // 查 prev cumulativeGraph keys
    let prevCumulativeGraphKeys: string[] = []
    if (chapter.parentChapterId) {
      const parent = await prisma.chapter.findUnique({
        where: { id: chapter.parentChapterId },
        select: { cumulativeGraph: true }
      })
      if (parent?.cumulativeGraph) {
        const parsed = safeJsonParse<{ nodes?: Array<{ type: string; key: string }> }>(parent.cumulativeGraph, null)
        if (parsed?.nodes) prevCumulativeGraphKeys = parsed.nodes.map(n => `${n.type}:${n.key}`)
      }
    }
    if (prevCumulativeGraphKeys.length === 0) {
      // 主线回退:找前一个 number 的章节
      const prev = await prisma.chapter.findFirst({
        where: {
          storyId: chapter.storyId,
          parentChapterId: null,
          number: chapter.number - 1,
          id: { not: chapterId }
        },
        select: { cumulativeGraph: true }
      })
      if (prev?.cumulativeGraph) {
        const parsed = safeJsonParse<{ nodes?: Array<{ type: string; key: string }> }>(prev.cumulativeGraph, null)
        if (parsed?.nodes) prevCumulativeGraphKeys = parsed.nodes.map(n => `${n.type}:${n.key}`)
      }
    }

    // 4 stage 并行
    const [characterState, memoryState, plotArcState, graphState] = await Promise.all([
      runCharacterStage(app, {
        storyId: chapter.storyId, chapterId, content: contentText, outline: outlineText,
        chapterNumber: chapter.number, matchedCharacters
      }),
      runMemoryStage(app, {
        storyId: chapter.storyId, chapterId, content: contentText, outline: outlineText,
        chapterNumber: chapter.number, characterNames, characterKeys
      }),
      runPlotArcStage(app, {
        storyId: chapter.storyId, chapterId, content: contentText, outline: outlineText,
        chapterNumber: chapter.number, existingArcs: allExistingArcs as any,
        characterNames, latestBranchStates: dedupedBranchStates
      }),
      runGraphExtractStage(app, {
        storyId: chapter.storyId, chapterId, content: contentText, outline: outlineText,
        chapterNumber: chapter.number, characterNames, prevCumulativeGraphKeys,
        latestBranchStates: dedupedBranchStates
      })
    ])

    const pendingData: PendingArchiveDataV3 = {
      version: 3,
      stages: {
        character: characterState,
        memory: memoryState,
        plotArc: plotArcState,
        graph: graphState
      },
      meta: {
        extractedAt: new Date().toISOString(),
        chapterNumber: chapter.number
      }
    }

    // 把 graph stage 成功时的 chapterGraph 也独立写到 Chapter 行
    const chapterGraphUpdate = (graphState.status === 'success' && graphState.result)
      ? JSON.stringify((graphState.result as any).chapterGraph)
      : null

    await prisma.chapter.update({
      where: { id: chapterId },
      data: {
        status: 'reviewing',
        pendingArchiveData: JSON.stringify(pendingData),
        chapterGraph: chapterGraphUpdate
      }
    })

    return { success: true, data: pendingData }
  })

  app.post('/api/chapters/:chapterId/prepare-archive/cancel', async (request, reply) => {
    const { chapterId } = request.params as any
    const prisma = app.prisma
    const chapter = await getOrThrowChapter(prisma, chapterId, reply)
    if (chapter === null) return

    if (chapter.status !== 'reviewing') {
      return reply.status(400).send({
        success: false,
        error: `章节当前状态为 ${chapter.status}，只允许 reviewing 状态撤销审查`
      })
    }

    await prisma.chapter.update({
      where: { id: chapterId },
      data: { status: 'draft', pendingArchiveData: null, chapterGraph: null }
    })

    return { success: true, data: { status: 'draft' } }
  })

  app.post('/api/chapters/:chapterId/archive', async (request, reply) => {
    const { chapterId } = request.params as any
    const prisma = app.prisma
    const chapter = await getOrThrowChapter(prisma, chapterId, reply)
    if (chapter === null) return

    if (chapter.status === 'archived') {
      return { success: true, data: { alreadyArchived: true } }
    }
    if (chapter.status !== 'reviewing') {
      return reply.status(400).send({
        success: false,
        error: `章节当前状态为 ${chapter.status}，只允许 reviewing 状态确认归档`
      })
    }
    if (chapter.isSideStory || !chapter.content) {
      await prisma.chapter.update({
        where: { id: chapterId },
        data: { status: 'archived', pendingArchiveData: null }
      })
      return { success: true, data: { skipped: true } }
    }

    const pendingRaw = chapter.pendingArchiveData
    if (!pendingRaw) {
      return reply.status(400).send({
        success: false,
        error: '归档失败：没有找到预归档数据，请先调用 prepare-archive'
      })
    }
    const pending = safeJsonParse<any>(pendingRaw, null)
    if (!pending || pending.version !== 3) {
      return reply.status(400).send({
        success: false,
        error: '归档失败：pendingArchiveData 版本不匹配，请重新准备归档'
      })
    }
    const failedStages = Object.entries(pending.stages as Record<string, any>)
      .filter(([_, s]) => s.status !== 'success')
      .map(([name]) => name)
    if (failedStages.length > 0) {
      return reply.status(400).send({
        success: false,
        error: `归档失败：以下 stage 未通过：${failedStages.join(', ')}`
      })
    }

    // 直接翻 status(无锁; UI 防双击)
    await prisma.chapter.update({
      where: { id: chapterId },
      data: { status: 'archived', pendingArchiveData: null }
    })

    return { success: true, data: { cumulativeGraph: null, optimizedCount: 0 } }
  })
}
```

- [ ] **Step 4: 跑 v3 测试确认通过**

Run:
```bash
pnpm test --run apps/server/src/__tests__/routes/prepare-archive-v3.test.ts
```
Expected: 3 个 test 全部 PASS。

- [ ] **Step 5: 调整原 prepare-archive.test.ts(锁已删,断言需更新)**

打开 `apps/server/src/__tests__/routes/prepare-archive.test.ts`。

把所有引用 `mockPrisma.chapter.updateMany` 的断言改写为"v3 不使用锁":
- 删除 `lockCall` 查找
- 删除 `lockCall[0].where.status` 断言
- 删除"rejects archived status with 409"test(预检 400 已替代)
- 保留"rolls back to draft when fails"等核心 test,但断言从 updateMany 改为 update

具体改法:

把第二个 describe block('prepare-archive route — v2 re-prepare from reviewing')里:
- 第三个 test('uses updateMany where status IN [draft, reviewing]')→ 删
- 第四个 test('rejects archived status with 409')→ 改成 400(v3 预检拦截)
- 第五个 test('clears stale pendingArchiveData on re-prepare so the new payload can take over')→ 改成断言 update(不是 updateMany)写入了 pendingArchiveData: null

- [ ] **Step 6: 跑原测试 + typecheck**

Run:
```bash
pnpm test --run && pnpm typecheck
```
Expected: 所有测试通过,typecheck 无错。

- [ ] **Step 7: Commit**

```bash
git add apps/server/src/routes/chapters-archive.ts apps/server/src/__tests__/routes/prepare-archive-v3.test.ts apps/server/src/__tests__/routes/prepare-archive.test.ts
git commit -m "refactor(v3): split archive handler into prepare/cancel/archive + drop all locks"
```

---

### Task 3.3: cancel 端点测试

**Files:**
- Create: `apps/server/src/__tests__/routes/prepare-archive-cancel.test.ts`

- [ ] **Step 1: 写测试**

创建 `apps/server/src/__tests__/routes/prepare-archive-cancel.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createMockApp, callHandler } from '../setup.js'

describe('prepare-archive/cancel route', () => {
  let mockPrisma: any
  let routes: Record<string, any>

  beforeEach(async () => {
    vi.clearAllMocks()
    mockPrisma = {
      chapter: {
        findUnique: vi.fn(),
        update: vi.fn()
      }
    }
    const { chapterArchiveRoutes } = await import('../../routes/chapters-archive.js')
    const built = createMockApp(mockPrisma)
    await chapterArchiveRoutes(built.app)
    routes = built.routes
  })

  it('reverts chapter to draft and clears pendingArchiveData + chapterGraph', async () => {
    mockPrisma.chapter.findUnique.mockResolvedValue({
      id: 'c1', storyId: 's1', status: 'reviewing',
      pendingArchiveData: '{"version":3}', chapterGraph: '{"nodes":[]}'
    })
    mockPrisma.chapter.update.mockResolvedValue({ id: 'c1', status: 'draft' })

    const result = await callHandler(
      routes, 'POST', '/api/chapters/:chapterId/prepare-archive/cancel',
      undefined, { chapterId: 'c1' }
    )

    expect(result.status).toBe(200)
    expect(result.body).toEqual(expect.objectContaining({ success: true, data: { status: 'draft' } }))

    const updateCall = mockPrisma.chapter.update.mock.calls[0]
    expect(updateCall[0].where).toEqual({ id: 'c1' })
    expect(updateCall[0].data.status).toBe('draft')
    expect(updateCall[0].data.pendingArchiveData).toBeNull()
    expect(updateCall[0].data.chapterGraph).toBeNull()
  })

  it('returns 400 when chapter is not in reviewing state', async () => {
    mockPrisma.chapter.findUnique.mockResolvedValue({ id: 'c1', status: 'draft' })

    const result = await callHandler(
      routes, 'POST', '/api/chapters/:chapterId/prepare-archive/cancel',
      undefined, { chapterId: 'c1' }
    )

    expect(result.status).toBe(400)
    expect(mockPrisma.chapter.update).not.toHaveBeenCalled()
  })

  it('returns 404 when chapter does not exist', async () => {
    mockPrisma.chapter.findUnique.mockResolvedValue(null)

    const result = await callHandler(
      routes, 'POST', '/api/chapters/:chapterId/prepare-archive/cancel',
      undefined, { chapterId: 'nonexistent' }
    )

    expect(result.status).toBe(404)
  })
})
```

- [ ] **Step 2: 跑测试确认通过**

Run:
```bash
pnpm test --run apps/server/src/__tests__/routes/prepare-archive-cancel.test.ts
```
Expected: 3 个 test 全部 PASS。

- [ ] **Step 3: Commit**

```bash
git add apps/server/src/__tests__/routes/prepare-archive-cancel.test.ts
git commit -m "test(v3): add prepare-archive/cancel route tests"
```

---

### Task 3.4: 验证 Commit 3 全绿

- [ ] **Step 1: 跑全部测试**

Run:
```bash
pnpm test --run
```
Expected: 所有测试通过。

- [ ] **Step 2: 跑 typecheck + lint**

Run:
```bash
pnpm typecheck && pnpm lint
```
Expected: 无错。

---

## Commit 4: `feat(v3): add cumulative-graph builder with 2-hop BFS + AI dedup`

> 新建 `apps/server/src/services/cumulative-graph.ts`,实现 `buildCumulativeGraph`。Archive 端点在事务前调它,失败 500。空 chapterGraph / 首章 → 不调 AI。

### Task 4.1: cumulative-graph 服务

**Files:**
- Create: `apps/server/src/services/cumulative-graph.ts`
- Create: `apps/server/src/__tests__/services/cumulative-graph.test.ts`

- [ ] **Step 1: 写失败测试**

创建 `apps/server/src/__tests__/services/cumulative-graph.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest'
import { buildCumulativeGraph } from '../../services/cumulative-graph.js'

vi.mock('../../services/ai-call-logger.js', () => ({
  callAIWithLog: vi.fn()
}))

import { callAIWithLog } from '../../services/ai-call-logger.js'

const mockApp: any = {
  prisma: {},
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}

const ts = '2026-07-25T00:00:00.000Z'

describe('buildCumulativeGraph', () => {
  it('returns prevCumulativeGraph when chapterGraph is empty (no AI called)', async () => {
    const prev = { nodes: [{ type: 'character', key: 'a', label: 'A', data: {} }], edges: [], timestamp: ts }

    const result = await buildCumulativeGraph(mockApp, {
      storyId: 's1', chapterId: 'c1', chapterNumber: 2,
      chapterGraph: { nodes: [], edges: [], timestamp: ts },
      prevCumulativeGraph: prev
    })

    expect(result.aiCalled).toBe(false)
    expect(result.cumulativeGraph).toEqual(prev)
    expect(callAIWithLog).not.toHaveBeenCalled()
  })

  it('returns chapterGraph copy when prev is null (first chapter)', async () => {
    const chapterGraph = { nodes: [{ type: 'character', key: 'a', label: 'A', data: {} }], edges: [], timestamp: ts }

    const result = await buildCumulativeGraph(mockApp, {
      storyId: 's1', chapterId: 'c1', chapterNumber: 1,
      chapterGraph, prevCumulativeGraph: null
    })

    expect(result.aiCalled).toBe(false)
    expect(result.cumulativeGraph.nodes).toEqual(chapterGraph.nodes)
    expect(callAIWithLog).not.toHaveBeenCalled()
  })

  it('calls AI dedup and merges when both chapterGraph and prev are non-empty', async () => {
    const prev = {
      nodes: [
        { type: 'character', key: 'a', label: 'A', data: {} },
        { type: 'character', key: 'b', label: 'B', data: {} }
      ],
      edges: [{ fromType: 'character', fromKey: 'a', toType: 'character', toKey: 'b', relation: '朋友', weight: 1 }],
      timestamp: ts
    }
    const chapterGraph = {
      nodes: [{ type: 'character', key: 'a', label: 'A', data: { newAttr: 'x' } }],
      edges: [{ fromType: 'character', fromKey: 'a', toType: 'character', toKey: 'b', relation: '敌对', weight: 1 }],
      timestamp: ts
    }

    // AI dedup 后的子图
    const deduped = {
      nodes: [
        { type: 'character', key: 'a', label: 'A', data: { newAttr: 'x' } },
        { type: 'character', key: 'b', label: 'B', data: {} }
      ],
      edges: [
        { fromType: 'character', fromKey: 'a', toType: 'character', toKey: 'b', relation: '朋友', weight: 1 },
        { fromType: 'character', fromKey: 'a', toType: 'character', toKey: 'b', relation: '敌对', weight: 1 }
      ]
    }
    ;(callAIWithLog as any).mockResolvedValueOnce(JSON.stringify(deduped))

    const result = await buildCumulativeGraph(mockApp, {
      storyId: 's1', chapterId: 'c1', chapterNumber: 2,
      chapterGraph, prevCumulativeGraph: prev
    })

    expect(result.aiCalled).toBe(true)
    expect(callAIWithLog).toHaveBeenCalled()
    // a 在 dedup 中保留,b 也保留,两条边都保留
    expect(result.cumulativeGraph.nodes).toHaveLength(2)
    expect(result.cumulativeGraph.edges).toHaveLength(2)
  })

  it('throws when AI fails', async () => {
    const chapterGraph = { nodes: [{ type: 'character', key: 'a', label: 'A', data: {} }], edges: [], timestamp: ts }
    const prev = { nodes: [], edges: [], timestamp: ts }

    ;(callAIWithLog as any).mockResolvedValueOnce(null)

    await expect(buildCumulativeGraph(mockApp, {
      storyId: 's1', chapterId: 'c1', chapterNumber: 2,
      chapterGraph, prevCumulativeGraph: prev
    })).rejects.toThrow()
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run:
```bash
pnpm test --run apps/server/src/__tests__/services/cumulative-graph.test.ts
```
Expected: FAIL with module not found。

- [ ] **Step 3: 实现 cumulative-graph**

创建 `apps/server/src/services/cumulative-graph.ts`:

```typescript
import type { FastifyInstance } from 'fastify'
import { RuntimePromptCompiler } from '@novel-runtime/ai-provider'
import { cleanJsonBlock } from '@novel-runtime/shared'
import { loadRuntimeBase, loadWorkerTask } from './runtime-loader.js'
import { callAIWithLog } from './ai-call-logger.js'
import { expandNeighborhood, type GraphSnapshot } from './graph-snapshot.js'

const SAFETY_MARGIN_TOKENS = 2000
const NEIGHBORHOOD_MAX_DEPTH = 2
const NEIGHBORHOOD_MAX_ENTITIES = 200

const NON_EVENT_TYPES = new Set(['character', 'faction', 'item'])

export interface CumulativeGraphInput {
  storyId: string
  chapterId: string
  chapterNumber: number
  chapterGraph: GraphSnapshot | null
  prevCumulativeGraph: GraphSnapshot | null
}

export interface CumulativeGraphResult {
  cumulativeGraph: GraphSnapshot
  aiCalled: boolean
}

/**
 * 从 chapterGraph + prev cumulativeGraph 计算本章节全局图谱。
 *
 * 路径:
 *   - 空 chapterGraph → 继承 prev
 *   - 首章 (prev = null) → 直接用 chapterGraph
 *   - 正常 → 2-hop BFS 找 prev 中与 chapterGraph 共享 type:key 的邻域 → 与 chapterGraph 合并 →
 *           AI 去重(对邻域内的边和节点)→ code merge 进 prev(基于 fromType:fromKey:relation:toType:toKey 去重)
 */
export async function buildCumulativeGraph(
  app: FastifyInstance,
  input: CumulativeGraphInput
): Promise<CumulativeGraphResult> {
  const chapterGraph = input.chapterGraph
  const prev = input.prevCumulativeGraph
  const now = new Date().toISOString()

  // 1. 空 chapterGraph:继承 prev(用户可能想完全删除本章图谱)
  if (!chapterGraph || chapterGraph.nodes.length === 0) {
    return {
      cumulativeGraph: prev ?? { nodes: [], edges: [], timestamp: now },
      aiCalled: false
    }
  }

  // 2. 首章:chapterGraph 自身即为全局图谱
  if (!prev) {
    return {
      cumulativeGraph: { ...chapterGraph, timestamp: now },
      aiCalled: false
    }
  }

  // 3. 正常路径:2-hop BFS + AI 去重 + code merge
  const prisma = app.prisma

  // 收集 chapterGraph 中的非 event 节点作为锚点
  const nonEventKeys = chapterGraph.nodes
    .filter(n => NON_EVENT_TYPES.has(n.type))
    .map(n => `${n.type}:${n.key}`)

  // prev 中匹配这些 key 的节点
  const prevKeySet = new Set(prev.nodes.map(n => `${n.type}:${n.key}`))
  const matchedKeys = nonEventKeys.filter(k => prevKeySet.has(k))

  // 如果没有非 event 节点匹配 → code merge chapterGraph 进 prev(不调 AI)
  if (matchedKeys.length === 0) {
    return {
      cumulativeGraph: codeMerge(prev, chapterGraph, now),
      aiCalled: false
    }
  }

  // 2-hop BFS over prev 从 matchedKeys 出发
  const base = await loadRuntimeBase(input.storyId, prisma)
  const task = await loadWorkerTask(input.storyId, 'graph', prisma)

  const firstCompiler = new RuntimePromptCompiler()
  const firstCompiled = firstCompiler.compile(base, task, buildDedupPrompt(prev, chapterGraph))
  const nonGraphTokens = firstCompiled.meta.totalTokens

  const resolved = await (await import('./ai-provider-init.js')).resolveProvider(prisma, input.storyId, input.chapterId)
  const contextLength = resolved?.config?.contextLength || 64000
  const outputReserve = resolved?.config?.maxTokens || 16384
  const graphBudget = Math.max(
    0,
    contextLength - nonGraphTokens - outputReserve - SAFETY_MARGIN_TOKENS
  )

  const neighborhood = expandNeighborhood(prev, matchedKeys, {
    maxDepth: NEIGHBORHOOD_MAX_DEPTH,
    maxTokens: graphBudget,
    maxEntities: NEIGHBORHOOD_MAX_ENTITIES
  })

  // 用 trimmed neighborhood 作为 dedup 输入的一部分
  const trimmedPrev: GraphSnapshot = {
    nodes: neighborhood.nodes,
    edges: neighborhood.edges,
    timestamp: prev.timestamp
  }

  const compiler = new RuntimePromptCompiler()
  const compiled = compiler.compile(base, task, buildDedupPrompt(trimmedPrev, chapterGraph))

  let raw: string | null
  try {
    raw = await callAIWithLog(app, {
      storyId: input.storyId, chapterId: input.chapterId, callType: 'cumulative_dedup',
      compiled, temperature: 0.2, maxTokens: 16384
    })
  } catch (err: any) {
    app.log.error(`[CumulativeGraph] AI call failed: ${err.message}`)
    throw err
  }
  if (!raw) throw new Error('未配置可用的 AI Provider，请检查模型配置')

  let parsed: any
  try {
    parsed = JSON.parse(cleanJsonBlock(raw))
  } catch (err: any) {
    app.log.error(`[CumulativeGraph] JSON parse failed: ${err.message}`)
    throw new Error(`AI 返回格式错误: ${err.message}`)
  }

  const deduped: GraphSnapshot = {
    nodes: parsed.nodes || [],
    edges: parsed.edges || [],
    timestamp: now
  }

  // code merge deduped → prev
  const merged = codeMerge(prev, deduped, now)

  app.log.info(
    `[CumulativeGraph] Neigh: ${neighborhood.nodes.length} nodes. ` +
    `Deduped: ${deduped.nodes.length} nodes, ${deduped.edges.length} edges. ` +
    `Merged cumulative: ${merged.nodes.length} nodes, ${merged.edges.length} edges.`
  )

  return { cumulativeGraph: merged, aiCalled: true }
}

function buildDedupPrompt(neighborhood: GraphSnapshot, chapterGraph: GraphSnapshot): string {
  return `你是小说知识图谱去重助手。

【任务】基于"上一章邻域子图"和"本章图谱",生成去重后的"小范围子图"。
- 节点去重:相同 type:key 合并 data,以最新为准
- 边去重:相同 (fromType:fromKey, relation, toType:toKey) 只保留一条
- 删除孤立的"上一章"节点(没有任何边,且不在 chapterGraph 中)

【上一章邻域子图】
${JSON.stringify(neighborhood)}

【本章图谱】
${JSON.stringify(chapterGraph)}

【输出严格 JSON】
{
  "nodes": [{ "type": "character", "key": "zhangsan", "label": "张三", "data": {} }],
  "edges": [{ "fromType": "character", "fromKey": "zhangsan", "toType": "character", "toKey": "lisi", "relation": "兄弟", "weight": 1 }]
}`
}

function codeMerge(prev: GraphSnapshot, chapterGraph: GraphSnapshot, now: string): GraphSnapshot {
  const nodeMap = new Map<string, any>()
  for (const n of prev.nodes) nodeMap.set(`${n.type}:${n.key}`, { ...n, data: n.data || {} })
  for (const n of chapterGraph.nodes) nodeMap.set(`${n.type}:${n.key}`, { ...n, data: n.data || {} })

  const seen = new Set<string>()
  const edges: any[] = []
  for (const e of [...prev.edges, ...chapterGraph.edges]) {
    const k = `${e.fromType}:${e.fromKey}|${e.relation}|${e.toType}:${e.toKey}`
    if (seen.has(k)) continue
    seen.add(k)
    edges.push({ ...e, weight: e.weight ?? 1 })
  }

  return {
    nodes: Array.from(nodeMap.values()),
    edges,
    timestamp: now
  }
}
```

- [ ] **Step 4: 跑测试确认通过**

Run:
```bash
pnpm test --run apps/server/src/__tests__/services/cumulative-graph.test.ts
```
Expected: 4 个 test 全部 PASS。

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/services/cumulative-graph.ts apps/server/src/__tests__/services/cumulative-graph.test.ts
git commit -m "feat(v3): add buildCumulativeGraph with 2-hop BFS + AI dedup"
```

---

### Task 4.2: archive 端点集成 buildCumulativeGraph

**Files:**
- Modify: `apps/server/src/routes/chapters-archive.ts`(archive 端点)
- Modify: `apps/server/src/__tests__/routes/prepare-archive-v3.test.ts`(加 archive 测试)

- [ ] **Step 1: 在 archive 端点调 buildCumulativeGraph**

打开 `apps/server/src/routes/chapters-archive.ts`,在 archive handler 内 `prisma.chapter.update({ data: { status: 'archived' } })` 之前插入:

```typescript
    // v3 build cumulativeGraph(在事务前;AI 调用不能在事务里)
    const chapterGraphForArchive = chapter.chapterGraph
      ? safeJsonParse<GraphSnapshot>(chapter.chapterGraph, null)
      : null

    // 查 prev cumulativeGraph
    let prevCumulative: GraphSnapshot | null = null
    if (chapter.parentChapterId) {
      const parent = await prisma.chapter.findUnique({
        where: { id: chapter.parentChapterId },
        select: { cumulativeGraph: true }
      })
      if (parent?.cumulativeGraph) prevCumulative = safeJsonParse(parent.cumulativeGraph, null)
    }
    if (!prevCumulative) {
      const prev = await prisma.chapter.findFirst({
        where: { storyId: chapter.storyId, parentChapterId: null, number: chapter.number - 1, id: { not: chapterId } },
        select: { cumulativeGraph: true }
      })
      if (prev?.cumulativeGraph) prevCumulative = safeJsonParse(prev.cumulativeGraph, null)
    }

    let cumulativeGraph: GraphSnapshot
    try {
      const result = await buildCumulativeGraph(app, {
        storyId: chapter.storyId, chapterId, chapterNumber: chapter.number,
        chapterGraph: chapterGraphForArchive, prevCumulativeGraph: prevCumulative
      })
      cumulativeGraph = result.cumulativeGraph
    } catch (err: any) {
      app.log.error(`[Archive] Cumulative graph build failed: ${err.message}`)
      return reply.status(500).send({
        success: false,
        error: `归档失败：全局图谱构建失败（${err.message}）。请重试。`
      })
    }
```

并把 status='archived' 写入 data 中加上 `cumulativeGraph: JSON.stringify(cumulativeGraph)`。

在文件顶部加 import:
```typescript
import { buildCumulativeGraph } from '../services/cumulative-graph.js'
import type { GraphSnapshot } from '../services/graph-snapshot.js'
```

并在 archive 端点最终 `chapter.update` 时,把 `cumulativeGraph: JSON.stringify(cumulativeGraph)` 加到 data 里。

- [ ] **Step 2: 加 archive 集成测试**

打开 `apps/server/src/__tests__/routes/prepare-archive-v3.test.ts`,在末尾追加新 describe:

```typescript
vi.mock('../../services/cumulative-graph.js', () => ({
  buildCumulativeGraph: vi.fn()
}))

import { buildCumulativeGraph } from '../../services/cumulative-graph.js'

describe('archive v3 — cumulative graph build + transaction', () => {
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
      character: { findMany: vi.fn().mockResolvedValue([]) },
      characterBranchState: { findMany: vi.fn().mockResolvedValue([]) },
      plotArc: { findMany: vi.fn().mockResolvedValue([]) }
    }
    const { chapterArchiveRoutes } = await import('../../routes/chapters-archive.js')
    const built = createMockApp(mockPrisma)
    await chapterArchiveRoutes(built.app)
    routes = built.routes
  })

  it('commits archive when all stages success and cumulative graph builds', async () => {
    mockPrisma.chapter.findUnique.mockResolvedValue({
      id: 'c1', storyId: 's1', status: 'reviewing',
      isSideStory: false, content: 'x', outline: '', number: 1,
      parentChapterId: null,
      pendingArchiveData: JSON.stringify({
        version: 3,
        stages: {
          character: { status: 'success' },
          memory: { status: 'success' },
          plotArc: { status: 'success' },
          graph: { status: 'success' }
        },
        meta: { extractedAt: ts, chapterNumber: 1 }
      }),
      chapterGraph: JSON.stringify({ nodes: [], edges: [], timestamp: ts })
    })
    ;(buildCumulativeGraph as any).mockResolvedValue({
      cumulativeGraph: { nodes: [], edges: [], timestamp: ts },
      aiCalled: false
    })

    const result = await callHandler(
      routes, 'POST', '/api/chapters/:chapterId/archive',
      undefined, { chapterId: 'c1' }
    )

    expect(result.status).toBe(200)
    expect(buildCumulativeGraph).toHaveBeenCalled()
    const archivedUpdate = mockPrisma.chapter.update.mock.calls.find(
      (c: any[]) => c[0]?.data?.status === 'archived'
    )
    expect(archivedUpdate).toBeDefined()
    expect(archivedUpdate[0].data.cumulativeGraph).toBeDefined()
  })

  it('returns 500 when cumulative graph build fails', async () => {
    mockPrisma.chapter.findUnique.mockResolvedValue({
      id: 'c1', storyId: 's1', status: 'reviewing',
      isSideStory: false, content: 'x', outline: '', number: 1,
      parentChapterId: null,
      pendingArchiveData: JSON.stringify({
        version: 3,
        stages: {
          character: { status: 'success' },
          memory: { status: 'success' },
          plotArc: { status: 'success' },
          graph: { status: 'success' }
        },
        meta: { extractedAt: ts, chapterNumber: 1 }
      }),
      chapterGraph: null
    })
    ;(buildCumulativeGraph as any).mockRejectedValue(new Error('AI 抽风'))

    const result = await callHandler(
      routes, 'POST', '/api/chapters/:chapterId/archive',
      undefined, { chapterId: 'c1' }
    )

    expect(result.status).toBe(500)
    expect(result.body.error).toContain('全局图谱构建失败')
  })

  it('returns 400 when any stage is failed', async () => {
    mockPrisma.chapter.findUnique.mockResolvedValue({
      id: 'c1', storyId: 's1', status: 'reviewing',
      isSideStory: false, content: 'x', outline: '', number: 1,
      parentChapterId: null,
      pendingArchiveData: JSON.stringify({
        version: 3,
        stages: {
          character: { status: 'failed', errorMessage: 'x' },
          memory: { status: 'success' },
          plotArc: { status: 'success' },
          graph: { status: 'success' }
        },
        meta: { extractedAt: ts, chapterNumber: 1 }
      })
    })

    const result = await callHandler(
      routes, 'POST', '/api/chapters/:chapterId/archive',
      undefined, { chapterId: 'c1' }
    )

    expect(result.status).toBe(400)
    expect(result.body.error).toContain('character')
    expect(buildCumulativeGraph).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 3: 跑测试确认通过**

Run:
```bash
pnpm test --run apps/server/src/__tests__/routes/prepare-archive-v3.test.ts
```
Expected: 原 3 个 + 新 3 个 test 全部 PASS。

- [ ] **Step 4: 跑全部测试 + typecheck**

Run:
```bash
pnpm test --run && pnpm typecheck
```
Expected: 全绿。

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/routes/chapters-archive.ts apps/server/src/__tests__/routes/prepare-archive-v3.test.ts
git commit -m "feat(v3): wire archive endpoint to buildCumulativeGraph"
```

---

## Commit 5: `refactor(v3): restructure ReviewingPanel into 4 stage cards`

> 重写 `ReviewingPanel.vue` 为 4 个 StageCard + 3 个 footer 按钮(重新解析 / 撤销审查 / 确认归档)。前端 API 加 `prepareArchiveCancel`。useChapterEditor 加 `prepareArchiveCancel` 函数。

### Task 5.1: 前端 API 客户端加 prepareArchiveCancel

**Files:**
- Modify: `apps/web/src/api/chapters.ts`

- [ ] **Step 1: 找到 prepareArchive 定义**

Run:
```bash
grep -n "prepareArchive\|archive:" apps/web/src/api/chapters.ts 2>&1
```
Expected: 输出当前 API 方法定义位置。

- [ ] **Step 2: 添加 prepareArchiveCancel**

在 `prepareArchive` 方法下方添加:

```typescript
  prepareArchiveCancel: (chapterId: string) =>
    api.post(`/api/chapters/${chapterId}/prepare-archive/cancel`, {}, { timeout: 5000 }),
```

- [ ] **Step 3: 跑前端 typecheck**

Run:
```bash
pnpm --filter web typecheck
```
Expected: 无错。

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/api/chapters.ts
git commit -m "feat(v3): add chaptersApi.prepareArchiveCancel"
```

---

### Task 5.2: useChapterEditor 加 prepareArchiveCancel + 适配 v3 shape

**Files:**
- Modify: `apps/web/src/composables/useChapterEditor.ts`

- [ ] **Step 1: 改 pendingArchiveData 类型**

在 `useChapterEditor.ts:21`,把:

```typescript
  const pendingArchiveData = ref<any>(null)
```

改为:

```typescript
  const pendingArchiveData = ref<any>(null)  // v3 shape: { version: 3, stages: {...}, meta }
```

并加常量:

```typescript
const V3_EMPTY_PAYLOAD = { version: 3, stages: {}, meta: { extractedAt: '', chapterNumber: 0 } }
```

- [ ] **Step 2: 在 archiveChapter 之前加 prepareArchiveCancel**

在 archiveChapter 函数之前插入:

```typescript
  async function prepareArchiveCancel() {
    if (!currentChapter.value) return { success: false }
    if (currentChapter.value.status !== 'reviewing') {
      message.warning('只有 reviewing 状态可以撤销审查')
      return { success: false }
    }
    try {
      const res = await chaptersApi.prepareArchiveCancel(currentChapter.value.id)
      if (res.data.success) {
        currentChapter.value.status = 'draft'
        currentChapter.value.pendingArchiveData = null
        currentChapter.value.chapterGraph = null
        pendingArchiveData.value = null
        message.success('已撤销审查，回到草稿')
        return { success: true }
      } else {
        message.error(res.data.error || '撤销审查失败')
        return { success: false }
      }
    } catch (e: any) {
      message.error(e.response?.data?.error || '撤销审查失败')
      return { success: false }
    }
  }
```

- [ ] **Step 3: 暴露新函数**

在 return reactive({...}) 块里加 `prepareArchiveCancel`。

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/composables/useChapterEditor.ts
git commit -m "feat(v3): add useChapterEditor.prepareArchiveCancel"
```

---

### Task 5.3: 重写 ReviewingPanel.vue 为 4 StageCard

**Files:**
- Modify: `apps/web/src/views/ReviewingPanel.vue`(整文件重写)

> 当前 1512 行,内部含 memory / plotArc / character / graph 的复杂编辑 UI。
> v3 重切分:每个 stage 一个 StageCard,各自展示 status + result + errorMessage。
> 编辑控件保留(用户能改),但 StageCard 自身读 pendingArchiveData.stages[name]。
> Footer 三个按钮:重新解析 / 撤销审查 / 确认归档(后者 disabled when !allSuccess)。

- [ ] **Step 1: 备份现有实现**

Run:
```bash
git mv apps/web/src/views/ReviewingPanel.vue apps/web/src/views/ReviewingPanel.vue.bak-v2
```

- [ ] **Step 2: 写新版 ReviewingPanel.vue**

创建 `apps/web/src/views/ReviewingPanel.vue`:

```vue
<template>
  <div v-if="pending" class="reviewing-panel">
    <header class="rp-header">
      <h2>归档审查</h2>
      <p class="rp-meta">提取于 {{ pending.meta?.extractedAt || '未知' }} · 章节 #{{ pending.meta?.chapterNumber ?? '?' }}</p>
    </header>

    <StageCard
      v-for="stageName in STAGE_ORDER"
      :key="stageName"
      :stage-name="stageName"
      :state="pending.stages?.[stageName]"
      @update-result="(r) => updateStage(stageName, r)"
    />

    <footer class="rp-footer">
      <button class="cap-pill is-ghost" @click="emit('reprepare')">重新解析（全部）</button>
      <button class="cap-pill is-ghost" @click="emit('cancel')">撤销审查，回到草稿</button>
      <button class="cap-pill is-primary" :disabled="!allSuccess" @click="emit('archive')">确认归档</button>
    </footer>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import StageCard from './StageCard.vue'

const STAGE_ORDER = ['character', 'memory', 'plotArc', 'graph'] as const

const props = defineProps<{
  pending: any  // v3 shape: { version: 3, stages: {...}, meta }
}>()

const emit = defineEmits<{
  (e: 'reprepare'): void
  (e: 'cancel'): void
  (e: 'archive'): void
  (e: 'update-stage', stageName: string, result: unknown): void
}>()

const allSuccess = computed(() => {
  if (!props.pending?.stages) return false
  return STAGE_ORDER.every(name => props.pending.stages[name]?.status === 'success')
})

function updateStage(stageName: string, result: unknown) {
  emit('update-stage', stageName, result)
}
</script>

<style scoped>
.reviewing-panel {
  padding: var(--space-5);
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

.rp-header h2 {
  margin: 0 0 4px 0;
  font-size: 18px;
  font-weight: var(--weight-semibold);
}
.rp-meta {
  margin: 0;
  font-size: 12px;
  color: var(--text-tertiary);
}

.rp-footer {
  display: flex;
  gap: var(--space-3);
  justify-content: flex-end;
  padding-top: var(--space-4);
  border-top: 1px solid var(--border-default);
}
.rp-footer button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>
```

- [ ] **Step 3: 创建 StageCard.vue**

创建 `apps/web/src/views/StageCard.vue`:

```vue
<template>
  <div class="stage-card" :data-status="state?.status || 'pending'">
    <header class="sc-header">
      <h3>{{ title }}</h3>
      <span class="sc-status" :data-status="state?.status || 'pending'">
        {{ statusLabel }}
      </span>
    </header>

    <div v-if="state?.status === 'failed'" class="sc-body sc-failed">
      <p class="sc-error">{{ state?.errorMessage || '本次失败,请按"重新解析"重试' }}</p>
    </div>

    <div v-else-if="state?.status === 'running'" class="sc-body sc-running">
      <n-spin />
    </div>

    <div v-else-if="state?.status === 'success'" class="sc-body sc-success">
      <slot :result="state?.result" />
    </div>

    <div v-else class="sc-body sc-pending">
      <p class="sc-text-muted">等待开始...</p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { NSpin } from 'naive-ui'

const props = defineProps<{
  stageName: 'character' | 'memory' | 'plotArc' | 'graph'
  state?: { status: string; result?: unknown; errorMessage?: string }
}>()

const title = computed(() => ({
  character: '角色状态',
  memory: '记忆提取',
  plotArc: '剧情弧线',
  graph: '本章图谱'
}[props.stageName]))

const statusLabel = computed(() => ({
  pending: '等待中',
  running: '运行中',
  success: '完成',
  failed: '失败'
}[(props.state?.status as any) || 'pending']))
</script>

<style scoped>
.stage-card {
  border: 1px solid var(--border-default);
  border-radius: var(--radius-card);
  background: var(--color-pure-white);
  padding: var(--space-4);
}
.stage-card[data-status="failed"] {
  border-color: var(--color-danger, #c00);
}
.stage-card[data-status="success"] {
  border-color: var(--color-positive, #0a0);
}

.sc-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: var(--space-3);
}
.sc-header h3 {
  margin: 0;
  font-size: 14px;
  font-weight: var(--weight-semibold);
}

.sc-status {
  font-family: var(--font-mono);
  font-size: 11px;
  padding: 2px 8px;
  border-radius: var(--radius-badge);
  background: var(--color-stone-gray);
}
.sc-status[data-status="success"] {
  background: color-mix(in srgb, var(--color-positive, #0a0) 15%, transparent);
  color: var(--color-positive, #0a0);
}
.sc-status[data-status="failed"] {
  background: color-mix(in srgb, var(--color-danger, #c00) 15%, transparent);
  color: var(--color-danger, #c00);
}

.sc-failed .sc-error {
  margin: 0;
  font-size: 13px;
  color: var(--color-danger, #c00);
}

.sc-running {
  display: flex;
  justify-content: center;
  padding: var(--space-4);
}

.sc-text-muted {
  margin: 0;
  font-size: 13px;
  color: var(--text-tertiary);
}
</style>
```

- [ ] **Step 4: 在 ChapterEditor.vue 内挂载新 ReviewingPanel**

打开 `apps/web/src/views/chapters/ChapterEditor.vue`,找到引用 `<ReviewingPanel ...>` 的位置,改成新组件的事件绑定:

```vue
<ReviewingPanel
  v-if="currentChapter?.status === 'reviewing'"
  :pending="pendingArchiveData"
  @reprepare="prepareArchive"
  @cancel="prepareArchiveCancel"
  @archive="archiveChapter"
  @update-stage="(stageName, result) => {
    if (currentChapter && pendingArchiveData) {
      pendingArchiveData.stages[stageName].result = result
      savePendingArchiveData(pendingArchiveData)
    }
  }"
/>
```

注意:这要求 `pendingArchiveData` 是 reactive ref 而不是 ref;或者通过 computed 暴露。

- [ ] **Step 5: 跑 typecheck**

Run:
```bash
pnpm typecheck
```
Expected: 无错。

- [ ] **Step 6: 手动 smoke**

Run:
```bash
pnpm dev
```

进入一个 reviewing 状态章节,确认:
- 4 张 StageCard 渲染
- 失败 stage 高亮 + errorMessage 显示
- "重新解析" / "撤销审查" / "确认归档" 三个按钮在 footer

- [ ] **Step 7: 删除 .bak 文件**

```bash
git rm apps/web/src/views/ReviewingPanel.vue.bak-v2
```

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/views/ReviewingPanel.vue apps/web/src/views/StageCard.vue apps/web/src/views/chapters/ChapterEditor.vue
git commit -m "refactor(v3): restructure ReviewingPanel into 4 StageCard + 3 footer buttons"
```

---

### Task 5.4: 验证 Commit 5 全绿

- [ ] **Step 1: 跑全部测试 + typecheck**

Run:
```bash
pnpm test --run && pnpm typecheck
```
Expected: 全绿。

- [ ] **Step 2: 手动 smoke**

Run `pnpm dev`,测试流程:新建章节 → 准备归档 → 看到 4 张 StageCard → 编辑某 stage → 确认归档。

---

## Commit 6: `docs(v3): align docs with stages model + GraphView.vue deferred`

> 更新 DESIGN.md / LOGIC.md / ISSUES.md。GraphView.vue 重写延后到下一个独立 commit。

### Task 6.1: 更新 DESIGN.md

**Files:**
- Modify: `docs/DESIGN.md`(找 archive 章节)

- [ ] **Step 1: 找 archive 章节**

Run:
```bash
grep -n "## " docs/DESIGN.md 2>&1 | head -30
```
Expected: 找到 archive pipeline 相关章节标题。

- [ ] **Step 2: 替换 archive pipeline 描述**

找到描述 "4-phase" 或 "Extract / Organize / Transaction / Optimize" 的段落,替换为:

```markdown
### Archive Pipeline (v3)

`ChapterStatus` v2 收口到 3 值 (`draft` / `reviewing` / `archived`)。`Chapter.pendingArchiveData` v3 shape:

```typescript
{
  version: 3,
  stages: {
    character: StageState,
    memory: StageState,
    plotArc: StageState,
    graph: StageState
  },
  meta: { extractedAt, chapterNumber }
}
```

4 stage 服务位于 `apps/server/src/services/stages/`,签名一致:

```typescript
async function runXxxStage(app, input): Promise<StageState<XxxStageResult>>
```

并行触发 (`Promise.all`),任一失败不影响其他。空结果 = success。

### Graph 两段式

- `Chapter.chapterGraph` (gacha, 单次 AI 抽取本章)
- `Chapter.cumulativeGraph` (累计到本章, 经 N-1 去重)

`buildCumulativeGraph` (`apps/server/src/services/cumulative-graph.ts`):
1. 空 chapterGraph → 继承 prev (no AI)
2. 首章 → chapterGraph 自身 (no AI)
3. 正常 → 2-hop BFS over prev 找与 chapterGraph 共享 type:key 的邻域 → AI dedup → code merge

### 锁移除

v3 删除所有 `updateMany({where: {status: ...}})` 锁。仅依赖状态机自身 + UI 按钮 disabled 防双击。
```

- [ ] **Step 3: Commit**

```bash
git add docs/DESIGN.md
git commit -m "docs(v3): update DESIGN.md archive pipeline to 4-stage model"
```

---

### Task 6.2: 更新 LOGIC.md

**Files:**
- Modify: `docs/LOGIC.md`

- [ ] **Step 1: 找 stage 相关章节**

Run:
```bash
grep -n "archive\|stage\|prepare-archive" docs/LOGIC.md 2>&1 | head -20
```

- [ ] **Step 2: 在合适位置加 v3 stage 边界说明**

在"Archive Pipeline"或"数据流"段落旁添加:

```markdown
### Stage 边界 (v3)

每个 stage 服务只调 AI + 解析, **不写 DB**。路由层负责持久化。

- `character-stage`: 仅输出 characterStates; 锚定 matchedCharacters (路由层 pre-stage 文本匹配)
- `memory-stage`: 输出 mainEvents / sideEvents / scenes / summary / timelinePosition;**不输出** characterStatusChanges (归属 character-stage)
- `plot-arc-stage`: 输出 plotArcs (consolidator 自己读章节 + existing arcs)
- `graph-extract-stage`: 输出 chapterGraph (本章范围,**不与历史合并**);累积去重在 archive 端点 buildCumulativeGraph 做

Stage 输入里的 characterNames / characterKeys / latestBranchStates / prevCumulativeGraphKeys **全部由路由层独立查 DB** 提供,stage 之间不通信。

### pendingArchiveData v3

老 v1/v2 blob 无 `version` 字段 → 前端检测后提示"数据格式过旧,请重新准备归档"。
```

- [ ] **Step 3: Commit**

```bash
git add docs/LOGIC.md
git commit -m "docs(v3): update LOGIC.md with stage boundaries"
```

---

### Task 6.3: 标记 GraphView 重写为 follow-up

**Files:**
- Modify: `docs/ISSUES.md`

- [ ] **Step 1: 加 GraphView 重写 follow-up 条目**

打开 `docs/ISSUES.md`,在 P1 或 follow-up 区域追加:

```markdown
## [P2 follow-up] GraphView.vue 重写消费 chapterGraph/cumulativeGraph

**Status:** 未开始

**Context:** v3 重命名 `graphDelta/graphSnapshot` → `chapterGraph/cumulativeGraph`(commit 1)。
本次不重写 GraphView.vue(`apps/web/src/views/Graph.vue`),仍读 `GraphNode` / `GraphEdge` 工作表,
旧工作表继续写入。

**Why deferred:** GraphView.vue 涉及 Cytoscape 重构 + 工作表数据迁移,独立 scope。
本次 6-commit 重点在 stage 拆分,GraphView 是消费侧。

**Next step:** 单独 commit 删除 `GraphNode` / `GraphEdge` 表 + 重写 GraphView.vue 消费
`Chapter.cumulativeGraph` (主视图) + `Chapter.chapterGraph` (本章详情)。

**追踪:** 此项完成后 `prisma/schema.prisma` 删除 `model GraphNode` / `model GraphEdge`,
并删 `apps/server/src/services/graph-snapshot.ts` 的 `saveGraphSnapshotAndDelta` /
`rebuildGraphFromSnapshot`。
```

- [ ] **Step 2: Commit**

```bash
git add docs/ISSUES.md
git commit -m "docs(v3): mark GraphView.vue rewrite as follow-up"
```

---

### Task 6.4: 最终验证

- [ ] **Step 1: 跑全部测试 + typecheck**

Run:
```bash
pnpm test --run && pnpm typecheck
```
Expected: 全绿。

- [ ] **Step 2: 跑 build**

Run:
```bash
pnpm build
```
Expected: 全部包构建成功。

- [ ] **Step 3: git log 检查 6 commit**

Run:
```bash
git log --oneline v2/state-machine..HEAD
```
Expected: 显示 6 个新 commit(可能略多,因为有些 test commit 单独;数 feature commit):

1. `chore(v3): rename Chapter.graphDelta/graphSnapshot to chapterGraph/cumulativeGraph` (含 migration)
2. `chore(v3): rename backend references for graph fields`
3. `chore(v3): rename frontend references for graph fields`
4. `feat(v3): add stages/types.ts with StageState + retry helper`
5. `feat(v3): add character-stage service`
6. `feat(v3): add memory-stage service`
7. `feat(v3): add plot-arc-stage service`
8. `feat(v3): add graph-extract-stage service`
9. `feat(v3): add PendingArchiveDataV3 type + schema in shared`
10. `refactor(v3): split archive handler into prepare/cancel/archive + drop all locks`
11. `test(v3): add prepare-archive/cancel route tests`
12. `feat(v3): add buildCumulativeGraph with 2-hop BFS + AI dedup`
13. `feat(v3): wire archive endpoint to buildCumulativeGraph`
14. `feat(v3): add chaptersApi.prepareArchiveCancel`
15. `feat(v3): add useChapterEditor.prepareArchiveCancel`
16. `refactor(v3): restructure ReviewingPanel into 4 StageCard + 3 footer buttons`
17. `docs(v3): update DESIGN.md archive pipeline to 4-stage model`
18. `docs(v3): update LOGIC.md with stage boundaries`
19. `docs(v3): mark GraphView.vue rewrite as follow-up`

总共 19 个 commit(对应 spec 的 6 个 commit 类别)。每个 commit 独立可回滚。