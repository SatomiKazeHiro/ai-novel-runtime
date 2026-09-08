# GraphView 浏览器实测 2 个 bug 修复 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修掉浏览器实测暴露的 2 个新 bug —— 后端 GET 路由补 `chapterGraph` 字段 + 前端 GraphView watch 增加 `displayData` 依赖。

**Architecture:**
- 后端 1 个文件 1 处改动:`apps/server/src/routes/chapters-archive.ts:366-380` 增加 chapterGraph 字段从 `Chapter.chapterGraph` Prisma TEXT 读取并 `safeJsonParse`。
- 前端 1 个文件 1 处改动:`apps/web/src/components/graph/GraphView.vue:153-159` watch 依赖数组加 `displayData`,让 init() 拉完数据 currentSnapshot 变化时 watch 二次 trigger rebuild(真实数据)。
- 测试 1 个 server 新文件 + 2 个 web 现有文件加用例。

**Tech Stack:** TypeScript (NodeNext 后端 / ESNext 前端)、Fastify + Prisma + Vitest (server)、Vue 3 + Composition API + @vue/test-utils + jsdom + Vitest (web)。

---

## 文件结构

| 文件 | 类型 | 职责 |
|------|------|------|
| `apps/server/src/routes/chapters-archive.ts` | 修改 L366-380 | GET 路由响应补 `chapterGraph` 字段 |
| `apps/server/src/__tests__/routes/cumulative-graph-get-chapterGraph.test.ts` | 新增 | 5 个 server 契约测试 |
| `apps/web/src/components/graph/GraphView.vue` | 修改 L153-159 | watch deps 加 `displayData` |
| `apps/web/src/components/__tests__/GraphView.spec.ts` | 修改追加 | 加 bug 1 测试用例:首次 init 后 rebuild 用真实数据 |
| `apps/web/src/composables/__tests__/useGraphData.spec.ts` | 修改追加 | 加章节图谱字段测试(已在 T1 写过 `chapterGraph 缺失时 currentDelta 仍为合法空图` 这条 — 本任务再补一条 `chapterGraph 非空时 currentDelta 正确映射`,但因现有 'loadChapterGraph 把 graph 映射到 currentSnapshot、chapterGraph 到 currentDelta' 用例已覆盖此契约,所以**不再加新用例**,仅 web 端 GraphView 加 1 个新用例)|

具体 useGraphData 新用例决策:已存在 1 个用例 (`'loadChapterGraph 把 graph 映射到 currentSnapshot、chapterGraph 到 currentDelta'`) 已覆盖 `chapterGraph` 字段映射契约 —— 不重复。本 plan 避免冗余测试,只新增 GraphView.vue 的 1 个 bug1 测试用例。

---

## Task 1: 后端 GET 路由补 `chapterGraph` 字段 (TDD)

**Files:**
- Modify: `apps/server/src/routes/chapters-archive.ts:366-380`
- Create: `apps/server/src/__tests__/routes/cumulative-graph-get-chapterGraph.test.ts`

- [ ] **Step 1: 写 5 个 server 测试 (故意先 fail)**

