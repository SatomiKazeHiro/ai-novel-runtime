# 图谱收尾设计:存储模型修正 + Bug 修复 + 死代码清理

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 收尾图谱相关代码 —— (1) 修正 reviewing 期间的双源数据问题,统一为只写 pendingArchiveData; (2) 修 ChapterReel 切章节不触发 fetch 的 bug; (3) 清掉确认无 caller 的死代码; (4) 修一处静默吞错。

**Architecture:**
- **存储模型重构**: reviewing 期间,所有图谱数据(本章 + 累计)只活在 `Chapter.pendingArchiveData` JSON 里; `Chapter.chapterGraph` / `Chapter.cumulativeGraph` / `Chapter.cumulativeGraphGeneratedAt` 三列只在 archive confirm 时从 pendingArchiveData 拷过来。这样消除了"用户编辑了但 archived 后看不到"的 bug,设计意图清晰。
- **Bug 修复**: GraphView watch 在 `selectedChapterId` 变化时主动调 `loadChapterGraph`,而不是只 rebuild。
- **死代码**: 删除未挂载的视图、清掉 useless 包装 computed、合并薄包装 service 文件。
- **静默吞错**: ReviewingPanel `loadCumulativeGraph` 的空 catch 改为 toast 报错。

**Tech Stack:** TypeScript (NodeNext 后端 / ESNext 前端)、Fastify + Prisma、Vue 3 + Composition API、Vitest、Zod。

---

## 现状(已调查核实)

### 三处图谱的关系
```
reviewing 期间 (章节还没归档):
  Chapter.pendingArchiveData = {
    version: 3,
    stages: { character, memory, plotArc, graph: { result: { chapterGraph } } },
    meta: { extractedAt, chapterNumber }
  }
  Chapter.chapterGraph = null (准备归档时 AI 抽出后写入)  ← BUG: 用户编辑不更新
  Chapter.cumulativeGraph = null
  Chapter.cumulativeGraphGeneratedAt = null

archive confirm 后:
  Chapter.chapterGraph = (AI 初稿, 不是用户终稿)  ← BUG
  Chapter.cumulativeGraph = (用户生成的累计图谱)
  Chapter.cumulativeGraphGeneratedAt = DateTime
  Chapter.pendingArchiveData = null (清空)
```

### 已确认的 Bug

**Bug #1 — 本章图谱 archived 后是 AI 初稿,不是用户终稿**
- prepare-archive 把 AI 抽出的 chapterGraph 写到 Chapter.chapterGraph 列
- 用户在 ReviewingPanel 编辑 + 点"保存调整" → 只写 pendingArchiveData, **不更新 Chapter.chapterGraph 列**
- archive confirm 不动 chapterGraph 列
- 结果: archived 章节在知识图谱页面"本章纯净" tab 显示的是 AI 初稿,不是用户编辑后的版本

**Bug #2 — ChapterReel 切章节不触发 fetch**
- `selectChapter` (含 loadChapterGraph) 只在 init() 里调一次
- ChapterReel 改 selectedChapterId → watch 触发 → 只 rebuild 不 fetch
- 图谱永远显示 init 加载的第一个章节(latest)的数据

### 已确认的死代码 / 过度兜底

| # | 位置 | 现状 |
|---|------|------|
| D1 | `apps/web/src/views/StageResultView.vue` | 文件存在但未被任何路由/component 引用,仅 `StageCard.vue:41` JSDoc 提及 |
| D2 | `ChapterReel.vue:77-80` | 4 个 computed (`placeholder`/`ariaLabel`/`prevLabel`/`nextLabel`) 各只 `return props.X`,跟默认值一字不差 |
| D3 | `EditableGraph.vue:180` | `displayGraphData` computed = `() => draftGraphData.value`,完全等于 ref |
| D4 | `EditableGraph.vue:205-211` | `loadDraftGraph` 函数只被 1 个 watcher 调,内联 1 行就够 |
| D5 | `cumulative-graph-build-service.ts` | 40 行薄包装只调 `buildCumulativeGraph` + 加 timestamp,不控事务边界 |
| S1 | `ReviewingPanel.vue:485-487` | `loadCumulativeGraph` 的 catch 是空块,静默吞掉 API 失败 |

