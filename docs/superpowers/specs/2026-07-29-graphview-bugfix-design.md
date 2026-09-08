# GraphView 浏览器实测 2 个 bug 修复 Design Spec

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修掉浏览器实测暴露的 2 个新 bug：(1) 进入图谱页累计全局空白、切章节后才显示；(2) 切换到「本章纯净」仍是空白。后端补回 `chapterGraph` 字段 + 前端 watch 加上对 `displayData` 的依赖,两边对齐 v3 cumulativeGraph JSON + 本章图谱的双视图契约。

**Architecture:**
- 后端:`GET /api/chapters/:chapterId/cumulative-graph` 路由响应补 `chapterGraph` 字段,从 `Chapter.chapterGraph` (Prisma TEXT, 已存在 schema) 读取并 `safeJsonParse`
- 前端:不动 `useGraphData.ts` 和 API 客户端层;只改 `GraphView.vue` 的 `watch` 依赖,把 `displayData` 加进去 — 这样首次 `init()` 拉完数据 currentSnapshot/currentDelta 变化会再次 trigger watch 触发 rebuild

**Tech Stack:** TypeScript (NodeNext 后端 / ESNext 前端)、Fastify + Prisma、Vue 3 + Composition API、Vitest。

---

## 调研发现

### 现状

| 位置 | 状态 |
|------|------|
| `apps/server/src/routes/chapters-archive.ts:366-380` | GET 路由只返回 `{ generatedAt, graph }`,漏回 `chapterGraph` |
| `apps/server/src/services/stages/cumulative-graph-build-service.ts` | build 端点已经写 `Chapter.cumulativeGraph`;`chapters-archive.ts:179-188` 已经写 `Chapter.chapterGraph` (archive confirm 路径);字段在 DB 里有真实数据,但 GET 没回 |
| `apps/web/src/composables/graph/useGraphData.ts:22-23` | 消费 `data.graph` + `data.chapterGraph`,期待后者存在 |
| `apps/web/src/components/graph/GraphView.vue:153-159` | `watch([selectedChapterId, viewMode, () => route.params.storyId])` — 没有 `displayData` 依赖 |
| `apps/web/src/composables/graph/useCytoscapeLifecycle.ts:279-281` | `rebuild` 头两行 `if (!containerRef.value) return; if (!data) return` — null 早退 |
| `prisma/schema.prisma:73-74` | `Chapter.chapterGraph` / `Chapter.cumulativeGraph` 都是 `String?` JSON 字段 |

### Bug 现象 (用户浏览器实测)

1. **进入 `/novel-design/<storyId>/graph`**:画布空白 → 切换 ChapterReel 到别的 archived 章节才显示累计图谱
2. **切到「本章纯净」tab**:画布**仍**是空白 — 跟前 session 原报 1 号 bug 一模一样

### Bug 根因

#### Bug 1:首次进入累计空白,切章节后恢复

`GraphView.vue:133-147`:

```ts
async function selectChapter(chapterId: string) {
  selectedChapterId.value = chapterId      // ① 同步赋值 → 触发 watch (deps 1)
  await loadChapterGraph(chapterId)        // ② 异步 fetch → currentSnapshot 值变化
}

watch([selectedChapterId, viewMode, () => route.params.storyId], async () => {
  await nextTick()
  cytoscape.rebuild(displayData.value)     // ③ deps 1 trigger 时 displayData 仍为 null
})
```

时序:
1. `init()` 调 `selectChapter('c')` → `selectedChapterId.value = 'c'` 同步执行
2. watch 触发 deps 1: `selectedChapterId` 从 `''` → `'c'` → 进入 watch 回调
3. 回调 `async () => { await nextTick(); rebuild(displayData.value) }` — 此时 `currentSnapshot/currentDelta` 还都是 `null`,`displayData` computed 重算返回 `null`
4. `rebuild(null)` → `useCytoscapeLifecycle.ts:281` `if (!data) return` **早退** — 啥也不做
5. `await loadChapterGraph('c')` 后续完成 → `currentSnapshot.value = realData` → `displayData` computed 重算 → **但 watch 没有 `displayData` 依赖,不会 trigger**
6. 画布永远空

用户切章节时 (`selectedChapterId` 从 `'c'` → `'d'`):
- watch 触发 deps 2:这次 `displayData` 已有数据(`currentSnapshot` 上面已经 set 过) → 走 rebuild → 显示正常

#### Bug 2:delta 视图永远空白

后端 GET `/api/chapters/:chapterId/cumulative-graph` 路由 (`chapters-archive.ts:366-380`):

```ts
return { success: true, data: { generatedAt, graph } }
//                ↑ 缺 chapterGraph ↑
```