Create `apps/server/src/__tests__/routes/cumulative-graph-get-chapterGraph.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createMockApp, callHandler } from '../setup.js'

describe('GET /api/chapters/:chapterId/cumulative-graph — chapterGraph 契约', () => {
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

  it('chapter 有 graph + chapterGraph 两者都回', async () => {
    const isoNow = '2026-07-27T10:00:00.000Z'
    const storedGraph = {
      nodes: [{ type: 'character', key: 'linfan', label: '林凡', data: {} }],
      edges: [{ fromType: 'character', fromKey: 'linfan', toType: 'event', toKey: 'duel', relation: '参与', weight: 1 }],
      timestamp: isoNow
    }
    const storedChapterGraph = {
      nodes: [{ type: 'character', key: 'linfan', label: '林凡', data: {} }],
      edges: [{ fromType: 'character', fromKey: 'linfan', toType: 'event', toKey: 'duel', relation: '参与', weight: 1 }],
      timestamp: isoNow
    }
    mockPrisma.chapter.findUnique.mockResolvedValueOnce({
      id: 'ch-1',
      cumulativeGraph: JSON.stringify(storedGraph),
      chapterGraph: JSON.stringify(storedChapterGraph),
      cumulativeGraphGeneratedAt: new Date(isoNow),
      status: 'archived', isSideStory: false, content: 'x',
      parentChapterId: null, number: 1, storyId: 's1'
    })
    const res = await callHandler(
      routes, 'GET', '/api/chapters/:chapterId/cumulative-graph',
      undefined, { chapterId: 'ch-1' }
    )
    expect(res.body.success).toBe(true)
    expect(res.body.data.generatedAt).toBe(isoNow)
    expect(res.body.data.graph).toEqual(storedGraph)
    expect(res.body.data.chapterGraph).toEqual(storedChapterGraph)
  })

  it('chapter 都没有时,generatedAt / graph / chapterGraph 都为 null', async () => {
    mockPrisma.chapter.findUnique.mockResolvedValueOnce({
      id: 'ch-1',
      cumulativeGraph: null,
      chapterGraph: null,
      cumulativeGraphGeneratedAt: null,
      status: 'draft', isSideStory: false, content: 'x',
      parentChapterId: null, number: 1, storyId: 's1'
    })
    const res = await callHandler(
      routes, 'GET', '/api/chapters/:chapterId/cumulative-graph',
      undefined, { chapterId: 'ch-1' }
    )
    expect(res.body).toEqual({ success: true, data: { generatedAt: null, graph: null, chapterGraph: null } })
  })

  it('chapter 只有 graph 没有 chapterGraph 时,chapterGraph 字段回 null', async () => {
    const isoNow = '2026-07-27T10:00:00.000Z'
    const storedGraph = {
      nodes: [{ type: 'character', key: 'a', label: 'A', data: {} }],
      edges: [],
      timestamp: isoNow
    }
    mockPrisma.chapter.findUnique.mockResolvedValueOnce({
      id: 'ch-1',
      cumulativeGraph: JSON.stringify(storedGraph),
      chapterGraph: null,
      cumulativeGraphGeneratedAt: new Date(isoNow),
      status: 'archived', isSideStory: false, content: 'x',
      parentChapterId: null, number: 1, storyId: 's1'
    })
    const res = await callHandler(
      routes, 'GET', '/api/chapters/:chapterId/cumulative-graph',
      undefined, { chapterId: 'ch-1' }
    )
    expect(res.body.success).toBe(true)
    expect(res.body.data.generatedAt).toBe(isoNow)
    expect(res.body.data.graph).toEqual(storedGraph)
    expect(res.body.data.chapterGraph).toBeNull()
  })

  it('cumulativeGraphGeneratedAt 是 Date 类型时回 ISO 字符串', async () => {
    mockPrisma.chapter.findUnique.mockResolvedValueOnce({
      id: 'ch-1',
      cumulativeGraph: null,
      chapterGraph: null,
      cumulativeGraphGeneratedAt: new Date('2026-07-01T08:00:00.000Z'),
      status: 'archived', isSideStory: false, content: 'x',
      parentChapterId: null, number: 1, storyId: 's1'
    })
    const res = await callHandler(
      routes, 'GET', '/api/chapters/:chapterId/cumulative-graph',
      undefined, { chapterId: 'ch-1' }
    )
    expect(res.body.data.generatedAt).toBe('2026-07-01T08:00:00.000Z')
  })

  it('chapterGraph JSON 损坏时回 null 而不抛错', async () => {
    const isoNow = '2026-07-27T10:00:00.000Z'
    mockPrisma.chapter.findUnique.mockResolvedValueOnce({
      id: 'ch-1',
      cumulativeGraph: null,
      chapterGraph: '{not valid json[',
      cumulativeGraphGeneratedAt: null,
      status: 'archived', isSideStory: false, content: 'x',
      parentChapterId: null, number: 1, storyId: 's1'
    })
    const res = await callHandler(
      routes, 'GET', '/api/chapters/:chapterId/cumulative-graph',
      undefined, { chapterId: 'ch-1' }
    )
    expect(res.body.success).toBe(true)
    expect(res.body.data.chapterGraph).toBeNull()
  })
})
```

- [ ] **Step 2: 跑测试确认 fail**

Run: `pnpm --filter server exec vitest run src/__tests__/routes/cumulative-graph-get-chapterGraph.test.ts`
Expected: 5/5 FAIL — 现有路由响应只回 `graph` 不回 `chapterGraph`,断言 `res.body.data.chapterGraph` 是 undefined 或缺失,expect 失败。

- [ ] **Step 3: 改后端路由补 chapterGraph 字段**

修改 `apps/server/src/routes/chapters-archive.ts:366-380`,把:

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

改为 (加入 `chapterGraph` 字段读取 + 注释):

