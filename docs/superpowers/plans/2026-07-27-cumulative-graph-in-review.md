# 累计图谱引入审查工作台 · 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 `Chapter.cumulativeGraph` 从"归档时 derived"升级为"用户在 ReviewingPanel 主动生成、独立编辑、首次自动入库、之后手动保存的草稿",并加固归档前的强校验。

**Architecture:**
- 后端:新增 `Chapter.cumulativeGraphGeneratedAt DateTime?` 列;新增 3 个端点 `GET` / `POST /build` / `PATCH` 维护累计图谱草稿;`/archive` 改为强校验 `generatedAt != null` 后直接消费。
- 前端:ReviewingPanel 同一图谱 tab 内分两段平铺(本章图谱 + 累计图谱);累计图谱走独立 `getCumulativeGraph / buildCumulativeGraph / saveCumulativeGraph` API;确认归档按钮 loading 由父级 `archiveRunning` 管理。
- 数据流:累计图谱不进 `pendingArchiveData.stages.graph.result`,完全独立持久化。

**Tech Stack:** Fastify + Prisma + Vitest (backend), Vue 3 + Naive UI + Pinia (frontend), pnpm monorepo.

**Source spec:** `docs/superpowers/specs/2026-07-27-cumulative-graph-in-review-design.md`

---

## Task 1: Schema 改动 — 新增 cumulativeGraphGeneratedAt 列

**Files:**
- Modify: `prisma/schema.prisma:74-77` (Chapter 模型图谱相关字段块)
- Create: `prisma/migrations/<timestamp>_chapter_cumulative_graph_generated_at/migration.sql` (prisma migrate dev 自动生成)

- [ ] **Step 1: 打开 schema 在 Chapter 模型的图谱相关字段下方加新列**

Edit `prisma/schema.prisma`,在第 76 行 `cumulativeGraph String?` 之后插入一行:

```prisma
  cumulativeGraph             String?
  cumulativeGraphGeneratedAt  DateTime? // 用户首次主动生成累计图谱的时间; null = 未生成
```

确认字段顺序与现有 `chapterGraph / cumulativeGraph / pendingArchiveData` 风格一致(空格对齐)。

- [ ] **Step 2: 应用 migration**

Run:
```bash
pnpm db:migrate --name add_cumulative_graph_generated_at
```

Expected: 创建一个新的 `prisma/migrations/<timestamp>_chapter_cumulative_graph_generated_at/migration.sql`,SQL 内容为 `ALTER TABLE "Chapter" ADD COLUMN "cumulativeGraphGeneratedAt" DATETIME;`。

- [ ] **Step 3: 生成 Prisma Client**

Run:
```bash
pnpm db:generate
```

Expected: `node_modules/.prisma/client/index.d.ts` 中 Chapter 类型包含 `cumulativeGraphGeneratedAt: Date | null`。

- [ ] **Step 4: typecheck 全量通过**

Run:
```bash
pnpm typecheck
```

Expected: exit code 0。

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/
git commit -m "feat(v3): add Chapter.cumulativeGraphGeneratedAt for user-maintained cumulative graph"
```

---

## Task 2: 引入测试脚手架 (Vitest 已就绪,新建 test 文件)

**Files:**
- Create: `apps/server/test/routes/cumulative-graph.test.ts` (本任务只放最小骨架,后续 Task 补用例)

> CLAUDE.md 要求"新代码落 TDD 之前需先在 apps/server 补最小测试脚手架(Vitest 已就绪)"。`apps/server/vitest.config.ts` 已存在;`apps/server/test/` 目录不存在,新建之。

- [ ] **Step 1: 新建 test 目录与最小可运行测试**

Create `apps/server/test/smoke.test.ts`:

```ts
import { describe, it, expect } from 'vitest'

describe('test scaffold', () => {
  it('runs', () => {
    expect(1 + 1).toBe(2)
  })
})
```

- [ ] **Step 2: 跑测试确认骨架正常**

Run:
```bash
pnpm --filter server test
```

Expected: 1 test passed。

> 由于本任务之后的所有 endpoint 测试都需要 mock prisma + Fastify instance,这一阶段的测试代码会让后续 Task 的 `import` path 自然落地 (`test/routes/cumulative-graph.test.ts`)。

- [ ] **Step 3: Commit**

```bash
git add apps/server/test/
git commit -m "test(server): scaffold vitest test dir with smoke test"
```

---

## Task 3: 后端 GET /api/chapters/:chapterId/cumulative-graph 端点 (TDD)

**Files:**
- Modify: `apps/server/src/routes/chapters-archive.ts` (新增 GET 路由,放在 `/archive` 之前)
- Test: `apps/server/test/routes/cumulative-graph.test.ts`

> helper 模式见 `apps/server/src/routes/_helpers.js` 现有 `getOrThrowChapter`。

- [ ] **Step 1: 写失败用例 — 未生成**

Create `apps/server/test/routes/cumulative-graph.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest'

const findUniqueMock = vi.fn()
const findFirstMock = vi.fn()
const updateMock = vi.fn()