前端 `useGraphData.ts:19-24`:

```ts
const data = (res as any).data.data || {}
currentSnapshot.value = toGraphData(data.graph?.nodes, data.graph?.edges)         // ✓
currentDelta.value = toGraphData(data.chapterGraph?.nodes, data.chapterGraph?.edges)  // ✗ undefined
```

`data.chapterGraph` 永远 `undefined` → `toGraphData(undefined, undefined)` → `normalizeGraph` 内 `(rawNodes || []).map(...)` 兜底返回 `{ nodes: [], edges: [] }` → `rebuild({nodes:[], edges:[]})` → 渲染一张 0 节点 0 边的空 cytoscape,看着像空白。

`Chapter.chapterGraph` 在 Prisma schema 已存在 (`schema.prisma:73`),archive confirm 流程已经写入 (`chapters-archive.ts:179-188` 等多处),只是 GET 路由漏了回它。

---

## 范围

### 必须新增

| 路径 | 说明 |
|------|------|
| `apps/server/src/__tests__/routes/cumulative-graph-get-chapterGraph.test.ts` | 后端路由新测试,断言 GET 响应同时回 `graph` + `chapterGraph` |

### 必须修改

| 路径 | 改动 |
|------|------|
| `apps/server/src/routes/chapters-archive.ts:366-380` | GET 路由响应加 `chapterGraph` 字段,从 `Chapter.chapterGraph` 读并 `safeJsonParse` 出来 |
| `apps/web/src/components/graph/GraphView.vue:153-159` | watch 的 deps 数组加 `displayData` —— 这样 init() 拉完数据 currentSnapshot 变化 → displayData 跟着变 → watch trigger → rebuild(realData) |
| `apps/web/src/composables/__tests__/useGraphData.spec.ts` | 加测试:`data.chapterGraph = {nodes:[...], edges:[...]}` 时 currentDelta 是 toGraphData(...) 之后的非空图 |
| `apps/web/src/components/__tests__/GraphView.spec.ts` | 加测试:首次 init() 后 (selectedChapterId + displayData 都变化) → cytoscape.rebuild 至少被调用 1 次且参数是真实数据 |

### 不在范围

- 不动 `useCytoscapeLifecycle.ts` 任何代码(包括早退路径)
- 不动 `useGraphData.ts` 主体代码 — 它已经正确消费 `chapterGraph` 字段,只是字段之前不存在
- 不动 `useGraphData.ts` 的测试文件其他用例
- 不动 `EditableGraph.vue` / `GraphLegend.vue` / `ChapterReel.vue`
- 不动 `cumulativeGraphApi` 客户端
- 不动 Prisma schema 或 migration

---

## 数据流 (修复后)

```
init():
  loadChapters(storyId) → chapters.value = [archived 数按 number asc]
  selectChapter(latest.id):
    selectedChapterId.value = latest.id     → 触发 watch (deps1)
    await loadChapterGraph(latest.id)
      cumulativeGraphApi.get(latest.id)
      → GET /api/chapters/:id/cumulative-graph 响应: { graph, chapterGraph, generatedAt }
      → currentSnapshot = toGraphData(graph.nodes, graph.edges)
      → currentDelta    = toGraphData(chapterGraph.nodes, chapterGraph.edges)
      → displayData (computed) 重算 → 触发 watch (deps2)
        ↓
      nextTick → cytoscape.rebuild(displayData.value)  ← displayData 已有数据 ✓

切 delta tab:
  viewMode = 'delta' → 触发 watch (deps3)
    displayData computed 重算 (= currentDelta) → 触发 watch (deps4)
      ↓
    rebuild(currentDelta)  ← 本章图谱
```

注意:同一操作可能触发 watch 多次 (selectedChapterId 变 + displayData 变),但 `useCytoscapeLifecycle.rebuild` 每次都执行 destroy + new,这是幂等且幂等  — 多次重建无副作用,只是微小性能开销 (10ms 量级),可接受。

---

## cytoscape rebuild 协议 (无改动)

`useCytoscapeLifecycle.rebuild(data)` 头两行早退保持不变:

```ts
function rebuild(data: GraphData | null) {
  if (!options.containerRef.value) return
  if (!data) return
  // ...
}
```

修法不要求改这个契约 — 它是有意设计的 "null = 跳过" 语义。本 spec 只是把 watch 触发时机修正,让 watch 第二次 (displayData 已变化) 触发时拿到非 null 的 data。

---

## 后端契约 (改动)

`apps/server/src/routes/chapters-archive.ts:366-380` 路由响应:

```ts
// 修复前
return { success: true, data: { generatedAt, graph } }

// 修复后
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
```