```ts
  // GET /api/chapters/:chapterId/cumulative-graph
  // 拉取累计图谱草稿 + generatedAt + 本章图谱; 任意字段未写入时回 null。
  // chapterGraph 来自 Chapter.chapterGraph (archive confirm 阶段写入, 详见 chapters-archive.ts L179-188)。
  // 前端 GraphView 用 chapterGraph 渲染「本章纯净」tab — 见 spec 2026-07-29-graphview-bugfix-design.md。
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
    const chapterGraph = chapter.chapterGraph
      ? safeJsonParse<GraphSnapshot | null>(chapter.chapterGraph, null)
      : null

    return { success: true, data: { generatedAt, graph, chapterGraph } }
  })
```

唯一改动:加 `chapterGraph` 变量 + 加入响应对象。

- [ ] **Step 4: 跑测试确认 pass**

Run: `pnpm --filter server exec vitest run src/__tests__/routes/cumulative-graph-get-chapterGraph.test.ts`
Expected: 5/5 PASS。

- [ ] **Step 5: 跑 server typecheck 确认不破坏其他文件**

Run: `pnpm --filter server typecheck`
Expected: 干净通过 (无新增 error)。

- [ ] **Step 6: 跑相关现有 cumulative-graph 测试确认未破坏**

Run: `pnpm --filter server exec vitest run src/__tests__/routes/cumulative-graph.test.ts`
Expected: 现有 2 个 GET 用例 (`returns generatedAt=null and graph=null when not yet generated` / `returns existing graph and generatedAt`) 的 `expect(res.body).toEqual(...)` 断言被新加的 `chapterGraph` 字段破坏 — 需要更新这两个用例,在 `expect` 中加 `chapterGraph: null`。

调整 `apps/server/src/__tests__/routes/cumulative-graph.test.ts` L42 用例 (line 42):

```ts
expect(res.body).toEqual({ success: true, data: { generatedAt: null, graph: null, chapterGraph: null } })
```

L63-65 用例保持不变 (`expect(res.body.data.graph).toEqual(storedGraph)`,不验整体 res.body) — 不动。

跑: `pnpm --filter server exec vitest run src/__tests__/routes/cumulative-graph.test.ts`
Expected: PASS。

- [ ] **Step 7: Commit**

```bash
cd "D:/NewCode/ai-novel-runtime"
git add apps/server/src/routes/chapters-archive.ts apps/server/src/__tests__/routes/cumulative-graph-get-chapterGraph.test.ts apps/server/src/__tests__/routes/cumulative-graph.test.ts
git commit -m "$(cat <<'EOF'
fix(server): GET cumulative-graph 响应补回 chapterGraph 字段

前端 GraphView 「本章纯净」tab 一直空白:
后端路由原本只回 { generatedAt, graph } (= cumulativeGraph),
漏回 Chapter.chapterGraph (本章图谱)。
data.chapterGraph 永远 undefined → toGraphData(undefined, undefined) → 空图谱。

修复: 路由响应增加 chapterGraph 字段, 从 Chapter.chapterGraph Prisma
TEXT 字段读取并 safeJsonParse 出来。contract 与前端 useGraphData.loadChapterGraph 期待一致。

测试:
- 新增 cumulative-graph-get-chapterGraph.test.ts 5 个用例
  (都有 / 都没有 / 只有 graph / generatedAt ISO / JSON 损坏回 null)
- 更新 cumulative-graph.test.ts 现有 1 个 toEqual 断言补上 chapterGraph: null

refspec: docs/superpowers/specs/2026-07-29-graphview-bugfix-design.md

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: 前端 GraphView watch 增加 `displayData` 依赖 (TDD)

**Files:**
- Modify: `apps/web/src/components/graph/GraphView.vue:153-159`
- Modify: `apps/web/src/components/__tests__/GraphView.spec.ts` (追加 1 个 it)

- [ ] **Step 1: 加新 GraphView 测试用例 (故意先 fail)**

打开 `apps/web/src/components/__tests__/GraphView.spec.ts`,在现有 `describe` 块内(最后一个 `it` 之后)追加:

```ts
  it('首次 init 后 cytoscape.rebuild 用真实 snapshot 数据（非 null）', async () => {
    // bug 1 修复: 旧代码 watch([selectedChapterId, viewMode, () => route.params.storyId])
    // 不依赖 displayData, init → selectChapter 同步赋值触发 watch1 时 displayData 还是 null,
    // rebuild(null) 早退, 数据到达后 watch 不再 trigger → 画布永远空。
    // 修复: watch deps 加 displayData, 数据到达时触发 watch2 rebuild(真实数据)。
    vi.mocked(chaptersApi.list).mockResolvedValue({
      data: { data: [ stubChapter('c', 3, 'archived') ] }
    } as any)
    vi.mocked(cumulativeGraphApi.get).mockResolvedValue({
      data: { data: {
        graph: { nodes: [{ type: 'character', key: 'real', label: 'RealData' }], edges: [] },
        chapterGraph: { nodes: [], edges: [] }
      }}
    } as any)

    const router = setupRouter()
    router.push('/novel-design/story-1/graph')
    await router.isReady()
    const wrapper = mount(GraphView, { global: { plugins: [router] } })

    // 等 init() 整个链路跑完: chapters 加载完 + selectChapter 同步赋值 + loadChapterGraph 异步 fetch 完
    await new Promise(r => setTimeout(r, 50))
    await nextTick()

    const lifecycle = getLastLifecycle()
    expect(lifecycle.rebuild).toHaveBeenCalled()
    // 至少有一次调用, 参数是真实数据 (不是 null)
    const calledWithRealData = lifecycle.rebuild.mock.calls.some(call => {
      const arg = call[0]
      return arg && Array.isArray(arg.nodes) && arg.nodes.some((n: any) => n.key === 'real')
    })
    expect(calledWithRealData).toBe(true)
  })