vi.mock('../../src/utils/prisma.js', () => ({
  prisma: {
    chapter: {
      findUnique: (...args: any[]) => findUniqueMock(...args),
      findFirst: (...args: any[]) => findFirstMock(...args),
      update: (...args: any[]) => updateMock(...args),
    },
  },
}))

// 必须在 mock 之后再 import
const { chapterArchiveRoutes } = await import('../../src/routes/chapters-archive.js')

function makeFastifyStub() {
  const routes: Record<string, any> = {}
  return {
    routes,
    async inject(method: string, url: string) {
      const handler = routes[url]
      if (!handler) return { status: 404, body: { success: false, error: 'not found' } }
      const reply = {
        status: (code: number) => ({ send: (b: any) => ({ status: code, body: b }) }),
        send: (b: any) => ({ status: 200, body: b }),
      }
      return await handler({ params: { chapterId: 'ch-1' }, log: { error: () => {} } }, reply)
    },
  } as any
}

describe('GET /api/chapters/:chapterId/cumulative-graph', () => {
  beforeEach(() => {
    findUniqueMock.mockReset()
    findFirstMock.mockReset()
    updateMock.mockReset()
  })

  it('returns generatedAt=null and graph=null when not yet generated', async () => {
    findUniqueMock.mockResolvedValueOnce({
      id: 'ch-1', cumulativeGraph: null, cumulativeGraphGeneratedAt: null,
      status: 'reviewing', isSideStory: false, content: 'x', parentChapterId: null, number: 1, storyId: 's1',
    })
    const app = makeFastifyStub()
    chapterArchiveRoutes(app)
    const res = await app.inject('GET', '/api/chapters/ch-1/cumulative-graph')
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ success: true, data: { generatedAt: null, graph: null } })
  })
})
```

- [ ] **Step 2: 跑测试,确认 fail**

Run:
```bash
pnpm --filter server test
```

Expected: FAIL with "no test files matched" 或 "cannot find handler"。

- [ ] **Step 3: 实现 GET 路由**

打开 `apps/server/src/routes/chapters-archive.ts`,在 `/archive` 路由(行 362)之前插入:

```ts
  // GET /api/chapters/:chapterId/cumulative-graph
  // 拉取累计图谱草稿 + generatedAt; 未生成时返回 { generatedAt: null, graph: null }
  app.get('/api/chapters/:chapterId/cumulative-graph', async (request, reply) => {
    const { chapterId } = request.params as any
    const prisma = app.prisma
    const chapter = await getOrThrowChapter(prisma, chapterId, reply)
    if (chapter === null) return

    const generatedAt = chapter.cumulativeGraphGeneratedAt
      ? chapter.cumulativeGraphGeneratedAt.toISOString()
      : null
    const graph = chapter.cumulativeGraph
      ? safeJsonParse<GraphSnapshot | null>(chapter.cumulativeGraph, null)
      : null

    return { success: true, data: { generatedAt, graph } }
  })
```

- [ ] **Step 4: 跑测试通过**

Run:
```bash
pnpm --filter server test
```

Expected: PASS。

- [ ] **Step 5: 加第二个用例 — 已生成**

在 `cumulative-graph.test.ts` 末尾 append:

```ts
  it('returns existing graph and generatedAt', async () => {
    const isoNow = '2026-07-27T10:00:00.000Z'
    const storedGraph = {
      nodes: [{ type: 'character', key: 'linfan', label: '林凡', data: {} }],
      edges: [],
      timestamp: isoNow,
    }
    findUniqueMock.mockResolvedValueOnce({
      id: 'ch-1',
      cumulativeGraph: JSON.stringify(storedGraph),
      cumulativeGraphGeneratedAt: new Date(isoNow),
      status: 'reviewing', isSideStory: false, content: 'x', parentChapterId: null, number: 1, storyId: 's1',
    })
    const app = makeFastifyStub()
    chapterArchiveRoutes(app)
    const res = await app.inject('GET', '/api/chapters/ch-1/cumulative-graph')
    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
    expect(res.body.data.generatedAt).toBe(isoNow)
    expect(res.body.data.graph.nodes).toEqual(storedGraph.nodes)
  })
```

- [ ] **Step 6: 跑测试**

Run:
```bash
pnpm --filter server test
```

Expected: 2 PASS。

- [ ] **Step 7: typecheck + Commit**

Run:
```bash
pnpm typecheck
```
Expected: exit 0。

```bash
git add apps/server/src/routes/chapters-archive.ts apps/server/test/routes/cumulative-graph.test.ts
git commit -m "feat(server): GET cumulative-graph endpoint with not-generated/generated cases"
```

---

## Task 4: 后端 POST /api/chapters/:chapterId/cumulative-graph/build 端点 (TDD)

**Files:**
- Modify: `apps/server/src/routes/chapters-archive.ts`
- Create: `apps/server/src/services/stages/cumulative-graph-build-service.ts` (新服务函数)
- Test: `apps/server/test/routes/cumulative-graph.test.ts` (追加)

> 该端点调用现有 `buildCumulativeGraph` service(在 `apps/server/src/services/cumulative-graph.ts`),不动 service 本身。包装层加权限 + 写库。

- [ ] **Step 1: 写失败用例 — 写入两列**

Append 到 `cumulative-graph.test.ts`:

```ts
import { buildCumulativeGraph } from '../../src/services/cumulative-graph.js'

