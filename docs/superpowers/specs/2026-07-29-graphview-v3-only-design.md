# 知识图谱 GraphView 重写到 v3 cumulativeGraph JSON Design Spec

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 GraphView 重写为唯一消费 v3 `cumulativeGraph` JSON 的只读视图；只展示 archived 章节；支持累计视图 / 本章纯净双模式切换；不再做新增高亮；删除被取消的 GraphLegend。`useCytoscapeLifecycle` 仅做最小改动：`init()` 重命名为 `rebuild(data | null)`，`init()` 保留为 backward-compat 别名，`COSE_LAYOUT_OPTIONS.animate = false`；增量 CRUD / `getNewIds` / `isNew` 样式分支 **保留**（`EditableGraph.vue` 仍在用）。

**Architecture:**
- 唯一数据源：`Chapter.cumulativeGraph` JSON（已有 3 端点：`GET /api/chapters/:id/cumulative-graph` 等）
- 唯一前端 API：`cumulativeGraphApi`（已在）
- 只读视图：`GraphView` 仅 fetch + render，不再持有图谱编辑状态
- ChapterReel 选项过滤 `status === 'archived'`；默认选 number 最大者
- 空态：找不到 archived → 渲染 `GraphEmptyState` 卡片，cytoscape 不 init
- cytoscape 单入口：`rebuild(data | null)`，destroy + new + 平移 layout 不动画；`init()` 保留为 backward-compat 别名

**Tech Stack:** TypeScript (NodeNext 后端 / ESNext 前端)、Vue 3、Pinia、Naive UI、Cytoscape、Vitest + @vue/test-utils + jsdom。

---

## 调研发现

### 现状

| 位置 | 状态 |
|------|------|
| `apps/web/src/views/Graph.vue` | 瘦壳，渲染 `<GraphView />` |
| `apps/web/src/components/graph/GraphView.vue` | 175 行脚本；混合数据加载 + 焦点状态 + cytoscape 生命周期 3 件事 |
| `apps/web/src/components/graph/ChapterReel.vue` | 实现已经清爽，保持 |
| `apps/web/src/components/graph/GraphLegend.vue` | 只显示新增计数，用户取消该场景，删 |
| `apps/web/src/composables/graph/useCytoscapeLifecycle.ts` | 380+ 行，提供 `init` / 增量 `addNode` 等 CRUD；调用路径散落在 GraphView 三个 watcher |
| `apps/web/src/api/cumulative-graph.ts` | `get` / `build` / `save`；只读视图只用 `get` |
| `cumulativeGraphApi.get` 返回 `{ graph, chapterGraph, timestamp? }` | `graph` = 累计图谱（snapshot view）；`chapterGraph` = 本章纯净（delta view） |

### Bug 现象（用户报告）

1. 切换到「本章纯净」tab：画布**空白**
2. 切换章节时：累计图谱**不变**，永远显示 number 最大章节的数据
3. 切回「累计全局」：只显示 number 最大章节——根因是 cytoscape 增量 CRUD 路径污染，未 reset

### Bug 根因

| 调用点 | 触发条件 | 问题 |
|---|---|---|
| `GraphView.vue:244` `cy.init()` | `loadChapterGraph` 内 | 有效，但 init 时 `displayData` 还是上一次的旧 ref 值 |
| `GraphView.vue:280` watch(viewMode) | tab 切换 | 有效 |
| `GraphView.vue:271` watch(chapterId, viewMode) | **包含 chapterId 变化** | **只 `clearFocus()`，根本没重 init**——这就是 bug 2 |

增量 `addNode` 路径在 `GraphView` 只读路径不消费，但 `EditableGraph.vue` 仍在用（章节编辑期）。

---

## 范围

### 必须新增

| 路径 | 说明 |
|------|------|
| `apps/web/src/composables/graph/useGraphData.ts` | 数据加载 + archived 过滤 + `currentSnapshot` / `currentDelta` 状态。不持有 viewMode。 |
| `apps/web/src/components/graph/GraphEmptyState.vue` | 空态卡片，文案「暂无已归档章节，先在章节编辑器完成一次归档再来看图谱」 |

### 必须修改

| 路径 | 改动 |
|------|------|
| `apps/web/src/components/graph/GraphView.vue` | 瘦化到 ~80 行。删除 `loadChapters` / `loadChapterGraph` / `loadPrevSnapshot` / `diffStats` / `computeNewIds` / `prevSnapshot` / `showNewMarker` / 焦点相关本地状态（移到 useGraphData）；保留 `selectedChapterId` / `viewMode` / `displayData` / 工具条 + 画布 + 文案 footer |
| `apps/web/src/composables/graph/useCytoscapeLifecycle.ts` | (1) `init()` 重命名为 `rebuild(data: GraphData \| null)`；`init()` 保留为 backward-compat 别名（内部从 `getDisplayData()` 拉数据再 `rebuild`），让 `EditableGraph.vue` / `GraphView.vue` 现有 `cytoscape.init()` 调用继续工作；(2) `COSE_LAYOUT_OPTIONS.animate = false`（切章节 / 重建时不再 500ms 抖动）。`addNode` / `addEdge` / `updateNode` / `updateEdge` / `removeNode` / `removeEdge` / `getNewIds` / `isNew` 样式分支 **全部保留**——`EditableGraph.vue` 仍在用这些增量 CRUD API。 |