---

## 设计:存储模型修正

### reviewing 期间(章节未归档)
所有图谱数据只活在 `Chapter.pendingArchiveData`:

```ts
interface PendingArchiveDataV3 {
  version: 3
  stages: {
    character: PendingStageState
    memory: PendingStageState
    plotArc: PendingStageState
    graph: PendingStageState  // result = { chapterGraph: GraphSnapshot }
  }
  // ↓ 新增 ↓
  cumulativeGraph?: GraphSnapshot          // 用户生成的累计图谱,build 后写
  cumulativeGraphGeneratedAt?: string      // 同上,ISO 时间戳
  // ↑ 新增 ↑
  meta: { extractedAt: string; chapterNumber: number }
}
```

- `Chapter.chapterGraph` 列:**reviewing 期间始终为 null**
- `Chapter.cumulativeGraph` 列:**reviewing 期间始终为 null**
- `Chapter.cumulativeGraphGeneratedAt` 列:**reviewing 期间始终为 null**
- 用户编辑、保存、生成累计图谱 → 全部走 pendingArchiveData 路径

### archive confirm(章节归档)
从 pendingArchiveData 拷到列:

```ts
await prisma.chapter.update({
  where: { id: chapterId },
  data: {
    status: 'archived',
    pendingArchiveData: null,
    chapterGraph: pending.stages.graph.result.chapterGraph
      ? JSON.stringify(pending.stages.graph.result.chapterGraph)
      : null,
    cumulativeGraph: pending.cumulativeGraph
      ? JSON.stringify(pending.cumulativeGraph)
      : null,
    cumulativeGraphGeneratedAt: pending.cumulativeGraphGeneratedAt
      ? new Date(pending.cumulativeGraphGeneratedAt)
      : null
  }
})
```

### 端点变化

| 端点 | 旧行为 | 新行为 |
|------|--------|--------|
| `POST /api/chapters/:id/prepare-archive` | 写 chapterGraph 列 (L179-188) | **不写 chapterGraph 列**; pendingArchiveData 已经含 chapterGraph |
| `POST /api/chapters/:id/prepare-archive/retry-stage/graph` | 写 chapterGraph 列 (L344-357) | **不写 chapterGraph 列** |
| `POST /api/chapters/:id/cumulative-graph/build` | 写 `Chapter.cumulativeGraph` + `cumulativeGraphGeneratedAt` 列 (L441-447) | **读** pendingArchiveData,**写** pendingArchiveData.cumulativeGraph + cumulativeGraphGeneratedAt (合并回 pendingArchiveData 整体更新) |
| `PATCH /api/chapters/:id/cumulative-graph` | 写 `Chapter.cumulativeGraph` 列 (L480-483) | **写** pendingArchiveData.cumulativeGraph |
| `POST /api/chapters/:id/archive` | 翻 status + 清 pendingArchiveData + 写回 cumulativeGraph (L545-548) | **翻 status + 清 pendingArchiveData + 写三个列**(chapterGraph + cumulativeGraph + cumulativeGraphGeneratedAt) |
| `GET /api/chapters/:id/cumulative-graph` | 读两个列 | 不变(仍读列,数据在 archive 后才有,reviewing 中 chapter 列就是 null) |

### 前端 ReviewingPanel 变化

- `loadCumulativeGraph()` (L478-488) → 删,数据从 `props.pending.cumulativeGraph` 拿
- `cumulativeGraphDraft` ref (L473) → 改为 `localData.cumulativeGraph`,与 chapterGraph 走同一个 localData 流
- `handleBuildCumulative` (L660-675) → 调新的 cumulativeGraphApi.build,后端写入 pendingArchiveData,前端刷新 props.pending
- `handleSaveCumulative` (L677-690) → 走 handleSave 流程,把 EditableGraph 的图存到 localData.cumulativeGraph,父组件 save 时整体写回 pendingArchiveData
- 取消独立 cumulativeGraphDraft state,**与 chapterGraph 共享 localData 通路**