vi.mock('../../src/services/cumulative-graph.js', () => ({
  buildCumulativeGraph: vi.fn(),
}))

describe('POST /api/chapters/:chapterId/cumulative-graph/build', () => {
  beforeEach(() => {
    findUniqueMock.mockReset()
    findFirstMock.mockReset()
    updateMock.mockReset()
    ;(buildCumulativeGraph as any).mockReset()
  })

  it('writes both cumulativeGraph and cumulativeGraphGeneratedAt', async () => {
    const generatedGraph = {
      nodes: [{ type: 'character', key: 'a', label: 'A', data: {} }],
      edges: [],
      timestamp: '2026-07-27T10:00:00.000Z',
    }
    ;(buildCumulativeGraph as any).mockResolvedValueOnce({
      cumulativeGraph: generatedGraph, aiCalled: true,
    })
    findUniqueMock.mockResolvedValueOnce({
      id: 'ch-1', storyId: 's1', number: 1, status: 'reviewing',
      cumulativeGraph: null, cumulativeGraphGeneratedAt: null,
      parentChapterId: null, isSideStory: false, content: 'x',
    })
    const app = makeFastifyStub()
    ;(app as any).prisma = {
      chapter: {
        findUnique: findUniqueMock, findFirst: findFirstMock, update: updateMock,
      },
    }
    chapterArchiveRoutes(app)
    const reply = { status: (c: number) => ({ send: (b: any) => ({ status: c, body: b }) }), send: (b: any) => ({ status: 200, body: b }) }
    await app.routes['/api/chapters/:chapterId/cumulative-graph/build'](
      {
        params: { chapterId: 'ch-1' },
        body: { chapterGraph: { nodes: [{ type: 'character', key: 'a' }], edges: [] } },
        log: { error: () => {} },
      } as any,
      reply as any,
    )
    expect(updateMock).toHaveBeenCalledWith({
      where: { id: 'ch-1' },
      data: expect.objectContaining({
        cumulativeGraph: JSON.stringify(generatedGraph),
        cumulativeGraphGeneratedAt: expect.any(Date),
      }),
    })
  })
})
```

- [ ] **Step 2: 跑测试 — fail**

Run: `pnpm --filter server test`. Expected: FAIL with "not yet implemented"。

- [ ] **Step 3: 在 service 文件加 buildAndSave 函数 (虽然本质是路由内置)**

Create `apps/server/src/services/stages/cumulative-graph-build-service.ts`:

```ts
import type { FastifyInstance } from 'fastify'
import { buildCumulativeGraph } from '../cumulative-graph.js'
import type { GraphSnapshot } from '../graph-snapshot.js'

export interface BuildAndSaveInput {
  storyId: string
  chapterId: string
  chapterNumber: number
  chapterGraph: GraphSnapshot
  prevCumulativeGraph: GraphSnapshot | null
}

export interface BuildAndSaveResult {
  graph: GraphSnapshot
  generatedAt: string
  aiCalled: boolean
}

/**
 * 包装 buildCumulativeGraph: 调 AI dedup, 把结果 + generatedAt 返回给路由层落库。
 * 不在这里写 prisma.update,以便路由层控制 transaction 边界。
 */