### 必须删除

| 路径 | 说明 |
|------|------|
| `apps/web/src/components/graph/GraphLegend.vue` | 无新增高亮场景后，无内容可显示 |

### 不在范围

- `cumulativeGraphApi` 后端实现（已稳定）
- `ChapterReel.vue` 实现（已稳定）
- `EditableGraph.vue`（编辑器，独立组件，本次不动）
- `EditableGraph.vue` 的接口迁移（仍用 `addNode` / `addEdge` 等增量 CRUD + `getNewIds` 选项 + `isNew` 样式分支）——独立 follow-up，本次不动
- 主题切换 / dark mode（cytoscape 已有 isDark 支持，保留不动）
- 节点 / 边的 hover tooltip / 详情面板（用户没要求，且本身没被任何模块消费）

---

## 数据流

```
mount / route change
  │
  ▼
useGraphData.loadChapters()
  │  → chaptersApi.list(storyId)
  │  → filter status === 'archived'
  │  → 排序 by number asc
  │  → chapters.value = ...
  │
  ▼
默认 selectedChapterId = lastArchived (number 最大者)
  │
  ▼
useGraphData.loadChapterGraph(id)
  │  → cumulativeGraphApi.get(id)
  │  → currentSnapshot = toGraphData(data.graph.nodes, data.graph.edges)
  │  → currentDelta    = toGraphData(data.chapterGraph.nodes, data.chapterGraph.edges)
  │
  ▼
GraphView:
  displayData = viewMode === 'snapshot' ? currentSnapshot : currentDelta
  │
  ▼
watch([selectedChapterId, viewMode], async () => {
  await nextTick()
  cytoscape.rebuild(displayData)
})

空态分支：find 不到 archived → 不调 cumulativeGraphApi → displayData = null → rebuild(null) → 渲染 GraphEmptyState
```

---

## cytoscape rebuild 协议

```ts
// useCytoscapeLifecycle.ts
export interface CytoscapeLifecycle {
  /**
   * 单入口: 重建 cytoscape 实例。data=null = 销毁并保持实例为 null（清屏）。
   * v3 以前只有 init() 私有入口（在内部从 getDisplayData() 拉数据），
   * v3 改造后显式化：调用方在 ready 时直接 rebuild(displayData)，
   * null 状态显示空态。
   */
  rebuild(data: GraphData | null): void
  /** @deprecated 用 rebuild(data | null) 替代；保留为 backward-compat 别名让现有 caller 不动。 */
  init(): void
  destroy(): void
  resetLayout(): void
  applyFocus(focusId: string, focusType: 'node' | 'edge'): void
  clearFocus(): void
  getInstance(): cytoscape.Core | null
  // 增量 CRUD: 由 EditableGraph.vue 仍在使用，本次保留不动。
  addNode(node: GraphNode, position?: { x: number; y: number }): void
  addEdge(edge: GraphEdge): void
  updateNode(id: string, fields: { type: string; key: string; label: string }): void
  updateEdge(id: string, relation: string): void
  removeNode(id: string): void
  removeEdge(id: string): void
}

function rebuild(data: GraphData | null) {
  if (!options.containerRef.value) return
  if (!data) return
  destroy() // 复用 unmount 路径,保证 destroy 行为一致
  // 内部沿用旧 init() 内逻辑建 elements + new cytoscape + 事件 + fit zoom
  // 仅区别: layout.animate = false（避免切章节 500ms 抖动）
}

// init 保留为 backward-compat 别名: 内部从 getDisplayData() 拉数据再 rebuild
function init() { rebuild(options.getDisplayData()) }
```

**为什么 init() 保留为 backward-compat 别名**：`init()` 是私有入口（在 `useCytoscapeLifecycle` 内部从 `options.getDisplayData()` 拉数据重构），调用方不直接传数据。v3 改造后 expose `rebuild(data | null)` 是更显式的单入口（调用方自己决定 data，且支持 null = 清屏 / 空态分支）。但 `EditableGraph.vue` 的 `nextTick(() => cytoscape.init())` 和 `GraphView.vue` 的 `cytoscape.init()` 调用点都仍依赖 `init()`，本次不动 caller——保留 `init()` 实为 `rebuild(options.getDisplayData())` 的薄封装，作为迁移期的 backward-compat 协议。