---

## 设计:Bug #2 修复

### 方案(单一): watch 检测 selectedChapterId 变化调 loadChapterGraph

新增 `currentLoadedChapterId` ref 作为"已加载章节"哨兵,避免 viewMode/displayData 变化时重复 fetch:

```ts
const currentLoadedChapterId = ref<string | null>(null)

watch(
  [selectedChapterId, viewMode, displayData, () => route.params.storyId],
  async ([newChapterId]) => {
    if (newChapterId && newChapterId !== currentLoadedChapterId.value) {
      currentLoadedChapterId.value = newChapterId
      await loadChapterGraph(newChapterId)
    }
    await nextTick()
    cytoscape.rebuild(displayData.value)
  }
)
```

`init()` 改为不直接调 selectChapter,只设 selectedChapterId,让 watch 统一处理:

```ts
async function init() {
  const storyId = (route.params.storyId as string) || ''
  if (!storyId) return
  await loadChapters(storyId)
  if (chapters.value.length === 0) return
  selectedChapterId.value = chapters.value[chapters.value.length - 1].id
  // watch 会自动调 loadChapterGraph (哨兵检测到 selectedChapterId 变化)
}
```

**前置条件**: 需要把 `selectChapter` 函数删除(不再需要,所有走 watch 通路), 避免遗留调用造成双重 fetch 风险。

---

## 设计:死代码清理

### D1: 删 StageResultView.vue
- 文件:`apps/web/src/views/StageResultView.vue` 整个删
- `apps/web/src/components/StageCard.vue:41` JSDoc 改:`子级 StageResultView 发出` → 删掉这句或改成实际机制描述

### D2: ChapterReel 删 4 个 useless computed
- 模板里 `:placeholder="placeholder"` 改 `:placeholder="props.placeholder"` 或直接 `:placeholder="$props.placeholder"` (Vue 3 中可以直接用 `placeholder`,不需要 computed)
- 实际方案:直接用 props 即可,不需要 computed

### D3: EditableGraph 删 displayGraphData computed
- `useCytoscapeLifecycle` 的 `getDisplayData` 改为直接消费 `draftGraphData` ref

### D4: EditableGraph loadDraftGraph 内联
- watch 里直接 `draftGraphData.value = toGraphData(val?.nodes, val?.edges) ?? { nodes: [], edges: [] }`

### D5: 合并 cumulative-graph-build-service 到 cumulative-graph
- `buildCumulativeGraphWithTimestamp` 内联到 `cumulativeGraphApi.build` 路由处理里
- 删 `cumulative-graph-build-service.ts`
- 更新 import 引用

---

## 设计:静默吞错修复

### S1: ReviewingPanel loadCumulativeGraph 删除 + 改用 props
- 既然 `cumulativeGraph` 数据从 `props.pending` 来,就不需要 catch 静默了
- 如果父组件传 pending 失败,那是父组件的问题,应该在父组件 catch + toast
- 不需要修改,直接删 loadCumulativeGraph

(注: 这一项在存储模型重构里已经覆盖,不再单独处理)

---

## 范围

### 必须修改

| 路径 | 改动 |
|------|------|
| `packages/shared/src/archive.ts` | `PendingArchiveDataV3` 加 `cumulativeGraph?` + `cumulativeGraphGeneratedAt?`; Zod schema 同步 |
| `apps/server/src/routes/chapters-archive.ts` | prepare-archive 删 chapterGraph 列写入; retry-stage graph 删 chapterGraph 列写入; archive confirm 改写三个列; cumulative-graph/build 改写 pendingArchiveData; cumulative-graph PATCH 改写 pendingArchiveData |
| `apps/web/src/api/cumulative-graph.ts` | 同步类型: `cumulativeGraphApi.save` 入参改为 `pendingArchiveData` patch 风格 |
| `apps/web/src/views/ReviewingPanel.vue` | `cumulativeGraphDraft` 删; `localData` 加 cumulativeGraph 字段; `loadCumulativeGraph` 删; `fromV3` adapter 同步 |
| `apps/web/src/views/ReviewingPanel.adapter.ts` | `fromV3` / `toV3` 处理 cumulativeGraph |
| `apps/web/src/components/graph/GraphView.vue` | watch 加 `currentLoadedChapterId` 哨兵 + 在章节变化时调 `loadChapterGraph`; `init` 改为只设 selectedChapterId |