export async function buildAndSaveCumulativeGraph(
  app: FastifyInstance,
  input: BuildAndSaveInput,
): Promise<BuildAndSaveResult> {
  const result = await buildCumulativeGraph(app, {
    storyId: input.storyId,
    chapterId: input.chapterId,
    chapterNumber: input.chapterNumber,
    chapterGraph: input.chapterGraph,
    prevCumulativeGraph: input.prevCumulativeGraph,
  })
  return {
    graph: result.cumulativeGraph,
    generatedAt: new Date().toISOString(),
    aiCalled: result.aiCalled,
  }
}
```

- [ ] **Step 4: 在 routes 顶层加 import, 在 GET 之后 /archive 之前加 POST /build 路由**

Edit `apps/server/src/routes/chapters-archive.ts`:

```ts
import { buildAndSaveCumulativeGraph } from '../services/stages/cumulative-graph-build-service.js'
```

在 GET 路由之后插入:

```ts
  // POST /api/chapters/:chapterId/cumulative-graph/build
  // 入参: { chapterGraph: GraphSnapshot }
  // 调 buildCumulativeGraph, 写 Chapter.cumulativeGraph + cumulativeGraphGeneratedAt。
  // 章节图谱的来源由前端 body 携带, 后端不回查 pendingArchiveData。
  app.post('/api/chapters/:chapterId/cumulative-graph/build', async (request, reply) => {
    const { chapterId } = request.params as any
    const body = request.body as { chapterGraph?: GraphSnapshot } | undefined
    if (!body?.chapterGraph || !Array.isArray(body.chapterGraph.nodes) || !Array.isArray(body.chapterGraph.edges)) {
      return reply.status(400).send({ success: false, error: '缺少 chapterGraph 字段' })
    }

    const prisma = app.prisma
    const chapter = await getOrThrowChapter(prisma, chapterId, reply)
    if (chapter === null) return

    if (chapter.status !== 'draft' && chapter.status !== 'reviewing') {
      return reply.status(400).send({
        success: false,
        error: `章节当前状态为 ${chapter.status},不允许生成累计图谱`,
      })
    }

    // 查 prev cumulativeGraph (parent 优先, 主线回退)
    let prevCumulative: GraphSnapshot | null = null
    if (chapter.parentChapterId) {
      const parent = await prisma.chapter.findUnique({
        where: { id: chapter.parentChapterId },
        select: { cumulativeGraph: true },
      })
      if (parent?.cumulativeGraph) prevCumulative = safeJsonParse<GraphSnapshot | null>(parent.cumulativeGraph, null)
    }
    if (!prevCumulative) {
      const prev = await prisma.chapter.findFirst({
        where: {
          storyId: chapter.storyId, parentChapterId: null,
          number: chapter.number - 1, id: { not: chapterId },
        },
        select: { cumulativeGraph: true },
      })
      if (prev?.cumulativeGraph) prevCumulative = safeJsonParse<GraphSnapshot | null>(prev.cumulativeGraph, null)
    }

    let result: BuildAndSaveResult
    try {
      result = await buildAndSaveCumulativeGraph(app, {
        storyId: chapter.storyId, chapterId, chapterNumber: chapter.number,
        chapterGraph: body.chapterGraph,
        prevCumulativeGraph: prevCumulative,
      })
    } catch (err: any) {
      app.log.error(`[CumulativeGraphBuild] ${err.message}`)
      return reply.status(500).send({ success: false, error: `累计图谱生成失败: ${err.message}` })
    }

    await prisma.chapter.update({
      where: { id: chapterId },
      data: {
        cumulativeGraph: JSON.stringify(result.graph),
        cumulativeGraphGeneratedAt: new Date(result.generatedAt),
      },
    })

    return { success: true, data: { graph: result.graph, generatedAt: result.generatedAt, aiCalled: result.aiCalled } }
  })
```

并在 `import` 块加 `BuildAndSaveResult` 类型:

```ts
import type { BuildAndSaveResult } from '../services/stages/cumulative-graph-build-service.js'
```

- [ ] **Step 5: 跑测试通过**

Run: `pnpm --filter server test`. Expected: PASS。

- [ ] **Step 6: typecheck + Commit**

```bash
pnpm typecheck
git add apps/server/src/routes/chapters-archive.ts apps/server/src/services/stages/cumulative-graph-build-service.ts apps/server/test/routes/cumulative-graph.test.ts
git commit -m "feat(server): POST cumulative-graph/build endpoint with buildAndSave service"
```

---

## Task 5: 后端 PATCH /api/chapters/:chapterId/cumulative-graph 端点 (TDD)

**Files:**
- Modify: `apps/server/src/routes/chapters-archive.ts`
- Test: `apps/server/test/routes/cumulative-graph.test.ts`

- [ ] **Step 1: 写失败用例 — 未生成拒绝**

Append:

```ts
describe('PATCH /api/chapters/:chapterId/cumulative-graph', () => {
  beforeEach(() => {
    findUniqueMock.mockReset()
    findFirstMock.mockReset()
    updateMock.mockReset()
  })

  it('rejects when cumulativeGraphGeneratedAt is null', async () => {
    findUniqueMock.mockResolvedValueOnce({
      id: 'ch-1', status: 'reviewing',
      cumulativeGraph: null, cumulativeGraphGeneratedAt: null,
    })
    const app = makeFastifyStub()
    chapterArchiveRoutes(app)
    const reply = {
      status: (c: number) => ({ send: (b: any) => ({ status: c, body: b }) }),
      send: (b: any) => ({ status: 200, body: b }),
    }
    await app.routes['/api/chapters/:chapterId/cumulative-graph'](
      {
        method: 'PATCH',
        params: { chapterId: 'ch-1' },
        body: { graph: { nodes: [], edges: [] } },
        log: { error: () => {} },
      } as any,
      reply as any,
    )
    expect(updateMock).not.toHaveBeenCalled()
  })

  it('writes graph without touching generatedAt', async () => {
    const fixedDate = new Date('2026-07-27T08:00:00.000Z')
    findUniqueMock.mockResolvedValueOnce({
      id: 'ch-1', status: 'reviewing',
      cumulativeGraph: null, cumulativeGraphGeneratedAt: fixedDate,
    })
    updateMock.mockResolvedValueOnce({})
    const app = makeFastifyStub()
    chapterArchiveRoutes(app)
    const reply = {
      status: (c: number) => ({ send: (b: any) => ({ status: c, body: b }) }),
      send: (b: any) => ({ status: 200, body: b }),
    }
    await app.routes['/api/chapters/:chapterId/cumulative-graph'](
      {
        method: 'PATCH',
        params: { chapterId: 'ch-1' },
        body: {
          graph: {
            nodes: [{ type: 'character', key: 'linfan', label: '林凡', data: {} }],
            edges: [],
            timestamp: '2026-07-27T10:00:00.000Z',
          },
        },
        log: { error: () => {} },
      } as any,
      reply as any,
    )
    expect(updateMock).toHaveBeenCalledTimes(1)
    const [, callArgs] = updateMock.mock.calls[0]
    expect(callArgs.data).not.toHaveProperty('cumulativeGraphGeneratedAt')
    expect(JSON.parse(callArgs.data.cumulativeGraph).nodes).toEqual([
      { type: 'character', key: 'linfan', label: '林凡', data: {} },
    ])
  })
})
```

- [ ] **Step 2: 跑测试 — fail**

Run: `pnpm --filter server test`. Expected: FAIL。

- [ ] **Step 3: 实现 PATCH 路由**

在 `chapters-archive.ts` 的 POST `/build` 之后 / `/archive` 之前插入:

```ts
  // PATCH /api/chapters/:chapterId/cumulative-graph
  // 保存用户编辑后的累计图谱。要求 cumulativeGraphGeneratedAt != null。
  app.patch('/api/chapters/:chapterId/cumulative-graph', async (request, reply) => {
    const { chapterId } = request.params as any
    const body = request.body as { graph?: GraphSnapshot } | undefined
    if (!body?.graph || !Array.isArray(body.graph.nodes) || !Array.isArray(body.graph.edges)) {
      return reply.status(400).send({ success: false, error: '缺少 graph 字段' })
    }

    const prisma = app.prisma
    const chapter = await getOrThrowChapter(prisma, chapterId, reply)
    if (chapter === null) return

    if (chapter.cumulativeGraphGeneratedAt == null) {
      return reply.status(400).send({
        success: false,
        error: 'cumulative-graph-not-generated',
      })
    }

    await prisma.chapter.update({
      where: { id: chapterId },
      data: { cumulativeGraph: JSON.stringify(body.graph) },
    })

    return { success: true }
  })