**契约:** `chapterGraph` 是 nullable GraphSnapshot JSON,完全镜像 `graph` 的语义 — `null` 表示该字段未写入(可能因为该章节从未走 archive confirm 路径,或 chapterGraph extract 阶段失败)。

---

## 测试计划 (vitest)

### Server (新文件)

`apps/server/src/__tests__/routes/cumulative-graph-get-chapterGraph.test.ts` — mock prisma.findUnique 返回 chapter 行,断言:

| 用例 | 断言 |
|------|------|
| `chapter 有 graph + chapterGraph` | 响应 data 同时含 `graph` / `chapterGraph` 两个对象,各自字段正确解析 |
| `chapter 都没有` | 响应 data 是 `{ generatedAt: null, graph: null, chapterGraph: null }` |
| `chapter 只有 graph 没有 chapterGraph` | `graph` 回对象,`chapterGraph` 是 `null` |
| `cumulativeGraphGeneratedAt 是 Date 类型` | `generatedAt` 是 ISO 字符串 |
| `cumulativeGraphGeneratedAt 是 null` | `generatedAt` 是 `null` |

### Web (扩展现有文件)

`apps/web/src/composables/__tests__/useGraphData.spec.ts` 加 1 个用例:

| 用例 | 断言 |
|------|------|
| `cumulativeGraphApi.get 返回的 chapterGraph 非空` | `currentDelta.value.nodes` 非空数组 + 字段映射正确 |

`apps/web/src/components/__tests__/GraphView.spec.ts` 加 1 个用例:

| 用例 | 断言 |
|------|------|
| `进入后首次 rebuild 用真实数据 (非 null)` | mount 后 `cytoscape.rebuild` 最终被调用且参数是真实 snapshot 数据(非 null / 非空 graph) |

---

## 验收 (人工 4 步,浏览器)

1. 打开 `/novel-design/<storyId>/graph`:默认选中 number 最大 archived **且累计图谱立即显示**(不再等切换章节)
2. 切 delta tab:画布**显示**本章图谱(原 bug 修复点)
3. ChapterReel 切换到任意其他 archived:画布同步切换
4. Schema 把所有章节 status 改成 draft / reviewing:GraphEmptyState 渲染,画布不出空白 cytoscape

---

## 风险

| 风险 | 缓解 |
|------|------|
| 后端 `Chapter.chapterGraph` 在某些章节是 null (archive 失败 / 老数据未走完) | `rebuild(null) → toGraphData(null, null) → {nodes:[], edges:[]}` 即渲染空图,等价"本章图谱暂无数据",行为可接受 |
| GraphView 的 watch 因 `displayData` 加入会有更高频 trigger (同一操作 2 次) | `rebuild` 自身幂等,性能开销 10ms 量级,可接受;若用户实测可感,后续可加 debounce (本 spec 不引)|
| 后端补回 `chapterGraph` 后,前端 `data.chapterGraph?.nodes` 安全链 `?.` 保证原"无 chapterGraph 字段"路径仍 OK | 已有的 `data.chapterGraph?.nodes` 写法天然兼容 |
| `useGraphData` 测试文件改动面小 (只加 1 个用例) | 不动原 6 个用例 |

---

## 提交粒度 — 2 个 commit + 1 验证

```
test(server): add cumulative-graph GET chapterGraph contract cases
- 新增 5 个 server 测试,刻意先跑确认 fail (后端路由还没补)

fix(server): GET cumulative-graph 响应补回 chapterGraph 字段
- 路由从 Chapter.chapterGraph 读并 safeJsonParse,响应加 chapterGraph
- 5 个 server 测试从 fail 转 pass

fix(web): GraphView watch 增加 displayData 依赖 (bug fix)
- watch deps 加 displayData (初始化数据到达时再次 trigger)
- 加 useGraphData 1 个新用例 + GraphView 1 个新用例
```

为什么不是 1 个 atomic commit:后端契约修复和前端 watch 修复是**两个独立的修复点**,各自有明确 commit message。集成验收由 T3 + 后续 4 步人工验收承担。

也可在最后一步把 2 个 fix commit squash 或不 squash — 留给 user 决。

---

## 自审

1. **漏修点?** Bug 1 根因 (watch deps) + Bug 2 根因 (后端响应) 都覆盖。`useCytoscapeLifecycle` 早退路径故意不改。
2. **测试是否对应每个独立行为?** Server 5 用例 / Web 1+1 用例,各自覆盖一个契约。
3. **没有 TBD / TODO 占位**
4. **业务边界:** 与用户确定的一致 — "累计"和"本章"两个视图都能显示,空章节走空态。
5. **rollback 友好:** 2 个 commit 各自原子。