### 必须删除

| 路径 | 原因 |
|------|------|
| `apps/web/src/views/StageResultView.vue` | 未挂载 |
| `apps/server/src/services/stages/cumulative-graph-build-service.ts` | 薄包装,内联 |
| `apps/server/src/services/cumulative-graph.ts` 内的 `BuildAndSaveInput` / `BuildAndSaveResult` interface | 跟随薄包装一起删 |
| `ChapterReel.vue:77-80` 4 个 useless computed | 模板直接用 props |
| `EditableGraph.vue:180` displayGraphData computed | 删 |
| `EditableGraph.vue:205-211` loadDraftGraph 函数 | 内联到 watch |
| `StageCard.vue:41` JSDoc 提及 StageResultView | 改写 |

### 必须新增测试

| 路径 | 用例 |
|------|------|
| `apps/server/src/__tests__/routes/cumulative-graph-build-writes-pending.test.ts` | 验证 build endpoint 改 pendingArchiveData 而非 Chapter 列 |
| `apps/server/src/__tests__/routes/archive-confirm-writes-graph-columns.test.ts` | 验证 archive confirm 从 pendingArchiveData 写三个列 |
| `apps/web/src/components/__tests__/GraphView.spec.ts` | 加用例: ChapterReel 切换章节 → loadChapterGraph 被调一次且参数是新 chapterId |

### 不在范围

- 不动 useCytoscapeLifecycle.ts 内部结构(cytoscape CRUD 逻辑没坏)
- 不动 useGraphData.ts 类型(loose `(res as any).data.data` 跟整个 api 层一致,不是图谱特有问题)
- 不动 GraphLegend / GraphEmptyState / StageCard
- 不动 packages/shared/src/graph-snapshot.ts 与 api/cumulative-graph.ts GraphSnapshot interface 重复(共享重构属于更大范围)
- 不动 chapters-archive.ts 内部 prepare-archive 与 retry-stage 字符匹配重复(其他章已有类似重复,不属于图谱专项)
- 不动 useCytoscapeLifecycle.ts 拆 3 文件(架构重构,不属于本次)

---

## 数据流(修复后)

### 用户编辑本章图谱 → 归档 → 知识图谱页
```
reviewing 期间:
  EditableGraph (chapterGraphRef) ──getData()──> ReviewingPanel.localData.graph.chapterGraph
  user 点击"保存调整"
  ReviewingPanel.handleSave ──emit('save', toV3(localData))──> Chapters.vue
  Chapters.vue ──chaptersApi.update({ pendingArchiveData })──> 服务端
  pendingArchiveData 列更新 = latest localData JSON (含 user 编辑后的 chapterGraph)

archive confirm:
  父组件触发 chaptersApi.archive
  POST /api/chapters/:id/archive
  路由读 chapter.pendingArchiveData → 解析
  prisma.chapter.update({
    status: 'archived',
    pendingArchiveData: null,
    chapterGraph: JSON.stringify(pending.stages.graph.result.chapterGraph),
    cumulativeGraph: pending.cumulativeGraph ? JSON.stringify(...) : null,
    cumulativeGraphGeneratedAt: pending.cumulativeGraphGeneratedAt ? new Date(...) : null
  })

knowledge graph 页 (用户切到 archived 章节):
  GET /api/chapters/:id/cumulative-graph
  → chapterGraph (来自 Chapter.chapterGraph 列 = user 终稿 ✓)
  → cumulativeGraph (来自 Chapter.cumulativeGraph 列)
```