**为什么保留增量 CRUD**：`EditableGraph.vue` 仍在用 `addNode` / `addEdge` / `updateNode` / `updateEdge` / `removeNode` / `removeEdge`（章节编辑期 DOM 上加节点 / 改关系 / 删节点）。本次 spec 假设"GraphView 只读路径不触发 addNode/addEdge，因此是死代码"——这是错的；`EditableGraph` 是另一 caller，仍在用。CRUD API 留到 EditableGraph.vue 迁移到别处时再删（独立 follow-up）。

**为什么 `getNewIds` + `isNew` 样式分支保留**：同 `EditableGraph.vue` 仍在用 `getNewIds` 选项（`computed(() => ({ newNodes, newEdges }))`），编辑期新增节点 / 边要高亮（`isNew` 描边色 / 边宽）。

---

## 测试计划（vitest + @vue/test-utils + jsdom）

`apps/web` 包当前 Vitest 未启用；计划在 `apps/web` 增加 vitest config + jsdom env。本次提交**先 server 的测试不动**，web 这边加最小单测：

| 文件 | 断言 |
|---|---|
| `apps/web/src/composables/__tests__/useGraphData.spec.ts` | (1) `loadChapters` 把 chapters 过滤成只剩 archived；(2) `loadChapters` 在没有任何 archived 时仍 resolve，currentSnapshot/currentDelta 保持 null；(3) `loadChapterGraph` 把 `data.graph` 映射到 `currentSnapshot`、把 `data.chapterGraph` 映射到 `currentDelta`；(4) `displayData` 根据 viewMode 返回正确那一份（computed 测试） |
| `apps/web/src/composables/__tests__/useCytoscapeLifecycle.spec.ts` | mock cytoscape.js；(1) `rebuild(null)` 不创建实例；(2) `rebuild(data)` 创建实例 + `layout.animate === false`；(3) `rebuild` 是 entry；同时 `init()` 作为 backward-compat 别名仍存在（因 `EditableGraph.vue` 仍在调用）；(4) 增量 CRUD API `addNode`/`addEdge`/`updateNode`/`updateEdge`/`removeNode`/`removeEdge` 仍暴露（`EditableGraph.vue` 仍消费）；(5) `getNewIds` 选项保留；(6) `isNew` 样式分支保留（node.border-width / edge.line-color / edge.width 由 isNew 切换）；(7) 二次 rebuild 第二次开始时旧实例被 destroy |
| `apps/web/src/components/__tests__/GraphView.spec.ts` | (1) 默认 `selectedChapterId` = number 最大的 archived；(2) 空 archived → 渲染 `GraphEmptyState`，cytoscape `rebuild` 从未被调用；(3) 切 delta tab → `cytoscape.rebuild(currentDelta)` 被触发 |

后端 Vitest 不受影响。

---

## 验收（人工 4 步）

1. 浏览器打开 `/novel-design/<storyId>/graph`：默认选中 number 最大 archived 章节，显示累计图谱
2. 切到「本章纯净」：画布显示**仅本章出现**的节点 / 边（不再是空白）；切回「累计全局」：节点恢复累计集
3. ChapterReel 切换到任意其他 archived 章节：画布**同步切换**；切回原章节：仍是原累计集（不是只剩首次渲染那个）
4. 在 schema 上把所有章节 status 改成 draft / reviewing（临时改 SQLite 后回滚）：渲染 `GraphEmptyState` 卡片，画布不出空白 cytoscape

---

## 风险

| 风险 | 缓解 |
|------|------|
| cytoscape destroy + rebuild 期间 COSE 布局跑到一半抛错 | 已有 `try { cy.destroy() } catch {}` 防护（4def263 commit 修复点） |
| GraphView 是多个模块共享的组件（章节预览 / 章节编辑器可能复用 cytoscape 实例） | grep 确认只有 GraphView 用 useCytoscapeLifecycle；如果有共享需要切到多个实例，本次只动 GraphView 路径 |
| `cumulativeGraphApi.get` 返回的 `data.chapterGraph` 在某章节可能为 null（未生成） | `rebuild(null)` 等价处理，画布清空不算 bug，但本次加 toast 提示文案 |
| web 包之前无 Vitest 配置，需新增 config / jsdom env | 改动只动 vitest.config + 加 minimal setup，不影响现有 server 测试 |

---

## 提交粒度 — 1 个原子 commit

```
refactor(web): rewrite GraphView to consume v3 cumulativeGraph JSON
```

理由：
- GraphView.vue 改写 + useCytoscapeLifecycle 接口收缩 + 新增 useGraphData + 新增 GraphEmptyState + 删除 GraphLegend 是同一交付
- 中间状态跑不起来（GraphView 引 GraphEmptyState 还没建 / GraphView 引 useGraphData 还没建）

---

## 自审

1. 章节视图切换是不是完整的 API 路径？（看：cumulativeGraphApi.get 已经被 GraphView 使用，调用路径完整）
2. 测试覆盖是否对每个独立行为有断言？（每条都对应独立 it）
3. 没有 TBD / TODO 占位
4. 业务边界与之前确认一致：仅 archived、双视图、无新增高亮