```

- [ ] **Step 4: 跑测试 — pass**

Run: `pnpm --filter server test`. Expected: 全 PASS。

- [ ] **Step 5: typecheck + Commit**

```bash
pnpm typecheck
git add apps/server/src/routes/chapters-archive.ts apps/server/test/routes/cumulative-graph.test.ts
git commit -m "feat(server): PATCH cumulative-graph endpoint with generatedAt guard"
```

---

## Task 6: archive endpoint — 移除 buildCumulativeGraph + 加校验

**Files:**
- Modify: `apps/server/src/routes/chapters-archive.ts:407-453` (archive 端点)

- [ ] **Step 1: 改写 archive 端点的 cumulativeGraph 处理段**

在 `chapters-archive.ts` 行 408(`if (failedStages.length > 0) {...}`)之后,行 447 update 之前的整段:

```ts
    // v3 build cumulativeGraph(在事务前;AI 调用不能在事务里)
    const chapterGraphForArchive = chapter.chapterGraph
      ? safeJsonParse<GraphSnapshot | null>(chapter.chapterGraph, null)
      : null

    // 查 prev cumulativeGraph
    let prevCumulative: GraphSnapshot | null = null
    if (chapter.parentChapterId) {
      const parent = await prisma.chapter.findUnique({
        where: { id: chapter.parentChapterId },
        select: { cumulativeGraph: true }
      })
      if (parent?.cumulativeGraph) prevCumulative = safeJsonParse<GraphSnapshot | null>(parent.cumulativeGraph, null)
    }
    if (!prevCumulative) {
      const prev = await prisma.chapter.findFirst({
        where: { storyId: chapter.storyId, parentChapterId: null, number: chapter.number - 1, id: { not: chapterId } },
        select: { cumulativeGraph: true }
      })
      if (prev?.cumulativeGraph) prevCumulative = safeJsonParse<GraphSnapshot | null>(prev.cumulativeGraph, null)
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

整段替换为:

```ts
    // v3: 累计图谱不再由 archive 时 AI 构建, 改为消费用户在 ReviewingPanel 主动维护的草稿。
    // 校验: 用户必须先在审查阶段点过 "生成累计图谱", 否则归档被拦下。
    if (chapter.cumulativeGraphGeneratedAt == null || chapter.cumulativeGraph == null) {
      return reply.status(400).send({
        success: false,
        error: 'cumulative-graph-not-generated',
      })
    }
    // cumulativeGraph 字段在 phase 3 写时与已存值相同 (幂等), 此处不再单独 stringify。
```

同时,移除文件顶部的 `import { buildCumulativeGraph }` (现已不再使用)。

- [ ] **Step 2: typecheck + 跑测试**

```bash
pnpm typecheck
pnpm --filter server test
```

Expected: 全 PASS(existing 测试不曾覆盖 archive 端点的 buildCumulativeGraph 调用,移走之后不会断)。

- [ ] **Step 3: Commit**

```bash
git add apps/server/src/routes/chapters-archive.ts
git commit -m "refactor(v3): archive consumes user-maintained cumulativeGraph, no auto-build"
```

---

## Task 7: 前端 API 客户端 — 新增 cumulative-graph 三个方法

**Files:**
- Create: `apps/web/src/api/cumulative-graph.ts`
- Modify: `apps/web/src/api/chapters.ts` (可选:加转发别名)

- [ ] **Step 1: 新建 cumulative-graph.ts**

Create `apps/web/src/api/cumulative-graph.ts`:

```ts
import { api } from '../utils/api'

export interface GraphSnapshot {
  nodes: Array<{ type: string; key: string; label: string; data?: any; [k: string]: any }>
  edges: Array<{ fromType: string; fromKey: string; toType: string; toKey: string; relation: string; weight?: number; [k: string]: any }>
  timestamp?: string
}

export const cumulativeGraphApi = {
  get:   (chapterId: string) =>
           api.get(`/api/chapters/${chapterId}/cumulative-graph`),
  build: (chapterId: string, chapterGraph: GraphSnapshot) =>
           api.post(`/api/chapters/${chapterId}/cumulative-graph/build`, { chapterGraph }, { timeout: 0 }),
  save:  (chapterId: string, graph: GraphSnapshot) =>
           api.patch(`/api/chapters/${chapterId}/cumulative-graph`, { graph }),
}
```

- [ ] **Step 2: typecheck 通过**

Run:
```bash
pnpm typecheck
```

Expected: exit 0。

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/api/cumulative-graph.ts
git commit -m "feat(web): cumulativeGraphApi client for get/build/save"
```

---

## Task 8: ReviewingPanel.vue — 累计图谱区块 + handlers + props

**Files:**
- Modify: `apps/web/src/views/ReviewingPanel.vue` (template 360-380 + script)

- [ ] **Step 1: 在 props 加入 `chapterId`**

Edit `defineProps` 块:

```ts
const props = defineProps<{
  pending: V3PendingArchiveData
  retryingStages?: Partial<Record<StageName, boolean>>
  chapterId: string
  archiveRunning?: boolean
}>()
```

- [ ] **Step 2: 在 graph tab 区域, 在现有本章图谱 n-card 之后再加累计图谱 n-card**

Replace graph 区块模板 (行 360-380) with:

```vue
        <!-- 图谱 tab -->
        <n-tab-pane name="graph">
          <template #tab>
            <span class="rp-tab-label">
              <span class="rp-tab-dot" :style="{ background: dotColor('graph') }" aria-hidden="true" />
              图谱
            </span>
          </template>
          <div v-if="stageStatus('graph') === 'failed'" class="rp-stage-error">
            <strong>解析失败:</strong> {{ props.pending?.stages?.graph?.errorMessage || '未知错误' }}
          </div>
          <div class="rp-stage-actions">
            <n-button size="small" :disabled="isRetrying('graph')" @click="emit('retry-stage', 'graph')">
              {{ isRetrying('graph') ? '重新解析中…' : '重新解析本章图谱' }}
            </n-button>
          </div>

          <n-card title="本章图谱" size="small" style="margin-bottom: 16px">
            <EditableGraph
              ref="chapterGraphRef"
              :initial-graph-data="graphData"
            />
          </n-card>

          <n-card title="累计图谱" size="small">
            <template #header-extra>
              <n-space>
                <n-button
                  v-if="!cumulativeGeneratedAt"
                  size="small"
                  type="primary"
                  :loading="buildingCumulative"
                  @click="handleBuildCumulative"
                >生成累计图谱</n-button>
                <template v-else>
                  <n-button
                    size="small"
                    :loading="buildingCumulative"
                    @click="handleBuildCumulative"
                  >重新生成</n-button>
                  <n-button
                    size="small"
                    type="primary"
                    :loading="savingCumulative"
                    @click="handleSaveCumulative"
                  >保存调整</n-button>
                </template>
              </n-space>
            </template>
            <n-empty
              v-if="!cumulativeGeneratedAt"
              description="本章图谱编辑差不多后,点上面「生成累计图谱」生成。"
              style="margin: 24px 0"
            />
            <EditableGraph
              v-else
              ref="cumulativeGraphRef"
              :initial-graph-data="cumulativeGraphDraft"
            />
          </n-card>
        </n-tab-pane>
```

- [ ] **Step 3: 在 script 中加 import + state + handlers**

Edit script block。在第 401 行 `import EditableGraph` 旁加入 cumulativeGraphApi:

```ts
import { cumulativeGraphApi } from '../api/cumulative-graph'
```

把 `graphRef` 替换为:

```ts
const chapterGraphRef = ref<InstanceType<typeof EditableGraph> | null>(null)
const cumulativeGraphRef = ref<InstanceType<typeof EditableGraph> | null>(null)
const cumulativeGraphDraft = ref<any>({ nodes: [], edges: [] })
const cumulativeGeneratedAt = ref<string | null>(null)
const buildingCumulative = ref(false)
const savingCumulative = ref(false)
```

- [ ] **Step 4: 替换原 `graphRef` 与 `pullGraphDraftIntoLocalData` 中的所有引用**

将所有 `graphRef` 重命名为 `chapterGraphRef`(本文件作用域内),`pullGraphDraftIntoLocalData` 函数保持原样引用 `chapterGraphRef.value.getData()`。同时移除 `const confirming = ref(false)` 与 `const saving = ref(false)` 各自的 setTimeout,把它们改成纯布尔由"保存调整"按钮直接控制 (saving 仍由 handleSave 内 `saving.value = true` + `finally { saving.value = false }` 控制,逻辑保留)。

把 `graphData` computed 保留不变(它从 `localData.value.graph.chapterGraph` 取)。

- [ ] **Step 5: 加 onMounted + watchers 拉累计图谱**

在 script 中(import 块后,state 声明之后)加:

```ts
import { onMounted } from 'vue'

async function loadCumulativeGraph() {
  if (!props.chapterId) return
  try {
    const res: any = await cumulativeGraphApi.get(props.chapterId)
    const data = res?.data?.data
    cumulativeGeneratedAt.value = data?.generatedAt ?? null
    cumulativeGraphDraft.value = data?.graph ?? { nodes: [], edges: [] }
  } catch (err) {
    // 静默; UI 仍会显示"未生成"状态
  }
}

onMounted(() => { loadCumulativeGraph() })
watch(() => props.chapterId, () => { loadCumulativeGraph() })
```

- [ ] **Step 6: 加 build / save handlers**

在 `pullGraphDraftIntoLocalData` 后追加:

```ts
async function handleBuildCumulative() {
  const chapterGraph = chapterGraphRef.value?.getData()
  if (!chapterGraph) return
  buildingCumulative.value = true
  try {
    const res: any = await cumulativeGraphApi.build(props.chapterId, chapterGraph)
    const data = res?.data?.data
    cumulativeGraphDraft.value = data?.graph ?? { nodes: [], edges: [] }
    cumulativeGeneratedAt.value = data?.generatedAt ?? new Date().toISOString()
  } catch (err: any) {
    const msg = err?.response?.data?.error ?? err?.message ?? '累计图谱生成失败'
    window.$message?.error(msg)
  } finally {
    buildingCumulative.value = false
  }
}

async function handleSaveCumulative() {
  if (!cumulativeGraphRef.value) return
  const graph = cumulativeGraphRef.value.getData()
  savingCumulative.value = true
  try {
    await cumulativeGraphApi.save(props.chapterId, graph)
    window.$message?.success('已保存')
  } catch (err: any) {
    const msg = err?.response?.data?.error ?? err?.message ?? '保存失败'
    window.$message?.error(msg)
  } finally {
    savingCumulative.value = false
  }
}
```

> `window.$message` 是 Naive UI 的 message provider 全局接口。如未安装,改用 `useMessage()`。

- [ ] **Step 7: 把"确认归档"按钮的 loading 改成 prop 驱动**

Edit 底部按钮行(行 387):

```vue
        <n-button type="success" :loading="archiveRunning ?? false" @click="handleConfirm">确认归档</n-button>
```

- [ ] **Step 8: 修 `handleConfirm`: 删除 setTimeout(200)**

Edit 行 601-606:

```ts
function handleConfirm() {
  // 前置软校验: 累计图谱未生成, 拦截 emit, 弹 toast。
  if (!cumulativeGeneratedAt.value) {
    window.$message?.error('请先生成累计图谱再归档')
    return
  }
  pullGraphDraftIntoLocalData()
  emit('confirm', toV3(localData.value, props.pending))
  // 注意: 按钮 loading 由父组件 archiveRunning 控制, 这里不再 set confirming。
}
```

- [ ] **Step 9: typecheck**

```bash
pnpm typecheck
```

Expected: exit 0。

- [ ] **Step 10: Commit**

```bash
git add apps/web/src/views/ReviewingPanel.vue
git commit -m "feat(web): ReviewingPanel split chapter/cumulative graph with build/save handlers"
```

---

## Task 9: Chapters.vue + ChapterEditor.vue — archiveRunning 父级管理

**Files:**
- Modify: `apps/web/src/views/Chapters.vue:295-301` (handleConfirmArchiveWithData)
- Modify: `apps/web/src/views/chapters/ChapterEditor.vue:251-260` (传 chapter-id + archive-running)

- [ ] **Step 1: 在 Chapters.vue 加 archiveRunning ref**

在文件中找一处 ref 声明(如 `repreparingArchive`,行未确认,但搜索后定位)附近加:

```ts
const archiveRunning = ref(false)
```

- [ ] **Step 2: 包 handleConfirmArchiveWithData**

Edit 行 295-301:

```ts
async function handleConfirmArchiveWithData(data: any) {
    archiveRunning.value = true
    try {
        // v3: ReviewingPanel 只读,pendingArchiveData 在 prepareArchive 时已写入 DB。
        const saved = await editor.savePendingArchiveData(data)
        if (!saved.success) return
        const result = await editor.archiveChapter()
        if (result.success) await handleBackToTree()
    } finally {
        archiveRunning.value = false
    }
}
```

- [ ] **Step 3: ChapterEditor.vue 加 chapter-id + archive-running props 透传给 ReviewingPanel**

Edit 行 251-260:

```vue
        <ReviewingPanel
            v-if="chapter?.status === 'reviewing' && pendingArchiveData?.version === 3"
            :pending="pendingArchiveData"
            :retrying-stages="retryingStages"
            :chapter-id="chapter.id"
            :archive-running="archiveRunning"
            @save="(data) => emit('save-pending-archive', data)"
            @confirm="(data) => emit('confirm-archive-with-data', data)"
            @cancel="emit('prepare-archive-cancel')"
            @reprepare="emit('reprepare-archive')"
            @retry-stage="(stageName) => emit('retry-stage', stageName)"
        />
```

并在 ChapterEditor.vue 的 props 类型(行 391-414)加:

```ts
    archiveRunning: boolean;
```

(如果 props 已存在同名,跳过)。

- [ ] **Step 4: typecheck + Commit**

```bash
pnpm typecheck
git add apps/web/src/views/Chapters.vue apps/web/src/views/chapters/ChapterEditor.vue
git commit -m "fix(web): route archive-running loading state from Chapters.vue to ReviewingPanel"
```

---

## Task 10: 文档迁移

**Files:**
- Modify: `docs/LOGIC.md`
- Modify: `Process.md`

- [ ] **Step 1: 更新 docs/LOGIC.md — 累计图谱章节**

找到现有的"累计图谱"相关段落,在其后追加一段:

```md
## 累计图谱 (v3 语义)

v3 起, `Chapter.cumulativeGraph` 不再是归档时 derived 字段,而是用户在 ReviewingPanel 里**主动生成、独立编辑**的工作产物。

### 持久化
- `Chapter.cumulativeGraph: String?` — 累计图谱 JSON
- `Chapter.cumulativeGraphGeneratedAt: DateTime?` — 用户首次主动生成的时间,作为"是否生成过"的标志

### 端点
- `GET /api/chapters/:id/cumulative-graph` — 拉取草稿
- `POST /api/chapters/:id/cumulative-graph/build` — 用户主动生成,首次生成即自动入库
- `PATCH /api/chapters/:id/cumulative-graph` — 用户手动保存编辑

### 流程
1. 用户在 ReviewingPanel 编辑本章图谱
2. 用户点"生成累计图谱" → POST /build → 写两列
3. 用户可对累计图谱继续编辑 → 点"保存调整" → PATCH → 只写 graph 不动 generatedAt
4. 用户点"确认归档" → 后端校验 generatedAt != null, 否则 400 cumulative-graph-not-generated
```

- [ ] **Step 2: 更新 Process.md — 归档章节附注**

找到现有"归档章节",加注:

```md
> **归档前置条件**: 累计图谱已生成 (`Chapter.cumulativeGraphGeneratedAt != null`)。
> 否则后端 `/archive` 返回 400 `cumulative-graph-not-generated`,前端在 ReviewingPanel 点击"确认归档"时也会预先拦截,提示用户去生成。
```

- [ ] **Step 3: Commit**

```bash
git add docs/LOGIC.md Process.md
git commit -m "docs(v3): document cumulative graph as user-maintained draft with archive guard"
```

---

## Task 11: 集成验证 (手动 smoke)

**Files:** none (纯 runtime 验证)

- [ ] **Step 1: 后端 typecheck + 跑测试**

```bash
pnpm typecheck
pnpm --filter server test
```

Expected: 全 PASS。

- [ ] **Step 2: 前端 typecheck + lint (若配置)**

```bash
pnpm typecheck
pnpm lint 2>/dev/null || echo "lint skip"
```

Expected: typecheck exit 0。

- [ ] **Step 3: 启动 dev, 手动验证**

```bash
pnpm dev
```

打开前端,选某章(已经在 reviewing 状态),进入 ReviewingPanel:
- 验证:累计图谱区块显示 "未生成" 提示 + "生成累计图谱" 按钮
- 点按钮 → 等 AI 返回 → 累计图谱区块变为 EditableGraph 视图,显示 "重新生成" / "保存调整" 按钮
- 在累计图谱加点节点 → 点 "保存调整" → 看到保存成功 toast
- 点 "确认归档" → 按钮 loading 持续到归档完成(不再是闪烁)
- 归档成功 → 回到列表,看 chapter `cumulativeGraph` 列数据正确

- [ ] **Step 4: 验证拦截路径**

模拟用户从未生成累计图谱直接点归档:在数据库中 `UPDATE Chapter SET cumulativeGraphGeneratedAt = NULL WHERE id = ...`,前端重新进入 reviewing,点"确认归档":
- 期望:前端弹 toast "请先生成累计图谱再归档",不发起请求
- 后端若绕过前端直接打 /archive,期望 400 + `cumulative-graph-not-generated`

- [ ] **Step 5: Commit 验证记录 (无改动则跳过)**

如果验证中有调整代码,单独 commit。无代码改动,跳过此步。

---

## Plan 总结

11 个 Task 列表:

| Task | 类型 | 改动 |
| --- | --- | --- |
| 1 | Schema | 加 `Chapter.cumulativeGraphGeneratedAt` |
| 2 | Test 脚手架 | 新建 `apps/server/test/` |
| 3-5 | 后端 TDD | GET / POST /build / PATCH 三端点 |
| 6 | 后端改造 | archive 移除 buildCumulativeGraph + 强校验 |
| 7 | 前端 API | `cumulative-graph.ts` |
| 8 | 前端 UI | ReviewingPanel 双段图谱区块 |
| 9 | 前端父级 | Chapters.vue `archiveRunning` |
| 10 | 文档 | LOGIC.md / Process.md |
| 11 | 集成验证 | 手动 smoke + 后端校验测试 |

完成后累计图谱是真正独立维护的工作产物,归档只是消费它。