### 用户生成累计图谱
```
reviewing 期间:
  ReviewingPanel 调 cumulativeGraphApi.build(chapterId, chapterGraph)
  POST /api/chapters/:id/cumulative-graph/build
  路由:
    读 chapter.pendingArchiveData, 解析
    查 prevCumulative (parent 或 chapter-1 的 Chapter.cumulativeGraph 列)
    调 buildCumulativeGraph (返回新 cumulativeGraph + aiCalled)
    prisma.chapter.update({
      pendingArchiveData: JSON.stringify({
        ...existing,
        cumulativeGraph: newGraph,
        cumulativeGraphGeneratedAt: now
      })
    })
  返回 { graph, generatedAt, aiCalled }
  ReviewingPanel 更新 localData.cumulativeGraph (从 props.pending 刷新)
```

### 用户保存累计图谱(编辑后)
```
reviewing 期间:
  user 在 EditableGraph (cumulativeGraphRef) 编辑累计图谱
  user 点击"保存"
  ReviewingPanel.handleSave:
    pullGraphDraftIntoLocalData (chapterGraph) ← 已有
    pullCumulativeDraftIntoLocalData (新加, 同理)
    emit('save', toV3(localData))
  → 父组件走 chaptersApi.update({ pendingArchiveData })
```

---

## 测试计划 (vitest)

### Server 新测试

`apps/server/src/__tests__/routes/cumulative-graph-build-writes-pending.test.ts`:
- mock `prisma.chapter.findUnique` 返回有 pendingArchiveData 的章节
- 调 build endpoint
- 断言 `prisma.chapter.update` 收到 `{ pendingArchiveData: ...JSON 字符串含 cumulativeGraph... }` 而非 `{ cumulativeGraph: ... }`

`apps/server/src/__tests__/routes/archive-confirm-writes-graph-columns.test.ts`:
- mock chapter 有 `pendingArchiveData` 含 stages.graph.result.chapterGraph + cumulativeGraph + cumulativeGraphGeneratedAt
- 调 archive endpoint
- 断言 update 同时设 `chapterGraph` + `cumulativeGraph` + `cumulativeGraphGeneratedAt` 三个列 + 清 pendingArchiveData

### Server 修改测试

`apps/server/src/__tests__/routes/prepare-archive-v3.test.ts`:
- 改断言: prepare-archive 不写 chapterGraph 列

`apps/server/src/__tests__/routes/cumulative-graph.test.ts`:
- 改断言: build / save endpoints 改 pendingArchiveData

### Web 修改测试

`apps/web/src/components/__tests__/GraphView.spec.ts`:
- 加用例: ChapterReel 切换章节 → `cumulativeGraphApi.get` 被调且参数是新 chapterId
- 加用例: 首次 init → loadChapterGraph 被调

### Web 删除测试

`apps/web/src/components/__tests__/ReviewingPanel.spec.ts` (如有):
- 删 `loadCumulativeGraph` 相关断言(如果存在)

---

## 验收 (人工 4 步,浏览器)