```

- [ ] **Step 2: 跑新用例确认 fail**

Run: `pnpm --filter web exec vitest run src/components/__tests__/GraphView.spec.ts`
Expected: 新加的用例 FAIL, 其他 3 个仍 PASS。

具体 FAIL 原因:GraphView 现有 watch 不依赖 `displayData`, 数据到达时不会触发 watch2, `rebuild` 只在 selectedChapterId 同步赋值时调过一次且参数是 null 早退 — `lifecycle.rebuild.mock.calls.some(...key === 'real')` 为 false。

- [ ] **Step 3: 改 GraphView watch 加 displayData 依赖**

修改 `apps/web/src/components/graph/GraphView.vue:153-159`,把:

```ts
// 关键修复 (T3):
// chapterId 切换 / viewMode 切换 / 路由参数切换 都在一条 watch 内,
// nextTick 后用 displayData 单入口 rebuild —— 避免旧 GraphView 的三处分散 init 路径
// (chapterId 切换只 clearFocus 没 rebuild; viewMode 切换读旧 ref 值; delta 污染) 。
watch(
  [selectedChapterId, viewMode, () => route.params.storyId],
  async () => {
    await nextTick()
    cytoscape.rebuild(displayData.value)
  }
)
```

改为:

```ts
// bug 1 修复 (2026-07-29):
// - selectedChapterId / viewMode 变化触发 watch
// - displayData (computed) 依赖 currentSnapshot / currentDelta, init() 拉完数据时
//   currentSnapshot 变 → displayData 变 → 再触发一次 watch2 调 rebuild(真实数据)
//   (避免 selectChapter 同步赋值早于 loadChapterGraph 完成, 首次 rebuild(null) 早退后再不触发)
// - route.storyId 同理
// 关键修复 (T3): 单 watch 收敛后, init 时序: selectChapter → rebuild(null 早退) →
// loadChapterGraph 完成 → displayData 变 → rebuild(realData)
watch(
  [selectedChapterId, viewMode, displayData, () => route.params.storyId],
  async () => {
    await nextTick()
    cytoscape.rebuild(displayData.value)
  }
)
```

唯一改动:watch deps 数组加 `displayData` 一个项,其他不变。`displayData` 是已经在脚本上下文里定义的 computed (L101-103),直接引用即可。

- [ ] **Step 4: 跑新用例确认 pass**

Run: `pnpm --filter web exec vitest run src/components/__tests__/GraphView.spec.ts`
Expected: 4/4 PASS (含新加的)。

- [ ] **Step 5: 跑 web 全套测试确认未破坏**

Run: `pnpm --filter web test`
Expected: 9 个文件 76/76 PASS(原 75 个 + 新加 1 个 GraphView)。

- [ ] **Step 6: 跑 web typecheck 确认干净**

Run: `pnpm --filter web typecheck`
Expected: 干净。

- [ ] **Step 7: Commit**

```bash
cd "D:/NewCode/ai-novel-runtime"
git add apps/web/src/components/graph/GraphView.vue apps/web/src/components/__tests__/GraphView.spec.ts
git commit -m "$(cat <<'EOF'
fix(web): GraphView watch 增加 displayData 依赖

浏览器实测 bug 1: 进入知识图谱页「累计全局」空白, 切章节后才显示。
根因: GraphView.vue watch deps 不含 displayData。

时序:
1. init() → selectChapter('c')
   a. selectedChapterId.value = 'c' 同步赋值 → 触发 watch1
   b. rebuild(displayData.value) 此时 displayData 仍是 null (loadChapterGraph 未完成)
   c. rebuild(null) → useCytoscapeLifecycle L281 `if (!data) return` 早退
2. await loadChapterGraph('c') 完成 → currentSnapshot.value = 真实数据
3. displayData (computed) 重算为真实数据 → 但 watch deps 不含 displayData, 不会触发 watch2
4. 画布永远空

修复: watch deps 数组加入 displayData。init → selectChapter 同步赋值触发
watch1 (rebuild(null) 早退, 无副作用), loadChapterGraph 完成后 currentSnapshot
变 → displayData 变 → 触发 watch2 → rebuild(真实数据) → 画布显示。

不动 useCytoscapeLifecycle (null 早退是设计意图, 不动契约);
不动 useGraphData / cumulativeGraphApi 客户端 (本次服务端补回 chapterGraph 一起).

测试: GraphView.spec.ts 加 1 个用例 (首次 init 后 rebuild 用真实数据).

refspec: docs/superpowers/specs/2026-07-29-graphview-bugfix-design.md

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: 全验证 + 报告

不做代码改动,只跑全验证 + 给用户展示 2 个 commit 的 diff。

- [ ] **Step 1: 跑 web typecheck + 全部 vitest**

Run:
```bash
cd "D:/NewCode/ai-novel-runtime"
pnpm --filter web typecheck
pnpm --filter web test
```

Expected: typecheck 干净 + 9 文件 76/76 PASS。

- [ ] **Step 2: 跑 server typecheck + 全部 vitest (注意前面 session 可能残流 hook timeout)**

Run:
```bash
cd "D:/NewCode/ai-novel-runtime"
pnpm --filter server typecheck
pnpm --filter server test
```

Expected: typecheck 干净 + 至少新增的 5 个 server 用例 PASS, 现有 cumulative-graph 的 1 个调整用例 PASS, 其它服务测试不应被本任务破坏 (特别注意 chapters-archive 涉及的 prepare-archive / archive 路由测试)。如有并发 hook timeout 失败单独验证是否与本任务相关。

- [ ] **Step 3: 跑根级 typecheck 与 build 验证**

Run:
```bash
cd "D:/NewCode/ai-novel-runtime"
pnpm typecheck
```

Expected: 干净通过(本任务改动小,build 链路不受影响)。

- [ ] **Step 4: 跑 git log 显示两次 commit**

Run:
```bash
cd "D:/NewCode/ai-novel-runtime"
git log --oneline -5
```

Expected 显示最新 2 commits:
```
fix(web): GraphView watch 增加 displayData 依赖
fix(server): GET cumulative-graph 响应补回 chapterGraph 字段
docs(spec): GraphView 浏览器实测 2 个 bug 修复设计
```

- [ ] **Step 5: 展示两个 fix commit 的 diff 摘要给用户**

展示 `git diff HEAD~2..HEAD --stat` 输出,等用户确认。

---

## 自审

1. **Spec 覆盖:**
   - Spec 4 节 (现状 / 根因 / 范围 / 数据流 / 验收) → Task 1 完成后端契约 + Task 2 完成后端契约消费链路。
   - Bug 1 (watch 数据到达不再 trigger) → Task 2 Step 3 改 deps。
   - Bug 2 (后端漏回字段) → Task 1 Step 3 改路由。
   - 验收 4 步 → Task 3 Step 5 留给用户浏览器人工。

2. **Placeholder scan:** 无 TBD / TODO。

3. **Type 一致:**
   - `chapterGraph: GraphSnapshot | null` (Prisma TEXT 经 safeJsonParse) → 后端响应 `data.chapterGraph: GraphSnapshot | null`
   - 前端 `useGraphData.ts:23` `data.chapterGraph?.nodes` 消费 ↔ 后端响应 `chapterGraph` 字段 — type 对齐。
   - `displayData` 在 GraphView.vue L101-103 定义, Task 2 Step 3 直接引用, 不存在名称漂移。

4. **不重复测试:** 已存在 `useGraphData.spec.ts` 用例 `'loadChapterGraph 把 graph 映射到 currentSnapshot、chapterGraph 到 currentDelta'` 已覆盖 `chapterGraph` 字段映射契约, 不再加。

5. **commit 粒度:** Task 1 commit = 后端契约 1 commit, Task 2 commit = 前端 watch 1 commit。跨 package 但耦合松, 可独立 revert/cherry-pick。