1. 准备归档章节 → 在 ReviewingPanel 编辑本章图谱 → 点"保存调整" → 重新加载 → 编辑保留 ✓
2. 编辑后点"确认归档" → 知识图谱页面切到该 archived 章节 → "本章纯净" tab 显示**用户终稿** ✓ (修 Bug #1)
3. 知识图谱页面有 2+ 个 archived 章节 → ChapterReel 切换 → 图谱同步刷新 ✓ (修 Bug #2)
4. 不点"生成累计图谱" → 尝试确认归档 → 弹错误"请先生成累计图谱再归档" ✓

---

## 风险

| 风险 | 缓解 |
|------|------|
| 已有的 archived 章节 `Chapter.chapterGraph` 是 AI 初稿不是用户终稿(数据迁移) | 不迁移: 老 archived 章节保持现状, 新行为只对**之后**的归档生效。文档说明这是"老数据兼容" |
| `cumulativeGraphApi.build / save` 端点 URL 不变但语义变 → 前端调用方必须同步 | 同步前端 (ReviewingPanel); 端点契约是 internal 不会破外 |
| PendingArchiveDataV3 schema 加字段,旧 v3 JSON 缺字段 → 反序列化 | Zod `.passthrough()` 已有,前端 `fromV3` 容忍 undefined → `?? { nodes: [], edges: [] }` |
| StageResultView.vue 删除后,StageCard 的 JSDoc 可能引用到 test fixture | grep test fixtures 一起改 |
| Bug #2 修复引入 watch 中 loadChapterGraph 与 init 时序竞争 | `currentLoadedChapterId` 哨兵避免同章节重复 fetch; init 不直接调 loadChapterGraph,只设 selectedChapterId 让 watch 触发 |

---

## 提交粒度 — 5 个 commit

```
chore(shared): PendingArchiveDataV3 add cumulativeGraph + cumulativeGraphGeneratedAt
- packages/shared/src/archive.ts: interface + Zod schema 加 2 个字段
- 无行为变化,仅 schema 扩展 (下游类型兼容)

fix(server): reviewing 期间不写 Chapter.chapterGraph / cumulativeGraph / cumulativeGraphGeneratedAt 列
- chapters-archive.ts: 删 prepare-archive / retry-stage 的 chapterGraph 列写入
- chapters-archive.ts: cumulative-graph/build / cumulative-graph PATCH 改写 pendingArchiveData
- chapters-archive.ts: archive confirm 写三个列 (chapterGraph + cumulativeGraph + cumulativeGraphGeneratedAt)
- 新增 2 个 server 测试覆盖契约变化

fix(web): ReviewingPanel 走 pendingArchiveData 通路 + cumulativeGraph 集成到 localData
- ReviewingPanel.vue: 删 cumulativeGraphDraft ref + loadCumulativeGraph
- ReviewingPanel.adapter.ts: fromV3 / toV3 处理 cumulativeGraph
- cumulativeGraphApi.save 入参调整为更新 pendingArchiveData 风格
- 同步 ReviewingPanel.spec.ts 测试

fix(web): GraphView ChapterReel 切换章节触发 loadChapterGraph
- GraphView.vue: watch 检测 selectedChapterId 变化调 loadChapterGraph
- GraphView.spec.ts: 加 2 个新测试用例

chore(graph): 删死代码 / 清空 computed / 合并薄包装 service
- 删 apps/web/src/views/StageResultView.vue
- ChapterReel.vue: 删 4 个 useless computed
- EditableGraph.vue: 删 displayGraphData computed + loadDraftGraph 函数 (内联)
- apps/server/src/services/stages/cumulative-graph-build-service.ts: 删除 (内联到路由)
- StageCard.vue:41 JSDoc 删 StageResultView 提及
```

---

## 自审

1. **漏修点?**
   - Bug #1 根因: 用户编辑不更新 chapterGraph 列 + archive confirm 不拷 → 改 prepare-archive 不写列 + archive confirm 写列 ✓
   - Bug #2 根因: selectChapter 不在 ChapterReel 切换时被调 → 改 watch 检测 selectedChapterId 触发 fetch ✓
   - 死代码 D1-D5: 已逐项处理 ✓
   - 静默吞错 S1: 已被 Bug #1 重构覆盖(删 loadCumulativeGraph) ✓

2. **测试是否对应每个独立行为?**
   - Server 2 新测试 (build 写 pending / archive 写三列) + 2 改测试 (prepare-archive 不写列 / cumulative-graph 改 pending)
   - Web 加 2 用例 (ChapterReel 切换 / 首次 init)

3. **没有 TBD / TODO 占位**

4. **业务边界:** 老 archived 章节的 chapterGraph 列保持现状 (AI 初稿), 新行为只对之后生效。文档说明。

5. **rollback 友好:** 5 commit 各自原子, 任一可 revert 不影响其他。